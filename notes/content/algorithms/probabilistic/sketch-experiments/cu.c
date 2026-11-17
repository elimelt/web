// Count-Min with conservative update (Estan and Varghese 2002) versus plain
// Count-Min, depth 4, widths 2^10..2^20 (step 4x), fed the 161M hourly
// (key, count) records of one day in stream order (stream.bin).  Conservative
// update is not linear, so the order of updates matters; plain Count-Min is
// computed from the same rows for comparison.  Queries: every distinct key.
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#define P61 ((1ULL << 61) - 1)
static inline uint64_t mulmod(uint64_t a, uint64_t b) { __uint128_t z = (__uint128_t)a * b; uint64_t lo = (uint64_t)(z & P61), hi = (uint64_t)(z >> 61); uint64_t s = lo + hi; return s >= P61 ? s - P61 : s; }
static inline uint64_t addmod(uint64_t a, uint64_t b) { uint64_t s = a + b; return s >= P61 ? s - P61 : s; }
static inline uint64_t fmix(uint64_t z) { z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31); }
#define NW 6
#define D 4
#define NB 520
#define NF 32
typedef struct __attribute__((packed)) { uint64_t k; uint32_t c; } rec;
typedef struct { uint64_t k, c; } item;
static inline int ebin(double e) { if (e <= 0) return 0; if (e < 1) e = 1; int b = (int)floor(50 * log10(e)) + 1; return b >= NB ? NB - 1 : b; }
int main(int argc, char **argv) {
  int T = argc > 1 ? atoi(argv[1]) : 2;
  FILE *f = fopen("stream.bin", "rb"); fseek(f, 0, SEEK_END); long ns = ftell(f) / 12; rewind(f);
  rec *st = malloc(ns * 12); if (fread(st, 12, ns, f) != (size_t)ns) return 1; fclose(f);
  f = fopen("agg.bin", "rb"); fseek(f, 0, SEEK_END); long n = ftell(f) / 16; rewind(f);
  item *it = malloc(n * 16); if (fread(it, 16, n, f) != (size_t)n) return 1; fclose(f);
  for (long i = 0; i < ns; i++) st[i].k %= P61; for (long i = 0; i < n; i++) it[i].k %= P61;
  size_t per = NB + 3 + NF;  // hist, sum err, n exceed eps N, n exact, per-frequency-class sum of rel err
  double *res = calloc((size_t)T * 2 * NW * per, sizeof(double));
  uint64_t N = 0; for (long i = 0; i < n; i++) N += it[i].c;
  #pragma omp parallel for schedule(dynamic, 1)
  for (int t = 0; t < T; t++) {
    uint64_t A[D], B[D]; for (int j = 0; j < D; j++) { A[j] = fmix(77777 + 1000 * t + 2 * j) % (P61 - 1) + 1; B[j] = fmix(77778 + 1000 * t + 2 * j) % P61; }
    uint32_t *cm[NW][D], *cu[NW][D];
    for (int w = 0; w < NW; w++) for (int j = 0; j < D; j++) { cm[w][j] = calloc(1UL << (10 + 2 * w), 4); cu[w][j] = calloc(1UL << (10 + 2 * w), 4); }
    for (long i = 0; i < ns; i++) { uint64_t g[D]; uint32_t c = st[i].c;
      for (int j = 0; j < D; j++) g[j] = addmod(mulmod(A[j], st[i].k), B[j]);
      for (int w = 0; w < NW; w++) { uint64_t mask = (1UL << (10 + 2 * w)) - 1; uint32_t mn = UINT32_MAX;
        for (int j = 0; j < D; j++) { uint32_t *p = &cu[w][j][g[j] & mask]; if (*p < mn) mn = *p; cm[w][j][g[j] & mask] += c; }
        uint32_t nv = mn + c;
        for (int j = 0; j < D; j++) { uint32_t *p = &cu[w][j][g[j] & mask]; if (*p < nv) *p = nv; } } }
    double *R = res + (size_t)t * 2 * NW * per;
    for (long i = 0; i < n; i++) { uint64_t g[D]; double a = (double)it[i].c; int fc = 63 - __builtin_clzll(it[i].c);
      for (int j = 0; j < D; j++) g[j] = addmod(mulmod(A[j], it[i].k), B[j]);
      for (int w = 0; w < NW; w++) { uint64_t mask = (1UL << (10 + 2 * w)) - 1; double epsN = exp(1.0) / (double)(mask + 1) * (double)N;
        uint32_t m1 = UINT32_MAX, m2 = UINT32_MAX;
        for (int j = 0; j < D; j++) { uint32_t x = cm[w][j][g[j] & mask], y = cu[w][j][g[j] & mask]; if (x < m1) m1 = x; if (y < m2) m2 = y; }
        double e[2] = {m1 - a, m2 - a};
        for (int s = 0; s < 2; s++) { double *r = R + (size_t)(s * NW + w) * per;
          if (e[s] < 0) { fprintf(stderr, "underestimate!\n"); }
          r[ebin(e[s])] += 1; r[NB] += e[s]; r[NB + 1] += e[s] > epsN; r[NB + 2] += e[s] == 0; r[NB + 3 + fc] += e[s] / a; } } }
    for (int w = 0; w < NW; w++) for (int j = 0; j < D; j++) { free(cm[w][j]); free(cu[w][j]); }
    fprintf(stderr, "cu trial %d done\n", t);
  }
  FILE *fo = fopen("cu_out.bin", "wb"); fwrite(res, sizeof(double), (size_t)T * 2 * NW * per, fo); fclose(fo);
  FILE *fm = fopen("cu_meta.txt", "w"); fprintf(fm, "ns %ld n %ld N %llu T %d NW %d D %d NB %d NF %d\n", ns, n, (unsigned long long)N, T, NW, D, NB, NF); fclose(fm);
  return 0;
}
