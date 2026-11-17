// Page-size sweep: a random cyclic pointer chase with one load per 4 KiB of
// address space, over regions from 32 KiB to 8 GiB, backed by 4 KiB pages,
// 2 MiB transparent huge pages, or 1 GiB hugetlbfs pages. The same virtual
// layout and the same cache-line offsets are used for every page size, so at a
// given region size the loads touch the same number of distinct cache lines;
// the differences between page sizes come from address translation.
//
// Usage: ./tlb_sweep REPS MAX_MIB > tlb_sweep.jsonl
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>

#ifndef MAP_HUGE_1GB
#define MAP_HUGE_1GB (30 << 26)
#endif
#define PAGE 4096L
#define MB2 (2L << 20)
#define GB1 (1L << 30)

static double now_ns(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e9 + t.tv_nsec; }

static long smaps_kb(const char *key) {
  FILE *f = fopen("/proc/self/smaps_rollup", "r"); char line[256]; long kb = -1; size_t n = strlen(key);
  while (fgets(line, sizeof line, f)) if (!strncmp(line, key, n)) kb = atol(line + n);
  fclose(f); return kb;
}

// Cache-line offset of the node in a 4 KiB page: a hash of the page number, so
// that with huge pages (where physical address bits 12 and up follow the page
// number) the lines still spread over all L2 sets.
static long off(long page) { uint64_t h = page * 0x9E3779B97F4A7C15ull; return (long)(h >> 58) * 64; }

static uint64_t rng = 0x9E3779B97F4A7C15ull;
static uint64_t next(void) { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; return rng; }

// Clock calibration: a chain of dependent adds retires at one per cycle.
static double ghz(void) {
  uint64_t x = 1; long n = 200000000; double t0 = now_ns();
  for (long i = 0; i < n; i++) __asm__ volatile("add $1, %0" : "+r"(x));
  return n / (now_ns() - t0);
}

int main(int argc, char **argv) {
  int reps = argc > 1 ? atoi(argv[1]) : 5;
  long max_mib = argc > 2 ? atol(argv[2]) : 8192;
  const char *names[3] = {"4K", "2M", "1G"};
  // Region sizes: 32 KiB to max_mib, in steps of 2^(1/2).
  long sizes[64]; int ns = 0;
  for (double kb = 32; kb <= max_mib * 1024.0 + 1; kb *= 1.41421356237) {
    long b = ((long)(kb * 1024 + 0.5) / PAGE) * PAGE; sizes[ns++] = b;
  }
  { double t = now_ns(); while (now_ns() - t < 3e9) ghz(); }  // let the clock ramp up
  fprintf(stderr, "clock %.3f GHz\n", ghz());
  for (int r = 0; r < reps; r++) {
    for (int s = 0; s < ns; s++) {
      long bytes = sizes[s], pages = bytes / PAGE;
      uint32_t *perm = malloc(pages * 4);
      for (long i = 0; i < pages; i++) perm[i] = i;
      for (long i = pages - 1; i > 0; i--) { long j = next() % (i + 1); uint32_t t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
      for (int k = 0; k < 3; k++) {
        if (k == 2 && bytes > 2 * GB1) continue;
        long map = k == 2 ? (bytes + GB1 - 1) / GB1 * GB1 : bytes + MB2 + MB2;
        char *raw, *a;
        if (k == 2) {
          raw = mmap(NULL, map, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_HUGETLB | MAP_HUGE_1GB, -1, 0);
          if (raw == MAP_FAILED) { fprintf(stderr, "1G mmap failed at %ld\n", bytes); continue; }
          a = raw;
        } else {
          raw = mmap(NULL, map, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
          a = (char *)(((uintptr_t)raw + MB2 - 1) & ~(MB2 - 1));
          madvise(a, (bytes + MB2 - 1) / MB2 * MB2, k == 1 ? MADV_HUGEPAGE : MADV_NOHUGEPAGE);
        }
        for (long i = 0; i < pages; i++) {
          long from = perm[i], to = perm[(i + 1) % pages];
          *(char **)(a + from * PAGE + off(from)) = a + to * PAGE + off(to);
        }
        long thp = k == 2 ? smaps_kb("Private_Hugetlb:") : smaps_kb("AnonHugePages:");
        char *p = a + perm[0] * PAGE + off(perm[0]);
        for (long i = 0; i < pages * 2 && i < 4000000; i++) p = *(char **)p;  // warm caches and TLBs
        long steps = bytes < (64L << 20) ? 20000000 : 4000000;
        double t0 = now_ns();
        for (long i = 0; i < steps; i++) p = *(char **)p;
        double nsl = (now_ns() - t0) / steps;
        printf("{\"rep\":%d,\"pages\":\"%s\",\"region_bytes\":%ld,\"ns_per_load\":%.3f,\"huge_kb\":%ld,\"sink\":%d}\n",
               r, names[k], bytes, nsl, thp, (int)((uintptr_t)p & 1));
        fflush(stdout);
        munmap(raw, map);
      }
      free(perm);
    }
  }
  fprintf(stderr, "clock %.3f GHz\n", ghz());
  return 0;
}
