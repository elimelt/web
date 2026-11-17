// Y = X W for a "skinny" X (M = 1..64 rows), written for this shape: W is stored transposed
// (Wt is N x K, one row per output column) so every byte of W streams from DRAM once, and
// a 4 x 4 block of dot products is accumulated in registers.
// Build: gcc -O3 -march=native -fopenmp skinny.c -o skinny
// Usage: OMP_NUM_THREADS=4 ./skinny 16384        (prints one JSON object per M)
//        ./skinny check                           (compares against a naive loop)
#include <immintrin.h>
#include <math.h>
#include <omp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec * 1e-9;
}
static int cmpd(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return (x > y) - (x < y);
}

// MR rows of X against 4 rows of Wt; K must be a multiple of 16.
#define BLOCK(MR)                                                                         \
  static void block##MR(const float *X, const float *Wt, float *Y, long K, long N, long m0, \
                        long n0) {                                                        \
    __m512 acc[MR][4];                                                                    \
    for (int i = 0; i < MR; i++)                                                          \
      for (int j = 0; j < 4; j++) acc[i][j] = _mm512_setzero_ps();                        \
    for (long k = 0; k < K; k += 16) {                                                    \
      __m512 w[4];                                                                        \
      for (int j = 0; j < 4; j++) w[j] = _mm512_loadu_ps(Wt + (n0 + j) * K + k);          \
      for (int i = 0; i < MR; i++) {                                                      \
        __m512 x = _mm512_loadu_ps(X + (m0 + i) * K + k);                                 \
        for (int j = 0; j < 4; j++) acc[i][j] = _mm512_fmadd_ps(x, w[j], acc[i][j]);      \
      }                                                                                   \
    }                                                                                     \
    for (int i = 0; i < MR; i++)                                                          \
      for (int j = 0; j < 4; j++) Y[(m0 + i) * N + n0 + j] = _mm512_reduce_add_ps(acc[i][j]); \
  }
BLOCK(1)
BLOCK(2)
BLOCK(4)

// Threads split the N output columns; each 4-row block of Wt is read from DRAM by the
// first row group and from cache by the rest.
static void skinny(const float *X, const float *Wt, float *Y, long M, long K, long N) {
#pragma omp parallel for schedule(static)
  for (long n0 = 0; n0 < N; n0 += 4) {
    long m0 = 0;
    for (; m0 + 4 <= M; m0 += 4) block4(X, Wt, Y, K, N, m0, n0);
    for (; m0 + 2 <= M; m0 += 2) block2(X, Wt, Y, K, N, m0, n0);
    for (; m0 < M; m0++) block1(X, Wt, Y, K, N, m0, n0);
  }
}

static float *rnd(long n, unsigned s) {
  float *p = aligned_alloc(64, ((n * 4 + 63) / 64) * 64);
#pragma omp parallel for
  for (long i = 0; i < n; i++) {
    unsigned h = (unsigned)i * 2654435761u ^ s;
    h ^= h >> 15; h *= 2246822519u; h ^= h >> 13;
    p[i] = (float)(h & 0xffff) / 65536.0f - 0.5f;
  }
  return p;
}

int main(int argc, char **argv) {
  if (argc >= 2 && !strcmp(argv[1], "check")) {
    long K = 512, N = 72;
    for (long M = 1; M <= 9; M++) {
      float *X = rnd(M * K, 1), *Wt = rnd(N * K, 2), *Y = rnd(M * N, 3);
      skinny(X, Wt, Y, M, K, N);
      double err = 0;
      for (long m = 0; m < M; m++)
        for (long n = 0; n < N; n++) {
          double s = 0;
          for (long k = 0; k < K; k++) s += (double)X[m * K + k] * Wt[n * K + k];
          err = fmax(err, fabs(s - Y[m * N + n]));
        }
      printf("M=%ld max abs err %.2e\n", M, err);
      if (err > 1e-3) return 1;
      free(X); free(Wt); free(Y);
    }
    return 0;
  }
  long K = atol(argv[1]), N = K;
  float *Wt = rnd(N * K, 2);
  int Ms[] = {1, 2, 4, 8, 16, 32, 64};
  for (unsigned q = 0; q < sizeof Ms / sizeof Ms[0]; q++) {
    long M = Ms[q];
    float *X = rnd(M * K, 1), *Y = rnd(M * N, 3);
    skinny(X, Wt, Y, M, K, N);
    long calls = 1;
    for (;;) {
      double t0 = now();
      for (long c = 0; c < calls; c++) skinny(X, Wt, Y, M, K, N);
      if (now() - t0 > 0.2) break;
      calls *= 2;
    }
    double g[7];
    for (int r = 0; r < 7; r++) {
      double t0 = now();
      for (long c = 0; c < calls; c++) skinny(X, Wt, Y, M, K, N);
      g[r] = 2.0 * M * K * N * calls / (now() - t0) / 1e9;
    }
    qsort(g, 7, sizeof g[0], cmpd);
    double ai = 2.0 * M * K * N / (4.0 * (M * K + K * N + M * N));
    printf("{\"kind\":\"skinny\",\"K\":%ld,\"N\":%ld,\"M\":%ld,\"threads\":%d,\"intensity\":%.4f,"
           "\"gflops_median\":%.2f,\"gflops_min\":%.2f,\"gflops_max\":%.2f}\n",
           K, N, M, omp_get_max_threads(), ai, g[3], g[0], g[6]);
    fflush(stdout);
    free(X); free(Y);
  }
  return 0;
}
