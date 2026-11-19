// HyperLogLog (p = 14, Ertl's estimator) on each hour and the whole day of
// pageview keys with string hashes: Java's base-31 polynomial (32 bits), the
// same followed by MurmurHash3's fmix32, MurmurHash64A, and a polynomial at a
// random point mod 2^61-1 composed with a 2-independent map (S seeds).
// Input: hourly files separated by lines "#H".  Output: relative errors.
#include <stdio.h>
#include <stdlib.h>
#include "common.h"
#define P 14
#define M (1 << P)
#define S 8
#define NH (3 + S)
int main(void) {
  uint64_t A[S], B[S], C[S]; uint64_t st = 2026; for (int s = 0; s < S; s++) { A[s] = sm(&st) % P61; B[s] = sm(&st) % (P61 - 1) + 1; C[s] = sm(&st) % P61; }
  const int bits[NH] = {32, 32, 64, 64, 64, 64, 64, 64, 64, 64, 64};
  uint8_t *hr[NH], *day[NH]; for (int i = 0; i < NH; i++) { hr[i] = calloc(M, 1); day[i] = calloc(M, 1); }
  char *line = NULL; size_t cap = 0; ssize_t len; long nl = 0; int hour = -1;
  printf("hour true java31 java31_fmix32 murmur64a"); for (int s = 0; s < S; s++) printf(" polycw%d", s); printf("\n");
  for (;;) { len = getline(&line, &cap, stdin);
    if (len <= 0 || (line[0] == '#' && line[1] == 'H')) {
      if (hour >= 0) { printf("%d %ld", hour, nl); for (int i = 0; i < NH; i++) { printf(" %.6f", ertl_est(hr[i], P, bits[i]) / nl - 1);
          for (int j = 0; j < M; j++) if (hr[i][j] > day[i][j]) day[i][j] = hr[i][j]; memset(hr[i], 0, M); } printf("\n"); fflush(stdout); }
      if (len <= 0) break; hour++; nl = 0; continue; }
    char *s1 = memchr(line, ' ', len); char *s2 = memchr(s1 + 1, ' ', len - (s1 + 1 - line)); size_t kl = s2 - line;
    const unsigned char *k = (unsigned char *)line; nl++;
    uint32_t j = java31(k, kl); hll_add(hr[0], P, j, 32); hll_add(hr[1], P, fmix32(j), 32); hll_add(hr[2], P, murmur64a(k, kl, 0x9747b28cULL), 64);
    for (int s = 0; s < S; s++) hll_add(hr[3 + s], P, polycw(k, kl, A[s], B[s], C[s]), 64); }
  printf("day 60974808"); for (int i = 0; i < NH; i++) printf(" %.6f", ertl_est(day[i], P, bits[i]) / 60974808.0 - 1); printf("\n");
  return 0; }
