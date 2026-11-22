// Greenwald-Khanna quantile summary, in the form most implementations use:
// a sorted array of tuples (v, g, delta), a new value inserted with
// delta = floor(2 eps n) (0 at either end), and a compress pass every
// floor(1/(2 eps)) insertions that merges a tuple into its successor when
// g_i + g_{i+1} + delta_{i+1} <= floor(2 eps n). The band structure of the
// original paper's COMPRESS is omitted.
//
// Usage: gk EPS VALUES.i32 QUANTILES... ; prints, for each quantile, the
// estimate, then the number of tuples at the end and the largest seen.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

typedef struct { int32_t v; int64_t g, d; } tup;
static tup *T; static size_t S, cap, maxS;

static void compress(int64_t lim) {
  if (S < 3) return;
  tup *o = T;
  // Walk right to left, merging T[i] into the next kept tuple T[k] when allowed.
  size_t k = S - 1;
  for (size_t i = S - 1; i-- > 1;) {
    if (o[i].g + o[k].g + o[k].d <= lim) { o[k].g += o[i].g; o[i].g = 0; }
    else k = i;
  }
  size_t j = 0;
  for (size_t i = 0; i < S; i++) if (o[i].g > 0) o[j++] = o[i];
  S = j;
}

int main(int argc, char **argv) {
  double eps = atof(argv[1]);
  FILE *f = fopen(argv[2], "rb");
  fseek(f, 0, SEEK_END); size_t n = ftell(f) / 4; rewind(f);
  int32_t *x = malloc(n * 4);
  if (fread(x, 4, n, f) != n) return 2;
  fclose(f);
  cap = 1 << 16; T = malloc(cap * sizeof(tup)); S = 0;
  int64_t period = (int64_t)floor(1.0 / (2 * eps)); if (period < 1) period = 1;
  for (size_t t = 0; t < n; t++) {
    int32_t v = x[t];
    // First index with T[i].v > v (insert after equal values).
    size_t lo = 0, hi = S;
    while (lo < hi) { size_t m = (lo + hi) / 2; if (T[m].v <= v) lo = m + 1; else hi = m; }
    int64_t d = (lo == 0 || lo == S) ? 0 : (int64_t)floor(2 * eps * (double)t);
    if (S == cap) { cap *= 2; T = realloc(T, cap * sizeof(tup)); }
    memmove(T + lo + 1, T + lo, (S - lo) * sizeof(tup));
    T[lo] = (tup){v, 1, d}; S++;
    if (S > maxS) maxS = S;
    if ((int64_t)(t + 1) % period == 0) compress((int64_t)floor(2 * eps * (double)(t + 1)));
  }
  // Query: smallest i with rmax(i) > r + eps n, answer v_{i-1}; equivalently the
  // tuple whose [rmin, rmax] lies within eps n of r.
  double en = eps * (double)n;
  for (int a = 3; a < argc; a++) {
    double q = atof(argv[a]);
    double r = ceil(q * (double)n);
    int64_t rmin = 0; int32_t ans = T[S - 1].v;
    for (size_t i = 0; i < S; i++) {
      rmin += T[i].g;
      double rmax = (double)(rmin + T[i].d);
      if (rmax > r + en) { ans = i ? T[i - 1].v : T[0].v; break; }
    }
    printf("%.6f %d\n", q, ans);
  }
  printf("tuples %zu max %zu\n", S, maxS);
  return 0;
}
