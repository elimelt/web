#include <stdint.h>
#include <string.h>
#include <math.h>
#define P61 ((1ULL << 61) - 1)
typedef unsigned __int128 u128;
static inline uint64_t mulmod(uint64_t a, uint64_t b) { u128 z = (u128)a * b; uint64_t lo = (uint64_t)z & P61, hi = (uint64_t)(z >> 61); uint64_t s = lo + hi; return s >= P61 ? s - P61 : s; }
static inline uint64_t addmod(uint64_t a, uint64_t b) { uint64_t s = a + b; return s >= P61 ? s - P61 : s; }
static inline uint64_t sm(uint64_t *s) { uint64_t z = (*s += 0x9e3779b97f4a7c15ULL); z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31); }
static inline uint64_t fmix64(uint64_t k) { k ^= k >> 33; k *= 0xff51afd7ed558ccdULL; k ^= k >> 33; k *= 0xc4ceb9fe1a85ec53ULL; k ^= k >> 33; return k; }
static inline uint32_t fmix32(uint32_t h) { h ^= h >> 16; h *= 0x85ebca6bu; h ^= h >> 13; h *= 0xc2b2ae35u; h ^= h >> 16; return h; }
static uint64_t murmur64a(const void *key, size_t len, uint64_t seed) {
  const uint64_t m = 0xc6a4a7935bd1e995ULL; const int r = 47; uint64_t h = seed ^ (len * m);
  const unsigned char *p = key; size_t nb = len / 8;
  for (size_t i = 0; i < nb; i++) { uint64_t k; memcpy(&k, p + 8*i, 8); k *= m; k ^= k >> r; k *= m; h ^= k; h *= m; }
  const unsigned char *t = p + 8*nb;
  switch (len & 7) { case 7: h ^= (uint64_t)t[6] << 48; case 6: h ^= (uint64_t)t[5] << 40; case 5: h ^= (uint64_t)t[4] << 32;
    case 4: h ^= (uint64_t)t[3] << 24; case 3: h ^= (uint64_t)t[2] << 16; case 2: h ^= (uint64_t)t[1] << 8; case 1: h ^= (uint64_t)t[0]; h *= m; }
  h ^= h >> r; h *= m; h ^= h >> r; return h; }
static inline uint64_t fnv1a64(const unsigned char *s, size_t n) { uint64_t h = 0xcbf29ce484222325ULL; for (size_t i = 0; i < n; i++) { h ^= s[i]; h *= 0x100000001b3ULL; } return h; }
static inline uint32_t java31(const unsigned char *s, size_t n) { uint32_t h = 0; for (size_t i = 0; i < n; i++) h = 31 * h + s[i]; return h; }
// Polynomial hash of a byte string at a random point a mod 2^61-1, then a
// 2-independent map y -> (b y + c) mod p; returned in the top 61 bits.
static inline uint64_t polycw(const unsigned char *s, size_t n, uint64_t a, uint64_t b, uint64_t c) {
  uint64_t h = 0; for (size_t i = 0; i < n; i++) h = addmod(mulmod(h, a), s[i] + 1);
  return addmod(mulmod(b, h), c) << 3; }
// The same polynomial over 7-byte characters (values < 2^56 < p), with the
// length as a final character so that strings of different lengths differ.
static inline uint64_t polycw7(const unsigned char *s, size_t n, uint64_t a, uint64_t b, uint64_t c) {
  uint64_t h = 0; size_t i = 0;
  for (; i + 7 <= n; i += 7) { uint64_t x; memcpy(&x, s + i, 8 <= n - i ? 8 : 7); x &= 0x00ffffffffffffffULL; h = addmod(mulmod(h, a), x); }
  if (i < n) { uint64_t x = 0; memcpy(&x, s + i, n - i); h = addmod(mulmod(h, a), x); }
  h = addmod(mulmod(h, a), n);
  return addmod(mulmod(b, h), c) << 3; }
static double sigma_(double x) { if (x == 1.0) return INFINITY; double y = 1, z = x, zp; do { x *= x; zp = z; z += x * y; y += y; } while (zp != z); return z; }
static double tau_(double x) { if (x == 0.0 || x == 1.0) return 0.0; double y = 1.0, z = 1 - x, zp; do { x = sqrt(x); zp = z; y *= 0.5; z -= (1 - x) * (1 - x) * y; } while (zp != z); return z / 3; }
static double ertl_est(const uint8_t *reg, int P, int hb) { int M = 1 << P, q = hb - P; int64_t C[72] = {0}; for (int j = 0; j < M; j++) C[reg[j]]++;
  double z = M * tau_((M - C[q + 1]) / (double)M); for (int k = q; k >= 1; --k) { z += C[k]; z *= 0.5; } z += M * sigma_(C[0] / (double)M);
  return 0.5 / log(2.0) * M * (double)M / z; }
static inline void hll_add(uint8_t *reg, int P, uint64_t h, int hb) { uint64_t j, w; uint8_t r;
  if (hb == 64) { j = h >> (64 - P); w = h << P; r = w ? __builtin_clzll(w) + 1 : 64 - P + 1; }
  else { uint32_t x = (uint32_t)h; j = x >> (32 - P); uint32_t w32 = x << P; r = w32 ? __builtin_clz(w32) + 1 : 32 - P + 1; }
  if (r > reg[j]) reg[j] = r; }
