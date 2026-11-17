// Reads hourly Wikimedia pageview files (domain_code title count size) from stdin
// ("#H" separator lines mark hour boundaries, inserted by the driver script)
// and writes:
//   stream.bin : records {uint64 key_hash, uint32 count} in input order
//   distinct.bin : uint64 key_hash in order of first appearance
//   agg.bin : {uint64 key_hash, uint64 total_count} for each distinct key
//   meta.txt : line counts, distinct counts per hour boundary, total views
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>

static uint64_t murmur64a(const void *key, size_t len, uint64_t seed) {
  const uint64_t m = 0xc6a4a7935bd1e995ULL; const int r = 47;
  uint64_t h = seed ^ (len * m);
  const unsigned char *p = key; size_t nb = len / 8;
  for (size_t i = 0; i < nb; i++) { uint64_t k; memcpy(&k, p + 8*i, 8);
    k *= m; k ^= k >> r; k *= m; h ^= k; h *= m; }
  const unsigned char *t = p + 8*nb;
  switch (len & 7) {
    case 7: h ^= (uint64_t)t[6] << 48; case 6: h ^= (uint64_t)t[5] << 40;
    case 5: h ^= (uint64_t)t[4] << 32; case 4: h ^= (uint64_t)t[3] << 24;
    case 3: h ^= (uint64_t)t[2] << 16; case 2: h ^= (uint64_t)t[1] << 8;
    case 1: h ^= (uint64_t)t[0]; h *= m; }
  h ^= h >> r; h *= m; h ^= h >> r; return h;
}

#define LOGCAP 27
#define CAP (1ULL << LOGCAP)
typedef struct { uint64_t k; uint64_t c; } slot;

int main(void) {
  slot *tab = calloc(CAP, sizeof(slot));
  FILE *fs = fopen("stream.bin", "wb"), *fd = fopen("distinct.bin", "wb");
  FILE *fm = fopen("meta.txt", "w");
  char *line = NULL; size_t lcap = 0; ssize_t len;
  uint64_t nlines = 0, ndist = 0, views = 0, bad = 0, zero = 0; int hour = -1;
  while ((len = getline(&line, &lcap, stdin)) > 0) {
    if (line[0] == '#' && line[1] == 'H') {
      if (hour >= 0) fprintf(fm, "hour %d lines %llu distinct %llu views %llu\n", hour,
        (unsigned long long)nlines, (unsigned long long)ndist, (unsigned long long)views);
      hour++; continue; }
    // fields: domain title count size ; key = "domain title"
    char *s1 = memchr(line, ' ', len); if (!s1) { bad++; continue; }
    char *s2 = memchr(s1 + 1, ' ', len - (s1 + 1 - line)); if (!s2) { bad++; continue; }
    unsigned long c = strtoul(s2 + 1, NULL, 10);
    if (c == 0) { zero++; continue; }
    uint64_t h = murmur64a(line, s2 - line, 0x9747b28cULL);
    if (h == 0) h = 1; // 0 marks empty slot
    uint32_t c32 = (uint32_t)c;
    fwrite(&h, 8, 1, fs); fwrite(&c32, 4, 1, fs);
    nlines++; views += c;
    uint64_t i = h >> (64 - LOGCAP);
    for (;;) { if (tab[i].k == h) { tab[i].c += c; break; }
      if (tab[i].k == 0) { tab[i].k = h; tab[i].c = c; ndist++; fwrite(&h, 8, 1, fd);
        if (ndist > CAP * 0.8) { fprintf(stderr, "table full\n"); return 1; } break; }
      i = (i + 1) & (CAP - 1); }
  }
  fprintf(fm, "hour %d lines %llu distinct %llu views %llu\n", hour,
    (unsigned long long)nlines, (unsigned long long)ndist, (unsigned long long)views);
  fprintf(fm, "bad %llu zero %llu\n", (unsigned long long)bad, (unsigned long long)zero);
  FILE *fa = fopen("agg.bin", "wb");
  for (uint64_t i = 0; i < CAP; i++) if (tab[i].k) fwrite(&tab[i], sizeof(slot), 1, fa);
  fclose(fa); fclose(fs); fclose(fd); fclose(fm);
  fprintf(stderr, "lines %llu distinct %llu views %llu\n", (unsigned long long)nlines,
    (unsigned long long)ndist, (unsigned long long)views);
  return 0;
}
