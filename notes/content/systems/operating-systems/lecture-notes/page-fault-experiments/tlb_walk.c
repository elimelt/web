// Random loads, one per 4 KiB page, over a region backed by 4 KiB pages or by
// 2 MiB transparent huge pages. The same cache lines are touched in both cases,
// so the difference is the cost of missing in the TLB and walking the page table.
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>

#define PAGE 4096L
#define HUGE (2L << 20)

static double now_ns(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e9 + t.tv_nsec; }

static long anon_huge_kb(void) {
  FILE *f = fopen("/proc/self/smaps_rollup", "r"); char line[256]; long kb = -1;
  while (fgets(line, sizeof line, f)) if (!strncmp(line, "AnonHugePages:", 14)) kb = atol(line + 14);
  fclose(f); return kb;
}

int main(int argc, char **argv) {
  long mib = argc > 1 ? atol(argv[1]) : 1024;
  int reps = argc > 2 ? atoi(argv[2]) : 10;
  long bytes = mib << 20, pages = bytes / PAGE;
  long steps = 4000000;
  // A random cyclic order of pages, the same for both runs.
  uint32_t *perm = malloc(pages * 4);
  for (long i = 0; i < pages; i++) perm[i] = i;
  uint64_t x = 0x9E3779B97F4A7C15ull;
  for (long i = pages - 1; i > 0; i--) { x ^= x << 13; x ^= x >> 7; x ^= x << 17; long j = x % (i + 1); uint32_t t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (int r = 0; r < reps; r++) {
    for (int huge = 0; huge <= 1; huge++) {
      char *raw = mmap(NULL, bytes + HUGE, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
      char *a = (char *)(((uintptr_t)raw + HUGE - 1) & ~(HUGE - 1));
      madvise(a, bytes, huge ? MADV_HUGEPAGE : MADV_NOHUGEPAGE);
      // Each page holds a pointer to the next page in the cycle, at a
      // per-page offset so loads spread over cache sets.
      for (long i = 0; i < pages; i++) {
        long from = perm[i], to = perm[(i + 1) % pages];
        *(char **)(a + from * PAGE + (from % 64) * 64) = a + to * PAGE + (to % 64) * 64;
      }
      long hkb = anon_huge_kb();
      char *p = a + perm[0] * PAGE + (perm[0] % 64) * 64;
      for (long i = 0; i < pages; i++) p = *(char **)p; // warm up
      double t0 = now_ns();
      for (long i = 0; i < steps; i++) p = *(char **)p;
      double ns = (now_ns() - t0) / steps;
      printf("{\"pages\":\"%s\",\"rep\":%d,\"region_mib\":%ld,\"ns_per_load\":%.2f,\"anon_huge_kb\":%ld,\"sink\":%d}\n",
             huge ? "2M" : "4K", r, mib, ns, hkb, (int)((uintptr_t)p & 1));
      fflush(stdout);
      munmap(raw, bytes + HUGE);
    }
  }
  return 0;
}
