// Integer hash families on the pageview day's keys, in three consumers:
// HyperLogLog (p = 14, Ertl's estimator), one Count-Min row (w = 2^14, 2^18)
// and the AMS F2 estimator Z^2 with Z = sum_i s(x_i) a_i.
// Key sets: "dense" x_i = i, the index of page i in order of first appearance;
//           "random" x_i = MurmurHash64A of page i's key string.
// Both carry page i's daily view count a_i.  Families (all seeded per trial):
//  ms     multiply-shift, a*x mod 2^64, a odd; consumers take the top bits
//  mslo   the same product, consumers take the low bits (a common misuse)
//  mas    multiply-add-shift, ((a*x + b) mod 2^128) >> 64, a, b 128-bit
//  cw     (a*x + b) mod p, p = 2^61 - 1 (2-independent); value << 3
//  poly4  degree-3 polynomial mod p (4-independent); value << 3
//  tab    simple tabulation, 8 tables of 256 64-bit entries (3-independent)
//  fmix   MurmurHash3's fmix64 applied to x ^ seed (no guarantee)
// Usage: ./fam T > fam.txt
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#define P61 ((1ULL << 61) - 1)
typedef unsigned __int128 u128;
static inline uint64_t mulmod(uint64_t a, uint64_t b) { u128 z = (u128)a * b; uint64_t lo = (uint64_t)z & P61, hi = (uint64_t)(z >> 61); uint64_t s = lo + hi; return s >= P61 ? s - P61 : s; }
static inline uint64_t addmod(uint64_t a, uint64_t b) { uint64_t s = a + b; return s >= P61 ? s - P61 : s; }
static inline uint64_t sm(uint64_t *s) { uint64_t z = (*s += 0x9e3779b97f4a7c15ULL); z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31); }
static inline uint64_t fmix64(uint64_t k) { k ^= k >> 33; k *= 0xff51afd7ed558ccdULL; k ^= k >> 33; k *= 0xc4ceb9fe1a85ec53ULL; k ^= k >> 33; return k; }
static double sigma_(double x) { if (x == 1.0) return INFINITY; double y = 1, z = x, zp; do { x *= x; zp = z; z += x * y; y += y; } while (zp != z); return z; }
static double tau_(double x) { if (x == 0.0 || x == 1.0) return 0.0; double y = 1.0, z = 1 - x, zp; do { x = sqrt(x); zp = z; y *= 0.5; z -= (1 - x) * (1 - x) * y; } while (zp != z); return z / 3; }
#define P 14
#define M (1 << P)
static double ertl(const uint8_t *reg) { int q = 64 - P; int64_t C[72] = {0}; for (int j = 0; j < M; j++) C[reg[j]]++;
  double z = M * tau_((M - C[q + 1]) / (double)M); for (int k = q; k >= 1; --k) { z += C[k]; z *= 0.5; } z += M * sigma_(C[0] / (double)M);
  return 0.5 / log(2.0) * M * (double)M / z; }
enum { MS, MSLO, MAS, CW, POLY4, TAB, FMIX, NF };
static const char *fname[NF] = {"ms", "mslo", "mas", "cw", "poly4", "tab", "fmix"};
typedef struct { uint64_t a, b, c, d, s; u128 A, B; uint64_t T[8][256]; } par;
static void init(par *q, int f, uint64_t seed) { uint64_t s = seed;
  q->a = sm(&s) | 1; q->b = sm(&s); q->A = ((u128)sm(&s) << 64) | sm(&s); q->B = ((u128)sm(&s) << 64) | sm(&s);
  if (f == CW || f == POLY4) { q->a = sm(&s) % (P61 - 1) + 1; q->b = sm(&s) % P61; q->c = sm(&s) % P61; q->d = sm(&s) % P61; }
  q->s = sm(&s); if (f == TAB) for (int c = 0; c < 8; c++) for (int j = 0; j < 256; j++) q->T[c][j] = sm(&s); }
static inline uint64_t H(const par *q, int f, uint64_t x) {
  switch (f) {
    case MS: case MSLO: return q->a * x;
    case MAS: return (uint64_t)((q->A * x + q->B) >> 64);
    case CW: { uint64_t y = x % P61; return addmod(mulmod(q->a, y), q->b) << 3; }
    case POLY4: { uint64_t y = x % P61; uint64_t h = q->a; h = addmod(mulmod(h, y), q->b); h = addmod(mulmod(h, y), q->c); h = addmod(mulmod(h, y), q->d); return h << 3; }
    case TAB: { uint64_t h = 0; for (int c = 0; c < 8; c++) h ^= q->T[c][(x >> (8 * c)) & 255]; return h; }
    default: return fmix64(x ^ q->s);
  } }
#define NCP 5
static const long CP[NCP] = {10000, 100000, 1000000, 10000000, 0};
int main(int argc, char **argv) {
  int T = argc > 1 ? atoi(argv[1]) : 20;
  FILE *f = fopen("distinct.bin", "rb"); fseek(f, 0, SEEK_END); long n = ftell(f) / 8; rewind(f);
  uint64_t *key = malloc(n * 8); if (fread(key, 8, n, f) != (size_t)n) return 1; fclose(f);
  f = fopen("agg.bin", "rb"); typedef struct { uint64_t k, c; } it; it *ag = malloc(n * 16); if (fread(ag, 16, n, f) != (size_t)n) return 1; fclose(f);
  uint64_t cap = 1ULL << 27, msk = cap - 1; it *tb = calloc(cap, 16);
  for (long i = 0; i < n; i++) { uint64_t j = fmix64(ag[i].k) & msk; while (tb[j].k) j = (j + 1) & msk; tb[j] = ag[i]; }
  uint32_t *cnt = malloc(n * 4); double N = 0, F2 = 0, F4 = 0;
  for (long i = 0; i < n; i++) { uint64_t j = fmix64(key[i]) & msk; while (tb[j].k != key[i]) j = (j + 1) & msk; cnt[i] = (uint32_t)tb[j].c;
    double a = cnt[i]; N += a; F2 += a * a; F4 += a * a * a * a; }
  free(tb); free(ag);
  fprintf(stderr, "n %ld N %.0f F2 %.6e F4 %.6e\n", n, N, F2, F4);
  printf("# n %ld N %.0f F2 %.17g F4 %.17g\n", n, N, F2, F4);
  printf("# keyset family trial hll@1e4 hll@1e5 hll@1e6 hll@1e7 hll@n cm14 cm18 chi14 Z\n");
  int NJ = 2 * NF * T;
  #pragma omp parallel for schedule(dynamic, 1)
  for (int job = 0; job < NJ; job++) {
    int ks = job / (NF * T), fam = (job / T) % NF, t = job % T;
    par *q = malloc(sizeof(par)); init(q, fam, 0x1234567ULL * (uint64_t)(t + 1) + 977 * fam);
    uint8_t *reg = calloc(M, 1); uint32_t *n14 = calloc(1 << 14, 4), *n18 = calloc(1 << 18, 4);
    double *N14 = calloc(1 << 14, 8), *N18 = calloc(1 << 18, 8); double Z = 0, est[NCP]; int c = 0;
    for (long i = 0; i < n; i++) {
      uint64_t x = ks ? key[i] : (uint64_t)i, v = H(q, fam, x); double a = cnt[i];
      uint64_t idx, w; if (fam == MSLO) { idx = v & (M - 1); w = v & ~(uint64_t)(M - 1); } else { idx = v >> (64 - P); w = v << P; }
      uint8_t r = w ? __builtin_clzll(w) + 1 : 64 - P + 1; if (r > reg[idx]) reg[idx] = r;
      uint64_t b14 = fam == MSLO ? (v & ((1 << 14) - 1)) : v >> 50, b18 = fam == MSLO ? (v & ((1 << 18) - 1)) : v >> 46;
      n14[b14]++; N14[b14] += a; n18[b18]++; N18[b18] += a;
      int sg = fam == MSLO ? (int)(v & 1) : (int)(v >> 63); Z += sg ? a : -a;
      if (c < NCP - 1 && i + 1 == CP[c]) est[c++] = ertl(reg);
    }
    est[NCP - 1] = ertl(reg);
    double s14 = 0, s18 = 0, chi = 0, e = (double)n / (1 << 14);
    for (int b = 0; b < (1 << 14); b++) { s14 += n14[b] * N14[b]; chi += (n14[b] - e) * (n14[b] - e) / e; }
    for (int b = 0; b < (1 << 18); b++) s18 += n18[b] * N18[b];
    // mean overestimate over all pages: (sum_b n_b N_b - N) / n
    #pragma omp critical
    { printf("%s %s %d", ks ? "random" : "dense", fname[fam], t);
      for (int k = 0; k < NCP; k++) printf(" %.9g", est[k]);
      printf(" %.9g %.9g %.6g %.9g\n", (s14 - N) / n, (s18 - N) / n, chi, Z); fflush(stdout); }
    free(q); free(reg); free(n14); free(n18); free(N14); free(N18);
  }
  return 0;
}
