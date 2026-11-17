// Count-Min and Count Sketch point-query error on the daily per-page view
// counts of one day of Wikipedia pageviews (agg.bin: {uint64 key, uint64 count}).
// Both sketches are linear, so inserting each key once with its daily total
// gives exactly the sketch that the 160M hourly updates would give.
// Row hashes: h_j(x) = ((a_j x + b_j) mod (2^61 - 1)) mod w, a pairwise
// independent family (Carter-Wegman); signs for Count Sketch from a second
// such hash.  Widths 2^10, 2^12, ..., 2^20, depths 1..8 (a depth-d sketch uses rows 1..d).
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>

#define P61 ((1ULL << 61) - 1)
static inline uint64_t mulmod(uint64_t a, uint64_t b) {
  __uint128_t z = (__uint128_t)a * b; uint64_t lo = (uint64_t)(z & P61), hi = (uint64_t)(z >> 61);
  uint64_t s = lo + hi; return s >= P61 ? s - P61 : s;
}
static inline uint64_t addmod(uint64_t a, uint64_t b) { uint64_t s = a + b; return s >= P61 ? s - P61 : s; }
static inline uint64_t fmix(uint64_t z) {
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31);
}
#define NW 6
#define LWS 2
#define LW0 10
#define D 8
#define NB 520
#define NF 32
typedef struct { uint64_t k, c; } item;
static inline int ebin(double e) { e = fabs(e); if (e == 0) return 0; if (e < 1) e = 1; int b = (int)floor(50 * log10(e)) + 1; return b >= NB ? NB - 1 : b; }

int main(int argc, char **argv) {
  int T = argc > 1 ? atoi(argv[1]) : 4;
  FILE *f = fopen("agg.bin", "rb"); fseek(f, 0, SEEK_END); long n = ftell(f) / 16; rewind(f);
  item *it = malloc(n * 16); if (fread(it, 16, n, f) != (size_t)n) return 1; fclose(f);
  uint64_t N = 0; for (long i = 0; i < n; i++) { it[i].k %= P61; N += it[i].c; }
  // top-1000 threshold
  uint64_t *cs = malloc(n * 8); for (long i = 0; i < n; i++) cs[i] = it[i].c;
  // nth_element via simple partial: sort copy (61M sort is fine once)
  int cmp(const void *a, const void *b) { uint64_t x = *(uint64_t *)a, y = *(uint64_t *)b; return x < y ? 1 : x > y ? -1 : 0; }
  qsort(cs, n, 8, cmp); uint64_t top1000 = cs[999], top100 = cs[99]; free(cs);
  int NC = 2 * NW * D;  // cfg = (method*NW + wi)*D + (d-1)
  size_t SZ = (size_t)NC * (NB + 6 + 2 * NF + 4);
  double *res = calloc((size_t)T * SZ, sizeof(double));
  long fcount[NF] = {0}; for (long i = 0; i < n; i++) fcount[63 - __builtin_clzll(it[i].c)]++;
  #pragma omp parallel for schedule(dynamic, 1)
  for (int t = 0; t < T; t++) {
    uint64_t A[D], B[D], Cc[D], Dd[D];
    for (int j = 0; j < D; j++) { A[j] = fmix(1000 * t + 4 * j + 1) % (P61 - 1) + 1; B[j] = fmix(1000 * t + 4 * j + 2) % P61;
      Cc[j] = fmix(1000 * t + 4 * j + 3) % (P61 - 1) + 1; Dd[j] = fmix(1000 * t + 4 * j + 4) % P61; }
    uint32_t *cm[NW][D]; int32_t *ct[NW][D];
    for (int w = 0; w < NW; w++) for (int j = 0; j < D; j++) { cm[w][j] = calloc(1UL << (LW0 + LWS * w), 4); ct[w][j] = calloc(1UL << (LW0 + LWS * w), 4); }
    for (long i = 0; i < n; i++) { uint64_t x = it[i].k; uint32_t c = (uint32_t)it[i].c;
      for (int j = 0; j < D; j++) { uint64_t g = addmod(mulmod(A[j], x), B[j]); int s = (addmod(mulmod(Cc[j], x), Dd[j]) & 1) ? 1 : -1;
        for (int w = 0; w < NW; w++) { uint64_t b = g & ((1UL << (LW0 + LWS * w)) - 1); cm[w][j][b] += c; ct[w][j][b] += s * (int32_t)c; } } }
    double *R = res + (size_t)t * SZ;
    for (long i = 0; i < n; i++) { uint64_t x = it[i].k; double a = (double)it[i].c; int fc = 63 - __builtin_clzll(it[i].c);
      uint64_t g[D]; int s[D];
      for (int j = 0; j < D; j++) { g[j] = addmod(mulmod(A[j], x), B[j]); s[j] = (addmod(mulmod(Cc[j], x), Dd[j]) & 1) ? 1 : -1; }
      for (int w = 0; w < NW; w++) { uint64_t mask = (1UL << (LW0 + LWS * w)) - 1; double epsN = exp(1.0) / (double)(mask + 1) * (double)N;
        uint32_t mn = UINT32_MAX; double v[D];
        for (int d = 1; d <= D; d++) { int j = d - 1;
          uint32_t c1 = cm[w][j][g[j] & mask]; if (c1 < mn) mn = c1;
          double est[2]; est[0] = mn;
          // Count Sketch: median of signed counters of rows 1..d (insertion sort)
          double val = (double)s[j] * ct[w][j][g[j] & mask]; int k = j; while (k > 0 && v[k - 1] > val) { v[k] = v[k - 1]; k--; } v[k] = val;
          est[1] = (d & 1) ? v[d / 2] : 0.5 * (v[d / 2 - 1] + v[d / 2]);
          for (int m = 0; m < 2; m++) { double e = est[m] - a; double *r = R + (size_t)((m * NW + w) * D + j) * (NB + 6 + 2 * NF + 4);
            r[ebin(e)] += 1; r[NB] += e; r[NB + 1] += fabs(e); r[NB + 2] += fabs(e) > epsN;
            r[NB + 3] += e * e; if (it[i].c >= top1000) r[NB + 4] += fabs(e) / a; if (it[i].c >= top100) r[NB + 5] += fabs(e) / a;
            r[NB + 6 + fc] += fabs(e) / a; r[NB + 6 + NF + fc] += e / a;
            if (fabs(e) > 0.1 * a) r[NB + 6 + 2 * NF] += 1; if (fabs(e) > a) r[NB + 6 + 2 * NF + 1] += 1;
            if (fabs(e) > 10 * a) r[NB + 6 + 2 * NF + 2] += 1; if (fabs(e) > 0.01 * a) r[NB + 6 + 2 * NF + 3] += 1; } } } }
    for (int w = 0; w < NW; w++) for (int j = 0; j < D; j++) { free(cm[w][j]); free(ct[w][j]); }
    fprintf(stderr, "trial %d done\n", t);
  }
  FILE *fm = fopen("cms_meta.txt", "w");
  fprintf(fm, "LWS %d n %ld N %llu T %d NW %d LW0 %d D %d NB %d NF %d top1000 %llu top100 %llu\nfcount", LWS, n, (unsigned long long)N, T, NW, LW0, D, NB, NF,
    (unsigned long long)top1000, (unsigned long long)top100);
  for (int k = 0; k < NF; k++) fprintf(fm, " %ld", fcount[k]); fprintf(fm, "\n"); fclose(fm);
  FILE *fo = fopen("cms_out.bin", "wb"); fwrite(res, sizeof(double), (size_t)T * SZ, fo); fclose(fo);
  return 0;
}
