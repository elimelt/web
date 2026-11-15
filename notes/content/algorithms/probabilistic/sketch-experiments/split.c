// Decompose the HyperLogLog bias of the 31-polynomial (Java String.hashCode)
// hash on hour 0: index bits and rho bits taken from different hashes.
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
static uint32_t java31(const unsigned char *s, size_t n) { uint32_t h = 0; for (size_t i = 0; i < n; i++) h = 31 * h + s[i]; return h; }
static uint64_t fnv64(const unsigned char *s, size_t n) { uint64_t h = 0xcbf29ce484222325ull; for (size_t i = 0; i < n; i++) { h ^= s[i]; h *= 0x100000001b3ull; } return h; }
static uint64_t fmix(uint64_t z) { z = (z ^ (z >> 33)) * 0xff51afd7ed558ccdull; z = (z ^ (z >> 33)) * 0xc4ceb9fe1a85ec53ull; return z ^ (z >> 33); }
#define P 14
#define M (1 << P)
static unsigned char R[4][M];
static void upd(unsigned char *r, uint32_t idx, uint32_t rest18) { int rho = 1; for (int b = 17; b >= 0 && !((rest18 >> b) & 1); b--) rho++; if (rho > r[idx]) r[idx] = rho; }
static double raw(unsigned char *r) { double z = 0; for (int j = 0; j < M; j++) z += ldexp(1.0, -r[j]); return 0.7213 / (1 + 1.079 / M) * (double)M * M / z; }
int main(void) { size_t cap = 0, n = 0; char *line = NULL; ssize_t len; long rh[2][20] = {{0}};
  while ((len = getline(&line, &cap, stdin)) > 0) { char *s1 = memchr(line, ' ', len); char *s2 = memchr(s1 + 1, ' ', len - (s1 + 1 - line)); size_t kl = s2 - line;
    uint32_t j = java31((unsigned char *)line, kl); uint32_t g = (uint32_t)(fmix(fnv64((unsigned char *)line, kl)) >> 32);
    upd(R[0], j >> 18, j & 0x3ffff); upd(R[1], g >> 18, j & 0x3ffff); upd(R[2], j >> 18, g & 0x3ffff); upd(R[3], g >> 18, g & 0x3ffff);
    for (int k = 0; k < 2; k++) { uint32_t rest = (k ? g : j) & 0x3ffff; int rho = 1; for (int b = 17; b >= 0 && !((rest >> b) & 1); b--) rho++; rh[k][rho < 19 ? rho : 19]++; }
    n++; }
  const char *nm[4] = {"java31 index, java31 rho", "good index, java31 rho", "java31 index, good rho", "good index, good rho"};
  for (int k = 0; k < 4; k++) printf("%-26s %+.4f\n", nm[k], raw(R[k]) / n - 1);
  printf("rho distribution (count/expected) for rho = 1..8:\n");
  for (int k = 0; k < 2; k++) { printf("%s", k ? "good  " : "java31"); for (int r = 1; r <= 8; r++) printf(" %.4f", rh[k][r] / (n * ldexp(1.0, -r))); long t = 0; for (int r = 9; r <= 19; r++) t += rh[k][r]; printf(" | rho>=9 %.4f", t / (n * ldexp(1.0, -8))); printf("\n"); }
}
