// Insert and lookup cost of Bloom filter layouts as the filter outgrows the caches.
// Single thread; keys are 64-bit values from splitmix64 (the pageview keys are
// already 64-bit hashes, so their values are equivalent for timing).  Each
// configuration uses 10 bits per key and k = 7.  Lookups are independent of one
// another, so the processor can overlap their cache misses; the numbers are
// throughput, not the latency of one isolated lookup.
//   ./speed log2n_min log2n_max reps
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>

static inline uint64_t fmix64(uint64_t k) { k ^= k >> 33; k *= 0xff51afd7ed558ccdULL; k ^= k >> 33; k *= 0xc4ceb9fe1a85ec53ULL; k ^= k >> 33; return k; }
static inline uint64_t key(uint64_t i, uint64_t s) { uint64_t z = i * 0x9e3779b97f4a7c15ULL + s; z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31); }
static inline uint64_t frange(uint64_t h, uint64_t m) { return (uint64_t)(((unsigned __int128)h * m) >> 64); }
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + 1e-9 * t.tv_nsec; }

#define K 7
static uint64_t *B, M; static uint64_t S[K + 1];

// standard: k independent hash evaluations, k cache lines
static inline void ins_std(uint64_t x) { for (int i = 0; i < K; i++) { uint64_t p = frange(fmix64(x ^ S[i]), M); B[p >> 6] |= 1ULL << (p & 63); } }
static inline int has_std(uint64_t x) { for (int i = 0; i < K; i++) { uint64_t p = frange(fmix64(x ^ S[i]), M); if (!(B[p >> 6] >> (p & 63) & 1)) return 0; } return 1; }
// double hashing (Kirsch-Mitzenmacher): one 128-bit product gives two hashes
static inline void ins_dh(uint64_t x) { uint64_t h = fmix64(x ^ S[0]); uint64_t a = frange(h, M), b = frange(fmix64(h ^ S[1]), M);
  for (int i = 0; i < K; i++) { B[a >> 6] |= 1ULL << (a & 63); a += b; if (a >= M) a -= M; } }
static inline int has_dh(uint64_t x) { uint64_t h = fmix64(x ^ S[0]); uint64_t a = frange(h, M), b = frange(fmix64(h ^ S[1]), M);
  for (int i = 0; i < K; i++) { if (!(B[a >> 6] >> (a & 63) & 1)) return 0; a += b; if (a >= M) a -= M; } return 1; }
// blocked to one 512-bit cache line; the k in-block positions come from 9-bit slices of one 64-bit hash
static inline void ins_b512(uint64_t x) { uint64_t h = fmix64(x ^ S[0]); uint64_t *w = B + frange(h, M / 512) * 8; uint64_t g = fmix64(h ^ S[1]);
  for (int i = 0; i < K; i++) { unsigned p = (g >> (9 * i)) & 511; w[p >> 6] |= 1ULL << (p & 63); } }
static inline int has_b512(uint64_t x) { uint64_t h = fmix64(x ^ S[0]); uint64_t *w = B + frange(h, M / 512) * 8; uint64_t g = fmix64(h ^ S[1]);
  for (int i = 0; i < K; i++) { unsigned p = (g >> (9 * i)) & 511; if (!(w[p >> 6] >> (p & 63) & 1)) return 0; } return 1; }
// register-blocked: all k bits in one 64-bit word, tested with one AND
static inline uint64_t mask64(uint64_t g) { uint64_t m = 0; for (int i = 0; i < K; i++) m |= 1ULL << ((g >> (6 * i)) & 63); return m; }
static inline void ins_b64(uint64_t x) { uint64_t h = fmix64(x ^ S[0]); B[frange(h, M / 64)] |= mask64(fmix64(h ^ S[1])); }
static inline int has_b64(uint64_t x) { uint64_t h = fmix64(x ^ S[0]); uint64_t m = mask64(fmix64(h ^ S[1])); return (B[frange(h, M / 64)] & m) == m; }

#define BENCH(NAME, INS, HAS) do { \
  double t0 = now(); for (uint64_t i = 0; i < n; i++) INS(key(i, 1)); double t1 = now(); \
  long c = 0; for (uint64_t i = 0; i < q; i++) c += HAS(key(i, 2)); double t2 = now(); \
  long d = 0; for (uint64_t i = 0; i < q; i++) d += HAS(key(i % n, 1)); double t3 = now(); \
  printf("%d %s %lu %.3f %.3f %.3f %.6f %ld\n", lg, NAME, M / 8, 1e9 * (t1 - t0) / n, 1e9 * (t2 - t1) / q, 1e9 * (t3 - t2) / q, (double)c / q, d); fflush(stdout); \
} while (0)

int main(int argc, char **argv) {
  int lo = atoi(argv[1]), hi = atoi(argv[2]), reps = atoi(argv[3]);
  printf("# log2n layout bytes ns_insert ns_query_absent ns_query_present fpr present_hits\n");
  for (int r = 0; r < reps; r++) for (int lg = lo; lg <= hi; lg++) {
    uint64_t n = 1ULL << lg, q = 1ULL << 24; M = (n * 10 + 511) / 512 * 512;
    uint64_t s = 77 + r; for (int i = 0; i <= K; i++) S[i] = key(i, s);
    B = aligned_alloc(64, M / 8);
    // baseline: generating and summing the keys alone
    { double t0 = now(); uint64_t z = 0; for (uint64_t i = 0; i < q; i++) z += key(i, 2); double t1 = now();
      printf("%d keygen %lu 0 %.3f 0 0 %lu\n", lg, M / 8, 1e9 * (t1 - t0) / q, z & 1); }
    for (int v = 0; v < 4; v++) {
      for (uint64_t i = 0; i < M / 64; i++) B[i] = 0;
      if (v == 0) BENCH("standard", ins_std, has_std);
      if (v == 1) BENCH("double", ins_dh, has_dh);
      if (v == 2) BENCH("blocked512", ins_b512, has_b512);
      if (v == 3) BENCH("blocked64", ins_b64, has_b64);
    }
    free(B);
  }
}
