// linkem: a two-namespace link emulator built on TUN devices.
//
// The kernel in the test machine has no netem, so this program plays the
// link: every IP packet one namespace sends comes out of its TUN device, waits
// for its turn on a rate-limited "wire" (serialization at --rate-mbit), then
// for the one-way propagation delay (--delay-ms), and is written into the
// other namespace's TUN device. Both TCP endpoints are the real Linux stack;
// only the wire between them is emulated. A packet that would wait behind more
// than --queue-bytes of earlier packets is dropped (drop-tail).
//
// Build:  cc -O2 -Wall -o linkem linkem.c
// Run:    see run_experiments.py, which creates the namespaces and devices.

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/if.h>
#include <linux/if_tun.h>
#include <poll.h>
#include <sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#define MAXPKT 2048
#define RING 65536

typedef struct {
  uint64_t due;   // ns, when the packet leaves the far end of the wire
  uint64_t start; // ns, when its first bit goes onto the wire
  uint16_t len;
  uint8_t data[MAXPKT];
} pkt_t;

typedef struct {
  int in, out;            // read from `in`, write to `out`
  pkt_t *ring;
  size_t head, tail;      // packets in [head, tail)
  uint64_t wire_free;     // ns, when the wire finishes the last queued packet
  uint64_t delay_ns;
  double ns_per_byte;
  uint64_t queue_bytes;
  uint64_t sent, dropped, bytes;
} dir_t;

static volatile sig_atomic_t stop;
static void on_signal(int s) { (void)s; stop = 1; }

static uint64_t now_ns(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint64_t)ts.tv_sec * 1000000000ull + ts.tv_nsec;
}

static int open_tun_in_ns(const char *ns, const char *dev) {
  char path[256];
  snprintf(path, sizeof path, "/var/run/netns/%s", ns);
  int nsfd = open(path, O_RDONLY);
  if (nsfd < 0 || setns(nsfd, CLONE_NEWNET) < 0) { perror(path); exit(1); }
  close(nsfd);
  int fd = open("/dev/net/tun", O_RDWR | O_NONBLOCK);
  if (fd < 0) { perror("/dev/net/tun"); exit(1); }
  struct ifreq ifr;
  memset(&ifr, 0, sizeof ifr);
  ifr.ifr_flags = IFF_TUN | IFF_NO_PI;
  strncpy(ifr.ifr_name, dev, IFNAMSIZ - 1);
  if (ioctl(fd, TUNSETIFF, &ifr) < 0) { perror("TUNSETIFF"); exit(1); }
  return fd;
}

// Bytes queued ahead of a packet arriving now: everything not yet on the wire.
static uint64_t backlog_bytes(dir_t *d, uint64_t t) {
  if (d->wire_free <= t) return 0;
  return (uint64_t)((d->wire_free - t) / d->ns_per_byte);
}

static void ingest(dir_t *d) {
  for (;;) {
    size_t used = d->tail - d->head;
    if (used >= RING) { // ring full: drain the device and count drops
      uint8_t junk[MAXPKT];
      if (read(d->in, junk, sizeof junk) < 0) return;
      d->dropped++;
      continue;
    }
    pkt_t *p = &d->ring[d->tail % RING];
    ssize_t n = read(d->in, p->data, MAXPKT);
    if (n <= 0) return;
    uint64_t t = now_ns();
    if (backlog_bytes(d, t) + (uint64_t)n > d->queue_bytes) { d->dropped++; continue; }
    p->len = (uint16_t)n;
    p->start = d->wire_free > t ? d->wire_free : t;
    d->wire_free = p->start + (uint64_t)(n * d->ns_per_byte);
    p->due = d->wire_free + d->delay_ns;
    d->tail++;
  }
}

static uint64_t deliver(dir_t *d) { // returns next due time, or 0 if empty
  uint64_t t = now_ns();
  while (d->head < d->tail) {
    pkt_t *p = &d->ring[d->head % RING];
    if (p->due > t) return p->due;
    if (write(d->out, p->data, p->len) < 0 && errno != EAGAIN) perror("write");
    d->sent++;
    d->bytes += p->len;
    d->head++;
  }
  return 0;
}

int main(int argc, char **argv) {
  const char *ns_a = "fc_snd", *ns_b = "fc_rcv", *dev_a = "tun0", *dev_b = "tun1";
  double delay_ms = 25, rate_mbit = 100, queue_kb = 1024;
  for (int i = 1; i + 1 < argc; i += 2) {
    if (!strcmp(argv[i], "--delay-ms")) delay_ms = atof(argv[i + 1]);
    else if (!strcmp(argv[i], "--rate-mbit")) rate_mbit = atof(argv[i + 1]);
    else if (!strcmp(argv[i], "--queue-kb")) queue_kb = atof(argv[i + 1]);
    else if (!strcmp(argv[i], "--ns-a")) ns_a = argv[i + 1];
    else if (!strcmp(argv[i], "--ns-b")) ns_b = argv[i + 1];
    else { fprintf(stderr, "unknown option %s\n", argv[i]); return 2; }
  }
  int fa = open_tun_in_ns(ns_a, dev_a);
  int fb = open_tun_in_ns(ns_b, dev_b);
  dir_t d[2];
  for (int k = 0; k < 2; k++) {
    memset(&d[k], 0, sizeof d[k]);
    d[k].ring = calloc(RING, sizeof(pkt_t));
    d[k].delay_ns = (uint64_t)(delay_ms * 1e6);
    d[k].ns_per_byte = 8e3 / rate_mbit; // 8 bits per byte, rate in Mbit/s -> ns
    d[k].queue_bytes = (uint64_t)(queue_kb * 1024);
  }
  d[0].in = fa; d[0].out = fb; // a -> b
  d[1].in = fb; d[1].out = fa; // b -> a
  signal(SIGTERM, on_signal);
  signal(SIGINT, on_signal);
  fprintf(stderr, "linkem: %s/%s <-> %s/%s, one-way delay %.3f ms, %.1f Mbit/s, queue %.0f KiB\n",
          ns_a, dev_a, ns_b, dev_b, delay_ms, rate_mbit, queue_kb);
  struct pollfd pfd[2] = {{.fd = fa, .events = POLLIN}, {.fd = fb, .events = POLLIN}};
  while (!stop) {
    uint64_t n0 = deliver(&d[0]), n1 = deliver(&d[1]);
    uint64_t next = n0 && n1 ? (n0 < n1 ? n0 : n1) : (n0 ? n0 : n1);
    struct timespec ts, *tp = NULL;
    if (next) {
      uint64_t t = now_ns();
      uint64_t wait = next > t ? next - t : 0;
      ts.tv_sec = wait / 1000000000ull;
      ts.tv_nsec = wait % 1000000000ull;
      tp = &ts;
    }
    if (ppoll(pfd, 2, tp, NULL) < 0 && errno != EINTR) { perror("ppoll"); break; }
    if (pfd[0].revents & POLLIN) ingest(&d[0]);
    if (pfd[1].revents & POLLIN) ingest(&d[1]);
  }
  fprintf(stderr, "linkem: a->b %llu pkts (%llu dropped), b->a %llu pkts (%llu dropped)\n",
          (unsigned long long)d[0].sent, (unsigned long long)d[0].dropped,
          (unsigned long long)d[1].sent, (unsigned long long)d[1].dropped);
  return 0;
}
