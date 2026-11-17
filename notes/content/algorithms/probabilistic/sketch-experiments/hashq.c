// HyperLogLog (p = 14) on each hour of Wikimedia pageviews and on the whole day
// with several fixed, unseeded hash functions applied to the raw keys
// "domain_code page_title".  Each hour file lists each key once, so the true
// hourly cardinality is its line count; the day's true count is 60,974,808.
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <zlib.h>
static uint64_t murmur64a(const void *key, size_t len, uint64_t seed) {
  const uint64_t m = 0xc6a4a7935bd1e995ULL; const int r = 47; uint64_t h = seed ^ (len * m);
  const unsigned char *p = key; size_t nb = len / 8;
  for (size_t i = 0; i < nb; i++) { uint64_t k; memcpy(&k, p + 8*i, 8); k *= m; k ^= k >> r; k *= m; h ^= k; h *= m; }
  const unsigned char *t = p + 8*nb;
  switch (len & 7) { case 7: h ^= (uint64_t)t[6] << 48; case 6: h ^= (uint64_t)t[5] << 40; case 5: h ^= (uint64_t)t[4] << 32;
    case 4: h ^= (uint64_t)t[3] << 24; case 3: h ^= (uint64_t)t[2] << 16; case 2: h ^= (uint64_t)t[1] << 8; case 1: h ^= (uint64_t)t[0]; h *= m; }
  h ^= h >> r; h *= m; h ^= h >> r; return h;
}
static uint64_t fnv1a64(const unsigned char *s, size_t n) { uint64_t h = 0xcbf29ce484222325ULL; for (size_t i = 0; i < n; i++) { h ^= s[i]; h *= 0x100000001b3ULL; } return h; }
static uint32_t fnv1a32(const unsigned char *s, size_t n) { uint32_t h = 0x811c9dc5u; for (size_t i = 0; i < n; i++) { h ^= s[i]; h *= 0x01000193u; } return h; }
static uint32_t java31(const unsigned char *s, size_t n) { uint32_t h = 0; for (size_t i = 0; i < n; i++) h = 31 * h + s[i]; return h; }
static double sigma_(double x) { if (x == 1.0) return INFINITY; double y = 1, z = x, zp; do { x *= x; zp = z; z += x * y; y += y; } while (zp != z); return z; }
static double tau_(double x) { if (x == 0.0 || x == 1.0) return 0.0; double y = 1.0, z = 1 - x, zp; do { x = sqrt(x); zp = z; y *= 0.5; z -= (1 - x) * (1 - x) * y; } while (zp != z); return z / 3; }
#define P 14
#define M (1 << P)
#define NH 5
static const char *names[NH] = {"murmur64a", "fnv1a64", "fnv1a32", "java31", "crc32"};
static const int bits[NH] = {64, 64, 32, 32, 32};
static double est(const uint8_t *reg, int hb) { int q = hb - P; int64_t C[70] = {0}; for (int j = 0; j < M; j++) C[reg[j]]++;
  double z = M * tau_((M - C[q + 1]) / (double)M); for (int k = q; k >= 1; --k) { z += C[k]; z *= 0.5; } z += M * sigma_(C[0] / (double)M);
  return 0.5 / log(2.0) * M * (double)M / z; }
static inline void add(uint8_t *reg, uint64_t h, int hb) { uint64_t j, w; uint8_t r;
  if (hb == 64) { j = h >> (64 - P); w = h << P; r = w ? __builtin_clzll(w) + 1 : 64 - P + 1; }
  else { uint32_t x = (uint32_t)h; j = x >> (32 - P); uint32_t w32 = x << P; r = w32 ? __builtin_clz(w32) + 1 : 32 - P + 1; }
  if (r > reg[j]) reg[j] = r; }
int main(void) {
  uint8_t *hr[NH], *day[NH]; for (int i = 0; i < NH; i++) { hr[i] = calloc(M, 1); day[i] = calloc(M, 1); }
  char *line = NULL; size_t cap = 0; ssize_t len; long nl = 0; int hour = -1;
  printf("hour true"); for (int i = 0; i < NH; i++) printf(" %s", names[i]); printf("\n");
  for (;;) { len = getline(&line, &cap, stdin);
    if (len <= 0 || (line[0] == '#' && line[1] == 'H')) {
      if (hour >= 0) { printf("%d %ld", hour, nl); for (int i = 0; i < NH; i++) { printf(" %.6f", est(hr[i], bits[i]) / nl - 1);
          for (int j = 0; j < M; j++) if (hr[i][j] > day[i][j]) day[i][j] = hr[i][j]; memset(hr[i], 0, M); } printf("\n"); fflush(stdout); }
      if (len <= 0) break; hour++; nl = 0; continue; }
    char *s1 = memchr(line, ' ', len); char *s2 = memchr(s1 + 1, ' ', len - (s1 + 1 - line)); size_t kl = s2 - line;
    const unsigned char *k = (unsigned char *)line; nl++;
    add(hr[0], murmur64a(k, kl, 0x9747b28cULL), 64); add(hr[1], fnv1a64(k, kl), 64); add(hr[2], fnv1a32(k, kl), 32);
    add(hr[3], java31(k, kl), 32); add(hr[4], crc32(0L, k, kl), 32); }
  printf("day 60974808"); for (int i = 0; i < NH; i++) printf(" %.6f", est(day[i], bits[i]) / 60974808.0 - 1); printf("\n");
  return 0;
}
