// Single-thread time per key of each hash function.  Integer families hash the
// 60,974,808 64-bit keys of distinct.bin; string functions hash the 5,843,219
// key strings of the hour-0 file (stdin), held in memory.  5 repetitions; the
// median is reported.  The outputs are folded into a checksum that is printed.
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <zlib.h>
#include "common.h"
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + 1e-9 * t.tv_nsec; }
static int dcmp(const void *a, const void *b) { double x = *(double *)a, y = *(double *)b; return x < y ? -1 : x > y; }
#define REP 5
int main(void) {
  FILE *f = fopen("distinct.bin", "rb"); fseek(f, 0, SEEK_END); long n = ftell(f) / 8; rewind(f);
  uint64_t *key = malloc(n * 8); if (fread(key, 8, n, f) != (size_t)n) return 1; fclose(f);
  uint64_t st = 99, a = sm(&st) | 1, b = sm(&st); u128 A = ((u128)sm(&st) << 64) | sm(&st), B = ((u128)sm(&st) << 64) | sm(&st);
  uint64_t c0 = sm(&st) % P61, c1 = sm(&st) % P61, c2 = sm(&st) % P61, c3 = sm(&st) % P61; static uint64_t T[8][256];
  for (int c = 0; c < 8; c++) for (int j = 0; j < 256; j++) T[c][j] = sm(&st);
  const char *in[] = {"ms", "mas", "cw", "poly4", "tab", "fmix"}; uint64_t chk = 0;
  for (int fam = 0; fam < 6; fam++) { double t[REP];
    for (int r = 0; r < REP; r++) { double t0 = now(); uint64_t acc = 0;
      switch (fam) {
        case 0: for (long i = 0; i < n; i++) acc += (a * key[i]) >> 50; break;
        case 1: for (long i = 0; i < n; i++) acc += (uint64_t)((A * key[i] + B) >> 64); break;
        case 2: for (long i = 0; i < n; i++) acc += addmod(mulmod(c0, key[i] % P61), c1); break;
        case 3: for (long i = 0; i < n; i++) { uint64_t y = key[i] % P61, h = c0; h = addmod(mulmod(h, y), c1); h = addmod(mulmod(h, y), c2); acc += addmod(mulmod(h, y), c3); } break;
        case 4: for (long i = 0; i < n; i++) { uint64_t x = key[i], h = 0; for (int c = 0; c < 8; c++) h ^= T[c][(x >> (8 * c)) & 255]; acc += h; } break;
        case 5: for (long i = 0; i < n; i++) acc += fmix64(key[i] ^ b); break; }
      t[r] = (now() - t0) / n * 1e9; chk ^= acc; }
    qsort(t, REP, sizeof(double), dcmp); printf("int %s %.3f %.3f %.3f\n", in[fam], t[REP / 2], t[0], t[REP - 1]); fflush(stdout); }
  // strings
  size_t cap = 1 << 28, used = 0; char *buf = malloc(cap); uint32_t *off = malloc(8000000 * 4), *ln = malloc(8000000 * 4); long ns = 0;
  char *line = NULL; size_t lc = 0; ssize_t len;
  while ((len = getline(&line, &lc, stdin)) > 0) { char *s1 = memchr(line, ' ', len); char *s2 = memchr(s1 + 1, ' ', len - (s1 + 1 - line)); size_t kl = s2 - line;
    memcpy(buf + used, line, kl); off[ns] = used; ln[ns] = kl; used += kl; ns++; }
  double tot = 0; for (long i = 0; i < ns; i++) tot += ln[i];
  printf("# strings %ld mean length %.2f\n", ns, tot / ns);
  const char *sn[] = {"java31", "fnv1a64", "murmur64a", "crc32", "polycw", "polycw7"};
  for (int fam = 0; fam < 6; fam++) { double t[REP];
    for (int r = 0; r < REP; r++) { double t0 = now(); uint64_t acc = 0;
      for (long i = 0; i < ns; i++) { const unsigned char *k = (unsigned char *)buf + off[i]; size_t l = ln[i];
        switch (fam) { case 0: acc += java31(k, l); break; case 1: acc += fnv1a64(k, l); break; case 2: acc += murmur64a(k, l, 0x9747b28cULL); break;
          case 3: acc += crc32(0L, k, l); break; case 4: acc += polycw(k, l, c0, c1 | 1, c2); break; case 5: acc += polycw7(k, l, c0, c1 | 1, c2); break; } }
      t[r] = (now() - t0) / ns * 1e9; chk ^= acc; }
    qsort(t, REP, sizeof(double), dcmp); printf("str %s %.3f %.3f %.3f\n", sn[fam], t[REP / 2], t[0], t[REP - 1]); fflush(stdout); }
  printf("# checksum %llu\n", (unsigned long long)chk); return 0; }
