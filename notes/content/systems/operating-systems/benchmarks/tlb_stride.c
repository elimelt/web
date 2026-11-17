// The note's original workload, scaled up: sum a 1 GiB array (four times the
// VM's reported 260 MiB L3) of uint64_t at a fixed
// byte stride, once with 4 KiB pages and once with 2 MiB transparent huge
// pages. If the jump from 512 B to 4 KiB stride were translation cost, it
// would shrink with 2 MiB pages, where 128 consecutive 4 KiB strides share
// one TLB entry.
//
// Usage: ./tlb_stride REPS > tlb_stride.jsonl
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>

#define MB2 (2L << 20)
static double now_ns(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e9 + t.tv_nsec; }
static long smaps_kb(const char *key) {
  FILE *f = fopen("/proc/self/smaps_rollup", "r"); char line[256]; long kb = -1; size_t n = strlen(key);
  while (fgets(line, sizeof line, f)) if (!strncmp(line, key, n)) kb = atol(line + n);
  fclose(f); return kb;
}

int main(int argc, char **argv) {
  int reps = argc > 1 ? atoi(argv[1]) : 5;
  long bytes = 1L << 30, n = bytes / 8;
  long strides[] = {8, 64, 512, 4096, 8192};
  { double t = now_ns(); volatile uint64_t x = 0; while (now_ns() - t < 3e9) x++; }
  for (int r = 0; r < reps; r++) {
    for (int huge = 0; huge <= 1; huge++) {
      char *raw = mmap(NULL, bytes + MB2, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
      uint64_t *a = (uint64_t *)(((uintptr_t)raw + MB2 - 1) & ~(MB2 - 1));
      madvise(a, bytes, huge ? MADV_HUGEPAGE : MADV_NOHUGEPAGE);
      for (long i = 0; i < n; i++) a[i] = i;
      long thp = smaps_kb("AnonHugePages:");
      for (int s = 0; s < 5; s++) {
        long step = strides[s] / 8;
        uint64_t sum = 0;
        long per_pass = (n + step - 1) / step, passes = 3;
        for (long i = 0; i < n; i += step) sum += a[i];  // warm-up pass
        double t0 = now_ns();
        for (long p = 0; p < passes; p++)
          for (long i = 0; i < n; i += step) sum += a[i];
        double ns = (now_ns() - t0) / (passes * per_pass);
        printf("{\"rep\":%d,\"pages\":\"%s\",\"stride\":%ld,\"ns_per_access\":%.3f,\"passes\":%ld,\"anon_huge_kb\":%ld,\"sink\":%d}\n",
               r, huge ? "2M" : "4K", strides[s], ns, passes, thp, (int)(sum & 1));
        fflush(stdout);
      }
      munmap(raw, bytes + MB2);
    }
  }
  return 0;
}
