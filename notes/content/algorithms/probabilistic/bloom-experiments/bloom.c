// False-positive rates of Bloom filter variants on the pageview keys.
// Inserted set: the 5,843,219 distinct keys of hour 0 (the first keys of
// distinct.bin, which is in order of first appearance).  Negative queries:
// the remaining 55,131,589 keys of the day, none of which is in the set.
// Keys are the 64-bit MurmurHash64A values of the key strings; each trial
// draws fresh seeds and rehashes them.
//
//   ./bloom A T   standard filter, bits/key x k grid, T trials, 10M negatives
//   ./bloom B T   variants at k = round(b ln 2), T trials, all negatives
//   ./bloom C T   counting filter with 4-bit counters, counter distribution
//   ./bloom D T   k sweep of standard and blocked layouts at 10 and 16 bits/key
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <omp.h>

static inline uint64_t fmix64(uint64_t k) { k ^= k >> 33; k *= 0xff51afd7ed558ccdULL; k ^= k >> 33; k *= 0xc4ceb9fe1a85ec53ULL; k ^= k >> 33; return k; }
static inline uint64_t sm(uint64_t *s) { uint64_t z = (*s += 0x9e3779b97f4a7c15ULL); z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31); }
static inline uint64_t frange(uint64_t h, uint64_t m) { return (uint64_t)(((unsigned __int128)h * m) >> 64); }

enum { STD, PART, KM, EDH, BLK512, BLK64, LDB, NV };
static const char *VN[] = {"standard", "partitioned", "double", "enhanced-double", "blocked512", "blocked64", "leveldb"};
#define MAXK 32

typedef struct { int v, k; uint64_t m; uint64_t s[MAXK]; } F;

// Fills pos[0..k-1] with the bit positions of key x.
static inline void positions(const F *f, uint64_t x, uint64_t *pos) {
  int k = f->k; uint64_t m = f->m;
  switch (f->v) {
  case STD: for (int i = 0; i < k; i++) pos[i] = frange(fmix64(x ^ f->s[i]), m); break;
  case PART: { uint64_t w = m / k; for (int i = 0; i < k; i++) pos[i] = i * w + frange(fmix64(x ^ f->s[i]), w); } break;
  case KM: { uint64_t a = frange(fmix64(x ^ f->s[0]), m), b = frange(fmix64(x ^ f->s[1]), m);
      for (int i = 0; i < k; i++) { pos[i] = a; a += b; if (a >= m) a -= m; } } break;
  case EDH: { uint64_t a = frange(fmix64(x ^ f->s[0]), m), b = frange(fmix64(x ^ f->s[1]), m);
      for (int i = 0; i < k; i++) { pos[i] = a; a += b; if (a >= m) a -= m; b += i + 1; while (b >= m) b -= m; } } break;
  case BLK512: { uint64_t nb = m / 512, blk = frange(fmix64(x ^ f->s[0]), nb) * 512;
      for (int i = 0; i < k; i++) pos[i] = blk + (fmix64(x ^ f->s[i + 1]) >> 55); } break;
  case BLK64: { uint64_t nb = m / 64, blk = frange(fmix64(x ^ f->s[0]), nb) * 64;
      for (int i = 0; i < k; i++) pos[i] = blk + (fmix64(x ^ f->s[i + 1]) >> 58); } break;
  case LDB: { uint32_t h = (uint32_t)fmix64(x ^ f->s[0]); uint32_t d = (h >> 17) | (h << 15);
      for (int i = 0; i < k; i++) { pos[i] = h % m; h += d; } } break;
  }
}

static uint64_t *keys; static long nk, nin;

static void load(void) {
  FILE *fp = fopen("distinct.bin", "rb"); fseek(fp, 0, SEEK_END); nk = ftell(fp) / 8; rewind(fp);
  keys = malloc(nk * 8); if (fread(keys, 8, nk, fp) != (size_t)nk) exit(1); fclose(fp); nin = 5843219;
}

// Builds the filter, returns fill fraction; counts false positives over negatives [lo, hi).
static void run(F *f, long lo, long hi, double *fill, long *fp) {
  uint64_t words = (f->m + 63) / 64; uint64_t *b = calloc(words, 8); uint64_t pos[MAXK];
  for (long j = 0; j < nin; j++) { positions(f, keys[j], pos); for (int i = 0; i < f->k; i++) b[pos[i] >> 6] |= 1ULL << (pos[i] & 63); }
  long ones = 0; for (uint64_t w = 0; w < words; w++) ones += __builtin_popcountll(b[w]);
  *fill = (double)ones / f->m;
  long c = 0;
  for (long j = lo; j < hi; j++) { positions(f, keys[j], pos); int ok = 1; for (int i = 0; i < f->k; i++) if (!(b[pos[i] >> 6] >> (pos[i] & 63) & 1)) { ok = 0; break; } c += ok; }
  *fp = c; free(b);
}

int main(int argc, char **argv) {
  char mode = argv[1][0]; int T = atoi(argv[2]); load();
  printf("# n %ld negatives %ld\n", nin, nk - nin);
  if (mode == 'A') {
    int bs[] = {2, 4, 6, 8, 10, 12, 16, 20}; long lo = nin, hi = nin + 10000000;
    printf("# trial bpk k m fill fp queries\n");
    #pragma omp parallel for schedule(dynamic) collapse(3)
    for (int t = 0; t < T; t++) for (int bi = 0; bi < 8; bi++) for (int k = 1; k <= 14; k++) {
      F f = {STD, k, (uint64_t)bs[bi] * nin}; uint64_t s = 1000003ULL * (t + 1) + 7919ULL * bs[bi] + k; for (int i = 0; i < MAXK; i++) f.s[i] = sm(&s);
      double fill; long fp; run(&f, lo, hi, &fill, &fp);
      #pragma omp critical
      { printf("%d %d %d %lu %.8f %ld %ld\n", t, bs[bi], k, f.m, fill, fp, hi - lo); fflush(stdout); }
    }
  } else if (mode == 'B') {
    int bs[] = {6, 8, 10, 12, 16, 20, 24}; long lo = nin, hi = nk;
    printf("# trial variant bpk k m fill fp queries\n");
    #pragma omp parallel for schedule(dynamic) collapse(3)
    for (int t = 0; t < T; t++) for (int bi = 0; bi < 7; bi++) for (int v = 0; v < NV; v++) {
      int b = bs[bi]; int k = (int)lround(b * log(2.0));
      if (v == LDB) { k = (int)(b * 0.69); if (k < 1) k = 1; if (k > 30) k = 30; }
      uint64_t m = (uint64_t)b * nin; if (v == BLK512) m = (m + 511) / 512 * 512; if (v == BLK64) m = (m + 63) / 64 * 64; if (v == PART) m = m / k * k;
      F f = {v, k, m}; uint64_t s = 2000003ULL * (t + 1) + 7919ULL * b + 31 * v; for (int i = 0; i < MAXK; i++) f.s[i] = sm(&s);
      double fill; long fp; run(&f, lo, hi, &fill, &fp);
      #pragma omp critical
      { printf("%d %s %d %d %lu %.8f %ld %ld\n", t, VN[v], b, k, m, fill, fp, hi - lo); fflush(stdout); }
    }
  } else if (mode == 'D') {
    // k sweep for the blocked layouts at 10 and 16 bits per key
    int bs[] = {10, 16}; int vs[] = {STD, BLK512, BLK64}; long lo = nin, hi = nin + 10000000;
    printf("# trial variant bpk k m fill fp queries\n");
    #pragma omp parallel for schedule(dynamic) collapse(4)
    for (int t = 0; t < T; t++) for (int bi = 0; bi < 2; bi++) for (int vi = 0; vi < 3; vi++) for (int k = 1; k <= 16; k++) {
      int b = bs[bi], v = vs[vi]; uint64_t m = (uint64_t)b * nin; if (v == BLK512) m = (m + 511) / 512 * 512; if (v == BLK64) m = (m + 63) / 64 * 64;
      F f = {v, k, m}; uint64_t s = 4000037ULL * (t + 1) + 7919ULL * b + 31 * v + k; for (int i = 0; i < MAXK; i++) f.s[i] = sm(&s);
      double fill; long fp; run(&f, lo, hi, &fill, &fp);
      #pragma omp critical
      { printf("%d %s %d %d %lu %.8f %ld %ld\n", t, VN[v], b, k, m, fill, fp, hi - lo); fflush(stdout); }
    }
  } else if (mode == 'C') {
    // Counting filter, 4-bit counters would overflow at 16: record the counter histogram.
    printf("# trial bpk k m maxcount hist[0..20]\n");
    #pragma omp parallel for schedule(dynamic)
    for (int t = 0; t < T; t++) {
      int b = 10, k = 7; uint64_t m = (uint64_t)b * nin; uint8_t *c = calloc(m, 1); uint64_t pos[MAXK];
      F f = {STD, k, m}; uint64_t s = 3000017ULL * (t + 1); for (int i = 0; i < MAXK; i++) f.s[i] = sm(&s);
      for (long j = 0; j < nin; j++) { positions(&f, keys[j], pos); for (int i = 0; i < k; i++) if (c[pos[i]] < 255) c[pos[i]]++; }
      long h[21] = {0}; int mx = 0; for (uint64_t i = 0; i < m; i++) { int v = c[i]; if (v > mx) mx = v; h[v > 20 ? 20 : v]++; }
      #pragma omp critical
      { printf("%d %d %d %lu %d", t, b, k, m, mx); for (int i = 0; i <= 20; i++) printf(" %ld", h[i]); printf("\n"); fflush(stdout); }
      free(c);
    }
  }
  return 0;
}
