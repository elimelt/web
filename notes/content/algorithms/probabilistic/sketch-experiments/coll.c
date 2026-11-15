#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <zlib.h>
static uint32_t fnv1a32(const unsigned char *s, size_t n) { uint32_t h = 0x811c9dc5u; for (size_t i = 0; i < n; i++) { h ^= s[i]; h *= 0x01000193u; } return h; }
static uint32_t java31(const unsigned char *s, size_t n) { uint32_t h = 0; for (size_t i = 0; i < n; i++) h = 31 * h + s[i]; return h; }
static int cmp(const void *a, const void *b) { uint32_t x = *(uint32_t *)a, y = *(uint32_t *)b; return x < y ? -1 : x > y; }
int main(void) { size_t cap = 0, n = 0, mx = 8000000; char *line = NULL; ssize_t len;
  uint32_t *H[3]; for (int i = 0; i < 3; i++) H[i] = malloc(mx * 4);
  while ((len = getline(&line, &cap, stdin)) > 0) { char *s1 = memchr(line, ' ', len); char *s2 = memchr(s1 + 1, ' ', len - (s1 + 1 - line)); size_t kl = s2 - line;
    H[0][n] = fnv1a32((unsigned char *)line, kl); H[1][n] = java31((unsigned char *)line, kl); H[2][n] = crc32(0, (unsigned char *)line, kl); n++; }
  long hist[3][16384] = {{0}};
  for (int i = 0; i < 3; i++) { qsort(H[i], n, 4, cmp); size_t d = 1; for (size_t j = 1; j < n; j++) d += H[i][j] != H[i][j - 1];
    for (size_t j = 0; j < n; j++) hist[i][H[i][j] >> 18]++;
    double mean = n / 16384.0, chi = 0; for (int b = 0; b < 16384; b++) chi += (hist[i][b] - mean) * (hist[i][b] - mean) / mean;
    double inv = 0; for (int b = 0; b < 16384; b++) inv += 1.0 / (hist[i][b] > 0 ? hist[i][b] : 1);
    printf("%s n %zu distinct %zu lost %zu chi2_index(df=16383) %.0f hm_over_am %.5f\n", i == 0 ? "fnv1a32" : i == 1 ? "java31" : "crc32", n, d, n - d, chi, 16384.0 / inv / mean); }
  printf("expected lost for random 32-bit: %.0f\n", (double)n * n / 2 / 4294967296.0);
}
