// Merging t-digest (Dunning, "The t-digest: Efficient estimates of
// distributions", Software Impacts 2021) with the k1 scale function
// k(q) = delta/(2 pi) asin(2q - 1). Values are buffered 10*delta at a time;
// a full buffer is sorted together with the centroids and merged left to
// right, a centroid absorbing its neighbour while its k-span stays within 1.
// Quantiles interpolate linearly between centroid centres, and between the
// minimum or maximum and the outermost centroid. Same algorithm as tdref.py.
//
// Usage: tdigest DELTA VALUES.i32 [GROUPS.i64] -- Q...
// With GROUPS (cumulative end offsets), one digest is built per group and the
// digests are then merged, as a distributed system would.
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { double m, w; } cen;
static double delta;

static double k1(double q) { return delta / (2 * M_PI) * asin(2 * q - 1); }
static double k1inv(double k) { return k >= delta / 4 ? 1.0 : (sin(k * 2 * M_PI / delta) + 1) / 2; }
static int cmp(const void *a, const void *b) {
  double x = ((const cen *)a)->m, y = ((const cen *)b)->m;
  return (x > y) - (x < y);
}

// Merges c[0..len) (any order) in place; returns the new length.
static size_t merge(cen *c, size_t len) {
  if (len == 0) return 0;
  // Stable sort by mean: qsort is not stable, so break ties by original index.
  // Ties only arise between equal means, whose order does not change the result
  // of a weighted mean, so plain qsort suffices here.
  qsort(c, len, sizeof(cen), cmp);
  double n = 0;
  for (size_t i = 0; i < len; i++) n += c[i].w;
  size_t o = 0;
  cen cur = c[0];
  double so_far = 0, qlim = k1inv(k1(0) + 1) * n;
  for (size_t i = 1; i < len; i++) {
    if (so_far + cur.w + c[i].w <= qlim) {
      cur.m = (cur.m * cur.w + c[i].m * c[i].w) / (cur.w + c[i].w);
      cur.w += c[i].w;
    } else {
      so_far += cur.w;
      c[o++] = cur;
      qlim = k1inv(k1(so_far / n) + 1) * n;
      cur = c[i];
    }
  }
  c[o++] = cur;
  return o;
}

typedef struct { cen *c; size_t len, cap; double lo, hi; } digest;

static void dg_init(digest *d) { d->cap = (size_t)(12 * delta) + 64; d->c = malloc(d->cap * sizeof(cen)); d->len = 0; d->lo = INFINITY; d->hi = -INFINITY; }

static void dg_add(digest *d, const int32_t *x, size_t n) {
  size_t buf = (size_t)(10 * delta);
  for (size_t s = 0; s < n; s += buf) {
    size_t e = s + buf < n ? s + buf : n;
    if (d->len + (e - s) > d->cap) { d->cap = d->len + (e - s) + 64; d->c = realloc(d->c, d->cap * sizeof(cen)); }
    for (size_t i = s; i < e; i++) {
      d->c[d->len++] = (cen){x[i], 1};
      if (x[i] < d->lo) d->lo = x[i];
      if (x[i] > d->hi) d->hi = x[i];
    }
    d->len = merge(d->c, d->len);
  }
}

static double dg_quantile(const digest *d, double q) {
  double n = 0;
  for (size_t i = 0; i < d->len; i++) n += d->c[i].w;
  double r = q * n, cum = 0;
  double first = d->c[0].w / 2;
  if (r <= first) return d->lo + (d->c[0].m - d->lo) * r / first;
  for (size_t i = 0; i + 1 < d->len; i++) {
    double a = cum + d->c[i].w / 2, b = cum + d->c[i].w + d->c[i + 1].w / 2;
    if (r < b) return d->c[i].m + (d->c[i + 1].m - d->c[i].m) * (r - a) / (b - a);
    cum += d->c[i].w;
  }
  double last = n - d->c[d->len - 1].w / 2;
  return d->c[d->len - 1].m + (d->hi - d->c[d->len - 1].m) * (r - last) / (n - last);
}

int main(int argc, char **argv) {
  delta = atof(argv[1]);
  FILE *f = fopen(argv[2], "rb");
  fseek(f, 0, SEEK_END); size_t n = ftell(f) / 4; rewind(f);
  int32_t *x = malloc(n * 4);
  if (fread(x, 4, n, f) != n) return 2;
  fclose(f);
  int a = 3;
  digest d; dg_init(&d);
  if (strcmp(argv[a], "--") != 0) {
    FILE *g = fopen(argv[a++], "rb");
    fseek(g, 0, SEEK_END); size_t ng = ftell(g) / 8; rewind(g);
    int64_t *ends = malloc(ng * 8);
    if (fread(ends, 8, ng, g) != ng) return 2;
    fclose(g);
    int64_t start = 0;
    for (size_t i = 0; i < ng; i++) {
      digest s; dg_init(&s);
      dg_add(&s, x + start, ends[i] - start);
      if (d.len + s.len > d.cap) { d.cap = 2 * (d.len + s.len); d.c = realloc(d.c, d.cap * sizeof(cen)); }
      memcpy(d.c + d.len, s.c, s.len * sizeof(cen));
      d.len = merge(d.c, d.len + s.len);
      if (s.lo < d.lo) d.lo = s.lo;
      if (s.hi > d.hi) d.hi = s.hi;
      free(s.c);
      start = ends[i];
    }
  } else {
    dg_add(&d, x, n);
  }
  for (a++; a < argc; a++) {
    double q = atof(argv[a]);
    printf("%.6f %.6f\n", q, dg_quantile(&d, q));
  }
  printf("centroids %zu\n", d.len);
  return 0;
}
