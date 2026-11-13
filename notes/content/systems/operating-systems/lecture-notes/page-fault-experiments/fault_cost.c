// Times page faults of different kinds on Linux. See the note for how to run it.
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define PAGE 4096L

static double now_ns(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e9 + t.tv_nsec;
}

struct sample { double ns; long minflt, majflt; };

static struct rusage ru0;
static double t0;
static void start(void) { getrusage(RUSAGE_SELF, &ru0); t0 = now_ns(); }
static struct sample stop(void) {
  double t1 = now_ns();
  struct rusage ru1;
  getrusage(RUSAGE_SELF, &ru1);
  return (struct sample){t1 - t0, ru1.ru_minflt - ru0.ru_minflt, ru1.ru_majflt - ru0.ru_majflt};
}

static volatile uint64_t sink;

static void touch_write(char *p, long bytes) { for (long i = 0; i < bytes; i += PAGE) p[i] = 1; }
static void touch_read(char *p, long bytes) { uint64_t s = 0; for (long i = 0; i < bytes; i += PAGE) s += p[i]; sink += s; }

static char *anon(long bytes, int advice) {
  char *p = mmap(NULL, bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (p == MAP_FAILED) { perror("mmap"); exit(1); }
  if (advice >= 0 && madvise(p, bytes, advice)) perror("madvise");
  return p;
}

static void drop_file_cache(int fd, const char *path) {
  fdatasync(fd);
  posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED);
  // As root, also drop the whole page cache so nothing of the file survives.
  int d = open("/proc/sys/vm/drop_caches", O_WRONLY);
  if (d >= 0) { if (write(d, "1", 1) < 0) perror("drop_caches"); close(d); }
  (void)path;
}

static void emit(const char *name, int rep, long pages, struct sample s) {
  printf("{\"case\":\"%s\",\"rep\":%d,\"pages\":%ld,\"ns\":%.0f,\"minflt\":%ld,\"majflt\":%ld}\n",
         name, rep, pages, s.ns, s.minflt, s.majflt);
  fflush(stdout);
}

int main(int argc, char **argv) {
  long mib = argc > 1 ? atol(argv[1]) : 64;
  int reps = argc > 2 ? atoi(argv[2]) : 15;
  const char *path = argc > 3 ? argv[3] : "fault_cost.dat";
  long bytes = mib << 20, pages = bytes / PAGE;

  // A file of random bytes to map, written once.
  int fd = open(path, O_RDWR | O_CREAT, 0644);
  struct stat st;
  fstat(fd, &st);
  if (st.st_size != bytes) {
    if (ftruncate(fd, bytes)) { perror("ftruncate"); return 1; }
    char *w = mmap(NULL, bytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    uint64_t x = 88172645463325252ull;
    for (long i = 0; i < bytes / 8; i++) { x ^= x << 13; x ^= x >> 7; x ^= x << 17; ((uint64_t *)w)[i] = x; }
    msync(w, bytes, MS_SYNC);
    munmap(w, bytes);
  }

  for (int r = 0; r < reps; r++) {
    char *p;
    // Already-mapped pages: the loop's own cost with no faults.
    p = anon(bytes, MADV_NOHUGEPAGE); touch_write(p, bytes);
    start(); touch_write(p, bytes); emit("no_fault_baseline", r, pages, stop());
    munmap(p, bytes);

    p = anon(bytes, MADV_NOHUGEPAGE);
    start(); touch_write(p, bytes); emit("anon_write_zero_fill", r, pages, stop());
    munmap(p, bytes);

    p = anon(bytes, MADV_NOHUGEPAGE);
    start(); touch_read(p, bytes); emit("anon_read_zero_page", r, pages, stop());
    munmap(p, bytes);

    // Align to 2 MiB so every huge page can be used.
    {
      long len = bytes + (2L << 20);
      char *raw = anon(len, -1);
      char *a = (char *)(((uintptr_t)raw + (2L << 20) - 1) & ~((2L << 20) - 1));
      madvise(a, bytes, MADV_HUGEPAGE);
      start(); touch_write(a, bytes); emit("anon_write_thp", r, pages, stop());
      munmap(raw, len);
    }

    // COW: the child writes every page the parent had written before fork.
    {
      p = anon(bytes, MADV_NOHUGEPAGE); touch_write(p, bytes);
      int pipefd[2];
      if (pipe(pipefd)) { perror("pipe"); return 1; }
      pid_t pid = fork();
      if (pid == 0) {
        start(); touch_write(p, bytes); struct sample s = stop();
        if (write(pipefd[1], &s, sizeof s) != sizeof s) _exit(1);
        _exit(0);
      }
      struct sample s;
      if (read(pipefd[0], &s, sizeof s) != sizeof s) return 1;
      waitpid(pid, NULL, 0);
      close(pipefd[0]); close(pipefd[1]);
      emit("cow_write_after_fork", r, pages, s);
      munmap(p, bytes);
    }

    // File pages that are in the page cache. Read faults map a block of
    // neighbours at once (fault-around), so there are fewer faults than pages.
    {
      p = mmap(NULL, bytes, PROT_READ, MAP_PRIVATE, fd, 0);
      touch_read(p, bytes); munmap(p, bytes); // ensure cached
      p = mmap(NULL, bytes, PROT_READ, MAP_PRIVATE, fd, 0);
      start(); touch_read(p, bytes); emit("file_read_cached", r, pages, stop());
      munmap(p, bytes);
    }

    // File pages that are not in memory, with readahead off: one disk read per fault.
    {
      drop_file_cache(fd, path);
      p = mmap(NULL, bytes, PROT_READ, MAP_PRIVATE, fd, 0);
      madvise(p, bytes, MADV_RANDOM);
      start(); touch_read(p, bytes); emit("file_read_uncached_random", r, pages, stop());
      munmap(p, bytes);
    }

    // Same, with the kernel's default readahead.
    {
      drop_file_cache(fd, path);
      p = mmap(NULL, bytes, PROT_READ, MAP_PRIVATE, fd, 0);
      start(); touch_read(p, bytes); emit("file_read_uncached_readahead", r, pages, stop());
      munmap(p, bytes);
    }
  }
  close(fd);
  return 0;
}
