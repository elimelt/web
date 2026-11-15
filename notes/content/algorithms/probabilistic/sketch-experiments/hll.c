// HyperLogLog accuracy on the distinct keys of one day of Wikipedia pageviews.
// Input: distinct.bin, the 64-bit key hashes in order of first appearance.
// Each trial re-hashes the keys with an independently seeded 64-bit mixer,
// inserts them in stream order into sketches of several precisions, and at
// log-spaced checkpoints n (number of distinct keys seen so far) records the
// estimate of each estimator.  Output: hll_out.bin (float32 estimates).
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include "hpp_tables.h"

static inline uint64_t fmix(uint64_t z) {
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
  z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
  return z ^ (z >> 31);
}
static const int PS[] = {4, 6, 8, 10, 12, 14, 16, 18};
#define NP 8
enum { RAW, LC, ORIG, HPP, ERTL, HPPS, NE };  // HPPS: HLL++ with sparse mode (p=14 only)
// 32-bit hash variants, p = 14: raw, orig (FFGM 2007 Fig. 3), orig with the
// collision correction applied at every n, Ertl with q = 32 - p.
enum { R32, O32, C32, E32, NE32 };

static double alpha_m(int m) {
  if (m == 16) return 0.673; if (m == 32) return 0.697; if (m == 64) return 0.709;
  return 0.7213 / (1.0 + 1.079 / m);
}
static double sigma_(double x) {
  if (x == 1.0) return INFINITY;
  double y = 1, z = x, zp;
  do { x *= x; zp = z; z += x * y; y += y; } while (zp != z);
  return z;
}
static double tau_(double x) {
  if (x == 0.0 || x == 1.0) return 0.0;
  double y = 1.0, z = 1 - x, zp;
  do { x = sqrt(x); zp = z; y *= 0.5; z -= (1 - x) * (1 - x) * y; } while (zp != z);
  return z / 3;
}
// histogram C[0..q+1]
static double ertl(const int64_t *C, int q, int m) {
  double z = m * tau_((m - C[q + 1]) / (double)m);
  for (int k = q; k >= 1; --k) { z += C[k]; z *= 0.5; }
  z += m * sigma_(C[0] / (double)m);
  return 0.5 / log(2.0) * m * (double)m / z;
}
static double rawest(const int64_t *C, int q, int m) {
  double s = 0, w = 1;
  for (int k = 0; k <= q + 1; k++) { s += C[k] * w; w *= 0.5; }
  return alpha_m(m) * (double)m * m / s;
}
static double hpp_bias(double E, int p) {
  const double *r = HPP_RAW[p - 4], *b = HPP_BIAS[p - 4]; int L = HPP_LEN[p - 4];
  int idx[6]; double dist[6];
  for (int i = 0; i < 6; i++) { idx[i] = -1; dist[i] = INFINITY; }
  for (int i = 0; i < L; i++) { double d = (E - r[i]) * (E - r[i]);
    if (d < dist[5]) { int j = 5; while (j > 0 && dist[j - 1] > d) { dist[j] = dist[j - 1]; idx[j] = idx[j - 1]; j--; }
      dist[j] = d; idx[j] = i; } }
  double s = 0; for (int i = 0; i < 6; i++) s += b[idx[i]];
  return s / 6;
}

int main(int argc, char **argv) {
  int T = argc > 1 ? atoi(argv[1]) : 100;
  FILE *f = fopen("distinct.bin", "rb"); fseek(f, 0, SEEK_END); long N = ftell(f) / 8; rewind(f);
  uint64_t *keys = malloc(N * 8); if (fread(keys, 8, N, f) != (size_t)N) return 1; fclose(f);
  // checkpoints: about 30 per decade from 1 to N, plus N
  long cp[400]; int ncp = 0; long last = 0;
  for (double x = 0; ; x += 1.0 / 30) { long v = (long)llround(pow(10, x)); if (v > N) break; if (v != last) cp[ncp++] = last = v; }
  if (cp[ncp - 1] != N) cp[ncp++] = N;
  FILE *fo = fopen("hll_meta.txt", "w");
  fprintf(fo, "N %ld T %d ncp %d NP %d NE %d NE32 %d\nps", N, T, ncp, NP, NE, NE32);
  for (int i = 0; i < NP; i++) fprintf(fo, " %d", PS[i]);
  fprintf(fo, "\ncp"); for (int i = 0; i < ncp; i++) fprintf(fo, " %ld", cp[i]); fprintf(fo, "\n"); fclose(fo);
  size_t per = (size_t)ncp * (NP * NE + NE32);
  float *out = malloc((size_t)T * per * sizeof(float));
  #pragma omp parallel for schedule(dynamic, 1)
  for (int t = 0; t < T; t++) {
    uint64_t s1 = fmix(0x1234567ULL + 2 * (uint64_t)t), s2 = fmix(0x89abcdefULL + 2 * (uint64_t)t + 1);
    uint8_t *reg[NP]; int64_t *C[NP];
    for (int i = 0; i < NP; i++) { reg[i] = calloc(1 << PS[i], 1); C[i] = calloc(70, 8); C[i][0] = 1 << PS[i]; }
    uint8_t *reg32 = calloc(1 << 14, 1); int64_t C32h[40] = {0}; C32h[0] = 1 << 14;
    uint8_t *sp = calloc(1 << 22, 1); long nsp = 0; int sparse = 1;  // 2^25-bit set for HLL++ sparse, p' = 25
    float *o = out + (size_t)t * per; int c = 0;
    for (long n = 1; n <= N && c < ncp; n++) {
      uint64_t h = fmix(fmix(keys[n - 1] ^ s1) ^ s2);
      for (int i = 0; i < NP; i++) { int p = PS[i]; uint64_t j = h >> (64 - p), w = h << p;
        uint8_t r = w ? (uint8_t)(__builtin_clzll(w) + 1) : (uint8_t)(64 - p + 1);
        if (r > reg[i][j]) { C[i][reg[i][j]]--; C[i][r]++; reg[i][j] = r; } }
      { uint32_t h32 = (uint32_t)(h >> 32); uint32_t j = h32 >> 18, w = h32 << 14;
        uint8_t r = w ? (uint8_t)(__builtin_clz(w) + 1) : (uint8_t)(32 - 14 + 1);
        if (r > reg32[j]) { C32h[reg32[j]]--; C32h[r]++; reg32[j] = r; } }
      if (sparse) { uint64_t j = h >> (64 - 25); if (!(sp[j >> 3] & (1 << (j & 7)))) { sp[j >> 3] |= 1 << (j & 7); nsp++; }
        if (nsp > 12107) sparse = 0; }  // Heule et al. Table 1: Hll++ holds 12107 pairs at p = 14
      if (n == cp[c]) {
        float *oc = o + (size_t)c * (NP * NE + NE32);
        for (int i = 0; i < NP; i++) { int p = PS[i], m = 1 << p, q = 64 - p; float *e = oc + i * NE;
          double E = rawest(C[i], q, m), V = C[i][0];
          double lc = V > 0 ? m * log(m / V) : NAN;
          e[RAW] = E; e[LC] = lc;
          e[ORIG] = (E <= 2.5 * m && V > 0) ? lc : E;
          double Ep = E <= 5.0 * m ? E - hpp_bias(E, p) : E;
          double hpp = (V > 0 && lc <= HPP_THRESH[p - 4]) ? lc : Ep;
          e[HPP] = hpp; e[ERTL] = ertl(C[i], q, m);
          if (p == 14) { double M2 = 33554432.0;
            e[HPPS] = sparse ? M2 * log(M2 / (M2 - nsp)) : hpp; } else e[HPPS] = NAN; }
        { float *e = oc + NP * NE; int m = 1 << 14, q = 18; double E = rawest(C32h, q, m), V = C32h[0];
          double lc = V > 0 ? m * log(m / V) : NAN, two32 = 4294967296.0;
          e[R32] = E;
          double o32 = (E <= 2.5 * m && V > 0) ? lc : (E <= two32 / 30 ? E : -two32 * log(1 - E / two32));
          e[O32] = o32;
          double b = (E <= 2.5 * m && V > 0) ? lc : E; e[C32] = -two32 * log(1 - b / two32);
          e[E32] = ertl(C32h, q, m); }
        c++; }
    }
    for (int i = 0; i < NP; i++) { free(reg[i]); free(C[i]); } free(reg32); free(sp);
    if (t % 50 == 0) { fprintf(stderr, "trial %d done\n", t); }
  }
  FILE *fb = fopen("hll_out.bin", "wb"); fwrite(out, sizeof(float), (size_t)T * per, fb); fclose(fb);
  return 0;
}
