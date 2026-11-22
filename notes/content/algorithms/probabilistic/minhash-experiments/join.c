// Exact similarity join: every pair of sets with Jaccard similarity >= T,
// by prefix filtering (Bayardo, Ma and Srikant, "Scaling up all pairs
// similarity search", WWW 2007). Tokens are reordered rarest first; sets are
// processed in increasing size; a set probes the inverted index with its
// first |x| - ceil(T|x|) + 1 tokens, skips candidates smaller than T|x|, and
// every candidate is verified by a full merge of the two sets.
//
// Usage: join T sets.u64 offsets.i64 > pairs.tsv   (lines: i j |x&y| |x|y| J)
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void *readall(const char *p, size_t *n) {
  FILE *f = fopen(p, "rb");
  fseek(f, 0, SEEK_END); *n = ftell(f); rewind(f);
  void *b = malloc(*n);
  if (fread(b, 1, *n, f) != *n) exit(2);
  fclose(f);
  return b;
}
static int cmpu64(const void *a, const void *b) {
  uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
  return (x > y) - (x < y);
}
static int cmpu32(const void *a, const void *b) {
  uint32_t x = *(const uint32_t *)a, y = *(const uint32_t *)b;
  return (x > y) - (x < y);
}
typedef struct { uint64_t v; uint32_t c; uint32_t id; } uq;
static int cmpfreq(const void *a, const void *b) {
  const uq *x = a, *y = b;
  if (x->c != y->c) return (x->c > y->c) - (x->c < y->c);
  return (x->v > y->v) - (x->v < y->v);
}
static size_t ndoc;
static int64_t *off;
static int cmpsize(const void *a, const void *b) {
  uint32_t x = *(const uint32_t *)a, y = *(const uint32_t *)b;
  int64_t sx = off[x + 1] - off[x], sy = off[y + 1] - off[y];
  if (sx != sy) return (sx > sy) - (sx < sy);
  return (x > y) - (x < y);
}

int main(int argc, char **argv) {
  double T = atof(argv[1]);
  size_t nb, no;
  uint64_t *tok = readall(argv[2], &nb);
  off = readall(argv[3], &no);
  ndoc = no / 8 - 1;
  size_t ntok = nb / 8;
  // Global token frequencies.
  uint64_t *all = malloc(nb);
  memcpy(all, tok, nb);
  qsort(all, ntok, 8, cmpu64);
  size_t nu = 0;
  uq *u = malloc(ntok * sizeof(uq));
  for (size_t i = 0; i < ntok;) {
    size_t j = i;
    while (j < ntok && all[j] == all[i]) j++;
    u[nu++] = (uq){all[i], (uint32_t)(j - i), 0};
    i = j;
  }
  free(all);
  // u is sorted by value; rank by (frequency, value).
  uq *byf = malloc(nu * sizeof(uq));
  memcpy(byf, u, nu * sizeof(uq));
  for (size_t i = 0; i < nu; i++) byf[i].id = (uint32_t)i;
  qsort(byf, nu, sizeof(uq), cmpfreq);
  uint32_t *rank = malloc(nu * 4);
  for (size_t r = 0; r < nu; r++) rank[byf[r].id] = (uint32_t)r;
  free(byf);
  // Each set as sorted ranks.
  uint32_t *rs = malloc(ntok * 4);
  for (size_t d = 0; d < ndoc; d++) {
    for (int64_t p = off[d]; p < off[d + 1]; p++) {
      size_t lo = 0, hi = nu;
      while (lo < hi) { size_t m = (lo + hi) / 2; if (u[m].v < tok[p]) lo = m + 1; else hi = m; }
      rs[p] = rank[lo];
    }
    qsort(rs + off[d], off[d + 1] - off[d], 4, cmpu32);
  }
  free(u); free(rank); free(tok);
  // Inverted index over prefix tokens, sized by a first pass.
  uint32_t *order = malloc(ndoc * 4);
  for (size_t d = 0; d < ndoc; d++) order[d] = (uint32_t)d;
  qsort(order, ndoc, 4, cmpsize);
  uint32_t *cnt = calloc(nu, 4);
  for (size_t d = 0; d < ndoc; d++) {
    int64_t s = off[d + 1] - off[d];
    int64_t pre = s - (int64_t)ceil(T * s - 1e-9) + 1;
    for (int64_t i = 0; i < pre; i++) cnt[rs[off[d] + i]]++;
  }
  uint64_t *start = malloc((nu + 1) * 8);
  start[0] = 0;
  for (size_t i = 0; i < nu; i++) start[i + 1] = start[i] + cnt[i];
  uint32_t *post = malloc(start[nu] * 4 + 4);
  memset(cnt, 0, nu * 4);
  uint32_t *stamp = malloc(ndoc * 4);
  for (size_t d = 0; d < ndoc; d++) stamp[d] = UINT32_MAX;
  uint32_t *cand = malloc(ndoc * 4);
  uint64_t verified = 0, found = 0;
  for (size_t oi = 0; oi < ndoc; oi++) {
    uint32_t x = order[oi];
    int64_t sx = off[x + 1] - off[x];
    int64_t pre = sx - (int64_t)ceil(T * sx - 1e-9) + 1;
    double minsize = T * sx - 1e-9;
    size_t nc = 0;
    for (int64_t i = 0; i < pre; i++) {
      uint32_t t = rs[off[x] + i];
      for (uint64_t p = start[t]; p < start[t] + cnt[t]; p++) {
        uint32_t y = post[p];
        if (stamp[y] == x) continue;
        stamp[y] = x;
        if ((double)(off[y + 1] - off[y]) >= minsize) cand[nc++] = y;
      }
    }
    for (size_t c = 0; c < nc; c++) {
      uint32_t y = cand[c];
      const uint32_t *a = rs + off[x], *b = rs + off[y];
      int64_t na = sx, nbb = off[y + 1] - off[y], i = 0, j = 0, inter = 0;
      while (i < na && j < nbb) { if (a[i] < b[j]) i++; else if (a[i] > b[j]) j++; else { inter++; i++; j++; } }
      verified++;
      double J = (double)inter / (double)(na + nbb - inter);
      if (J >= T - 1e-12) {
        found++;
        printf("%u\t%u\t%lld\t%lld\t%.6f\n", y < x ? y : x, y < x ? x : y, (long long)inter, (long long)(na + nbb - inter), J);
      }
    }
    for (int64_t i = 0; i < pre; i++) {
      uint32_t t = rs[off[x] + i];
      post[start[t] + cnt[t]++] = x;
    }
  }
  fprintf(stderr, "docs %zu tokens %zu distinct %zu verified %llu pairs %llu\n", ndoc, ntok, nu,
          (unsigned long long)verified, (unsigned long long)found);
  return 0;
}
