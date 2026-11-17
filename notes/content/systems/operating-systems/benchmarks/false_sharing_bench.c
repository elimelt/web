// False sharing benchmark: stride sweep, increment kinds, and cache-line ping-pong.
// Build: gcc -O2 -pthread -o false_sharing_bench false_sharing_bench.c
// Usage:
//   ./false_sharing_bench sweep  <threads> <stride_bytes> <kind> <iters>
//       kind: atomic (lock add, relaxed) | volatile (load/add/store) | plain (counters[i]++ at -O2)
//             | reader (thread 0 does volatile increments, the others only load their own slot)
//       prints: wall_ns/iters  thread0_ns/iters  mean_of_other_threads_ns/iters
//   ./false_sharing_bench pingpong <cpuA> <cpuB> <roundtrips>
//       prints ns per one-way handoff of a line between two cores
#define _GNU_SOURCE
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static double now_ns(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1e9 + ts.tv_nsec;
}

static void pin(int cpu) {
  cpu_set_t s;
  CPU_ZERO(&s);
  CPU_SET(cpu, &s);
  if (pthread_setaffinity_np(pthread_self(), sizeof s, &s) != 0) {
    perror("pthread_setaffinity_np");
    exit(1);
  }
}

static char *arena;  // 4096-aligned, so stride s puts counter t at byte t*s of a page
static long iters;
static int kind;  // 0 atomic, 1 volatile, 2 plain, 3 reader
static atomic_int ready, go;

typedef struct { int id; int cpu; uint64_t *ctr; double ns; uint64_t sink; } arg_t;

__attribute__((noinline)) static void run_plain(uint64_t *c, long n) {
  for (long i = 0; i < n; i++) (*c)++;  // -O2 keeps *c in a register: one store at the end
}

static void *worker(void *p) {
  arg_t *a = p;
  pin(a->cpu);
  atomic_fetch_add(&ready, 1);
  while (!atomic_load(&go)) {}
  long n = iters;
  double t0 = now_ns();
  if (kind == 3 && a->id != 0) {
    volatile uint64_t *c = a->ctr;
    uint64_t s = 0;
    for (long i = 0; i < n; i++) s += *c;
    a->sink = s;
    *a->ctr = n;  // so the count check below passes
  } else if (kind == 0) {
    _Atomic uint64_t *c = (_Atomic uint64_t *)a->ctr;
    for (long i = 0; i < n; i++) atomic_fetch_add_explicit(c, 1, memory_order_relaxed);
  } else if (kind == 1 || kind == 3) {
    volatile uint64_t *c = a->ctr;
    for (long i = 0; i < n; i++) *c = *c + 1;
  } else {
    run_plain(a->ctr, n);
  }
  a->ns = now_ns() - t0;
  return NULL;
}

static int sweep(int threads, int stride, const char *k, long n) {
  kind = !strcmp(k, "atomic") ? 0 : !strcmp(k, "volatile") ? 1 : !strcmp(k, "reader") ? 3 : 2;
  iters = n;
  if (posix_memalign((void **)&arena, 4096, 1 << 16)) return 1;
  memset(arena, 0, 1 << 16);
  pthread_t th[64];
  arg_t args[64];
  atomic_store(&ready, 0);
  atomic_store(&go, 0);
  for (int t = 0; t < threads; t++) {
    args[t] = (arg_t){t, t, (uint64_t *)(arena + (long)t * stride), 0, 0};
    pthread_create(&th[t], NULL, worker, &args[t]);
  }
  while (atomic_load(&ready) < threads) {}
  double t0 = now_ns();
  atomic_store(&go, 1);
  for (int t = 0; t < threads; t++) pthread_join(th[t], NULL);
  double dt = now_ns() - t0;
  for (int t = 0; t < threads; t++)
    if (*args[t].ctr != (uint64_t)n) { fprintf(stderr, "bad count %d\n", t); return 1; }
  double others = 0;
  for (int t = 1; t < threads; t++) others += args[t].ns;
  others = threads > 1 ? others / (threads - 1) : 0;
  printf("%.4f %.4f %.4f\n", dt / n, args[0].ns / n, others / n);
  return 0;
}

// Ping-pong: one 64-byte-aligned word; A writes odd values, B writes even values.
static _Alignas(64) _Atomic uint64_t flag;
static long rounds;
static int cpuA, cpuB;
static void *pp_b(void *p) {
  (void)p;
  pin(cpuB);
  for (long i = 0; i < rounds; i++) {
    while (atomic_load_explicit(&flag, memory_order_acquire) != 2 * i + 1) {}
    atomic_store_explicit(&flag, 2 * i + 2, memory_order_release);
  }
  return NULL;
}
static int pingpong(int a, int b, long n) {
  cpuA = a; cpuB = b; rounds = n;
  atomic_store(&flag, 0);
  pthread_t th;
  pthread_create(&th, NULL, pp_b, NULL);
  pin(cpuA);
  double t0 = 0;
  for (long i = 0; i < n; i++) {
    if (i == 1000) t0 = now_ns();  // warm up
    while (atomic_load_explicit(&flag, memory_order_acquire) != 2 * i) {}
    atomic_store_explicit(&flag, 2 * i + 1, memory_order_release);
  }
  while (atomic_load_explicit(&flag, memory_order_acquire) != 2 * n) {}
  double dt = now_ns() - t0;
  pthread_join(th, NULL);
  printf("%.2f\n", dt / (2.0 * (n - 1000)));
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 6 && !strcmp(argv[1], "sweep"))
    return sweep(atoi(argv[2]), atoi(argv[3]), argv[4], atol(argv[5]));
  if (argc == 5 && !strcmp(argv[1], "pingpong"))
    return pingpong(atoi(argv[2]), atoi(argv[3]), atol(argv[4]));
  fprintf(stderr, "usage: see header\n");
  return 2;
}
