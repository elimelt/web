// Edit distance (unit gap and mismatch costs) three ways, for the alignment
// section of the dynamic programming note:
//   full  - the whole (m+1) x (n+1) table plus a traceback (int32 cells)
//   rows  - two rows, cost only
//   hirsch - Hirschberg's divide and conquer: the alignment in linear space
// Sequences are random DNA from a seeded xorshift generator; y is x with about
// 5% of positions substituted, deleted or followed by an insertion.
//
//   gcc -O2 -o align align.c
//   ./align MODE N SEED     -> prints: mode n seed cost seconds peak_rss_kib
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <time.h>

static uint64_t s64;
static uint64_t next(void) { s64 ^= s64 << 13; s64 ^= s64 >> 7; s64 ^= s64 << 17; return s64; }
static int imin(int a, int b) { return a < b ? a : b; }

static void make(int n, uint64_t seed, char **xo, int *mo, char **yo, int *no) {
  s64 = seed * 0x9E3779B97F4A7C15ULL + 1;
  const char *A = "ACGT";
  char *x = malloc(n + 1), *y = malloc(2 * n + 2);
  for (int i = 0; i < n; i++) x[i] = A[next() & 3];
  int k = 0;
  for (int i = 0; i < n; i++) {
    uint64_t r = next() % 1000;
    if (r < 17) y[k++] = A[(strchr(A, x[i]) - A + 1 + next() % 3) & 3]; // substitute
    else if (r < 34) {}                                                   // delete
    else if (r < 50) { y[k++] = x[i]; y[k++] = A[next() & 3]; }          // insert after
    else y[k++] = x[i];
  }
  x[n] = 0; y[k] = 0;
  *xo = x; *mo = n; *yo = y; *no = k;
}

static int rows_cost(const char *x, int m, const char *y, int n) {
  int *a = malloc((n + 1) * sizeof(int)), *b = malloc((n + 1) * sizeof(int));
  for (int j = 0; j <= n; j++) a[j] = j;
  for (int i = 1; i <= m; i++) {
    b[0] = i;
    char xi = x[i - 1];
    for (int j = 1; j <= n; j++) {
      int d = a[j - 1] + (xi != y[j - 1]);
      int u = a[j] + 1, l = b[j - 1] + 1;
      b[j] = imin(d, imin(u, l));
    }
    int *t = a; a = b; b = t;
  }
  int c = a[n];
  free(a); free(b);
  return c;
}

static int full_cost(const char *x, int m, const char *y, int n, long *alen) {
  size_t w = (size_t)n + 1;
  int *M = malloc((size_t)(m + 1) * w * sizeof(int));
  if (!M) { fprintf(stderr, "out of memory\n"); exit(1); }
  for (size_t j = 0; j <= (size_t)n; j++) M[j] = j;
  for (int i = 1; i <= m; i++) {
    int *p = M + (size_t)(i - 1) * w, *c = M + (size_t)i * w;
    c[0] = i;
    char xi = x[i - 1];
    for (int j = 1; j <= n; j++) {
      int d = p[j - 1] + (xi != y[j - 1]);
      c[j] = imin(d, imin(p[j] + 1, c[j - 1] + 1));
    }
  }
  // traceback, counting alignment columns
  long cols = 0; int i = m, j = n;
  while (i > 0 || j > 0) {
    int v = M[(size_t)i * w + j];
    if (i > 0 && j > 0 && v == M[(size_t)(i - 1) * w + j - 1] + (x[i - 1] != y[j - 1])) { i--; j--; }
    else if (i > 0 && v == M[(size_t)(i - 1) * w + j] + 1) i--;
    else j--;
    cols++;
  }
  *alen = cols;
  int c = M[(size_t)m * w + n];
  free(M);
  return c;
}

// Hirschberg: returns the cost, adds alignment columns to *cols.
static int *F, *T1, *T2;
static int hirsch(const char *x, int m, const char *y, int n, long *cols) {
  if (m == 0) { *cols += n; return n; }
  if (n == 0) { *cols += m; return m; }
  if (m == 1) {
    int best = 1 + n, hit = 0; // delete x[0], insert all of y
    for (int j = 0; j < n; j++) if (y[j] == x[0]) { hit = 1; break; }
    int c = hit ? n - 1 : n; // match/mismatch x[0] with one y char, insert the rest
    if (c < best) best = c;
    *cols += (best == 1 + n) ? n + 1 : n;
    return best;
  }
  int mid = m / 2;
  // forward: x[0..mid) vs y prefixes
  for (int j = 0; j <= n; j++) T1[j] = j;
  for (int i = 1; i <= mid; i++) {
    T2[0] = i;
    for (int j = 1; j <= n; j++) T2[j] = imin(T1[j - 1] + (x[i - 1] != y[j - 1]), imin(T1[j] + 1, T2[j - 1] + 1));
    int *t = T1; T1 = T2; T2 = t;
  }
  memcpy(F, T1, (n + 1) * sizeof(int));
  // backward: x[mid..m) reversed vs y suffixes reversed
  for (int j = 0; j <= n; j++) T1[j] = j;
  for (int i = 1; i <= m - mid; i++) {
    T2[0] = i;
    char xi = x[m - i];
    for (int j = 1; j <= n; j++) T2[j] = imin(T1[j - 1] + (xi != y[n - j]), imin(T1[j] + 1, T2[j - 1] + 1));
    int *t = T1; T1 = T2; T2 = t;
  }
  int split = 0, best = 1 << 30;
  for (int j = 0; j <= n; j++) { int v = F[j] + T1[n - j]; if (v < best) { best = v; split = j; } }
  int a = hirsch(x, mid, y, split, cols);
  int b = hirsch(x + mid, m - mid, y + split, n - split, cols);
  if (a + b != best) { fprintf(stderr, "hirschberg mismatch %d+%d!=%d\n", a, b, best); exit(2); }
  return best;
}

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: align full|rows|hirsch N SEED\n"); return 1; }
  const char *mode = argv[1]; int N = atoi(argv[2]); uint64_t seed = strtoull(argv[3], 0, 10);
  char *x, *y; int m, n;
  make(N, seed, &x, &m, &y, &n);
  struct timespec t0, t1;
  long cols = 0; int cost;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  if (!strcmp(mode, "full")) cost = full_cost(x, m, y, n, &cols);
  else if (!strcmp(mode, "rows")) cost = rows_cost(x, m, y, n);
  else {
    F = malloc((n + 1) * sizeof(int)); T1 = malloc((n + 1) * sizeof(int)); T2 = malloc((n + 1) * sizeof(int));
    cost = hirsch(x, m, y, n, &cols);
  }
  clock_gettime(CLOCK_MONOTONIC, &t1);
  struct rusage ru; getrusage(RUSAGE_SELF, &ru);
  double s = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;
  printf("%s %d %d %llu %d %.4f %ld %ld\n", mode, m, n, (unsigned long long)seed, cost, s, ru.ru_maxrss, cols);
  return 0;
}
