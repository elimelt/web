// Empirical roofline for one x86-64 machine with AVX-512.
// Build: gcc -O3 -march=native -fopenmp roofline.c -o roofline
// Usage: ./roofline peak                 -> FP32 FMA peak (zmm, ymm, scalar) per thread count
//        ./roofline sweep BYTES           -> intensity sweep on a working set of BYTES (total)
//        ./roofline read BYTES            -> read-only bandwidth (a sum) on a working set of BYTES
// Thread count comes from OMP_NUM_THREADS. Output is one JSON object per line.
#define _GNU_SOURCE
#include <immintrin.h>
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

#define REPS 7

// ---------- peak: 16 independent FMA chains per thread ----------
static double peak_zmm(long iters) {
  double flops = 0;
#pragma omp parallel reduction(+ : flops)
  {
    __m512 a = _mm512_set1_ps(0.999999f), b = _mm512_set1_ps(1e-7f);
    __m512 r[16];
    for (int j = 0; j < 16; j++) r[j] = _mm512_set1_ps((float)(j + omp_get_thread_num()));
    for (long i = 0; i < iters; i++)
      for (int j = 0; j < 16; j++) r[j] = _mm512_fmadd_ps(r[j], a, b);
    __m512 s = r[0];
    for (int j = 1; j < 16; j++) s = _mm512_add_ps(s, r[j]);
    volatile float sink = _mm512_reduce_add_ps(s);
    (void)sink;
    flops += (double)iters * 16 * 16 * 2;
  }
  return flops;
}

static double peak_ymm(long iters) {
  double flops = 0;
#pragma omp parallel reduction(+ : flops)
  {
    __m256 a = _mm256_set1_ps(0.999999f), b = _mm256_set1_ps(1e-7f);
    __m256 r[12];
    for (int j = 0; j < 12; j++) r[j] = _mm256_set1_ps((float)(j + omp_get_thread_num()));
    for (long i = 0; i < iters; i++)
      for (int j = 0; j < 12; j++) r[j] = _mm256_fmadd_ps(r[j], a, b);
    __m256 s = r[0];
    for (int j = 1; j < 12; j++) s = _mm256_add_ps(s, r[j]);
    float out[8];
    _mm256_storeu_ps(out, s);
    volatile float sink = out[0];
    (void)sink;
    flops += (double)iters * 12 * 8 * 2;
  }
  return flops;
}

static double peak_scalar(long iters) {
  double flops = 0;
#pragma omp parallel reduction(+ : flops)
  {
    __m128 a = _mm_set_ss(0.999999f), b = _mm_set_ss(1e-7f);
    __m128 r[12];
    for (int j = 0; j < 12; j++) r[j] = _mm_set_ss((float)(j + omp_get_thread_num()));
    for (long i = 0; i < iters; i++)
      for (int j = 0; j < 12; j++) r[j] = _mm_fmadd_ss(r[j], a, b);
    __m128 s = r[0];
    for (int j = 1; j < 12; j++) s = _mm_add_ss(s, r[j]);
    volatile float sink = _mm_cvtss_f32(s);
    (void)sink;
    flops += (double)iters * 12 * 1 * 2;
  }
  return flops;
}

static void run_peak(const char *name, double (*f)(long), long iters) {
  f(iters / 10);  // warm up
  double g[REPS];
  for (int r = 0; r < REPS; r++) {
    double t0 = now();
    double fl = f(iters);
    g[r] = fl / (now() - t0) / 1e9;
  }
  qsort(g, REPS, sizeof g[0], cmpd);
  printf("{\"kind\":\"peak\",\"isa\":\"%s\",\"threads\":%d,\"gflops_median\":%.2f,\"gflops_min\":%.2f,"
         "\"gflops_max\":%.2f}\n",
         name, omp_get_max_threads(), g[REPS / 2], g[0], g[REPS - 1]);
  fflush(stdout);
}

// ---------- sweep: each element is read, receives K dependent FMAs, and is written back ----------
// 16 zmm (256 floats) are processed together so 16 independent chains hide FMA latency.
// Bytes counted: 4 read + 4 written per float. FLOPs: 2*K per float. Intensity = K/4 FLOP/byte.
static void kernel(float *x, long n, int K, __m512 a, __m512 b) {
  for (long i = 0; i < n; i += 256) {
    __m512 v[16];
    for (int j = 0; j < 16; j++) v[j] = _mm512_load_ps(x + i + 16 * j);
    for (int k = 0; k < K; k++)
      for (int j = 0; j < 16; j++) v[j] = _mm512_fmadd_ps(v[j], a, b);
    for (int j = 0; j < 16; j++) _mm512_store_ps(x + i + 16 * j, v[j]);
  }
}

static void run_sweep(long bytes) {
  int T = omp_get_max_threads();
  long n = bytes / 4;
  n -= n % (256L * T);
  long per = n / T;
  float *x = aligned_alloc(64, n * 4);
#pragma omp parallel
  {
    long s = per * omp_get_thread_num();
    for (long i = s; i < s + per; i++) x[i] = 1.0f;  // first touch on the owning thread
  }
  int Ks[] = {1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024};
  for (unsigned q = 0; q < sizeof Ks / sizeof Ks[0]; q++) {
    int K = Ks[q];
    double flops_per_pass = 2.0 * K * n, bytes_per_pass = 8.0 * n;
    // passes per timed sample so each sample lasts >= ~0.15 s
    long passes = 1;
    for (;;) {
      double t0 = now();
#pragma omp parallel
      {
        __m512 a = _mm512_set1_ps(0.9999999f), b = _mm512_set1_ps(1e-8f);
        long s = per * omp_get_thread_num();
        for (long p = 0; p < passes; p++) kernel(x + s, per, K, a, b);
      }
      if (now() - t0 > 0.15) break;
      passes *= 2;
    }
    double g[REPS];
    for (int r = 0; r < REPS; r++) {
      double t0 = now();
#pragma omp parallel
      {
        __m512 a = _mm512_set1_ps(0.9999999f), b = _mm512_set1_ps(1e-8f);
        long s = per * omp_get_thread_num();
        for (long p = 0; p < passes; p++) kernel(x + s, per, K, a, b);
      }
      g[r] = flops_per_pass * passes / (now() - t0) / 1e9;
    }
    qsort(g, REPS, sizeof g[0], cmpd);
    double ai = flops_per_pass / bytes_per_pass;
    printf("{\"kind\":\"sweep\",\"bytes\":%ld,\"threads\":%d,\"fma_per_elem\":%d,\"intensity\":%.4f,"
           "\"gflops_median\":%.2f,\"gflops_min\":%.2f,\"gflops_max\":%.2f,\"gbs_median\":%.2f}\n",
           n * 4, T, K, ai, g[REPS / 2], g[0], g[REPS - 1], g[REPS / 2] / ai);
    fflush(stdout);
  }
  volatile float sink = x[n / 2];
  (void)sink;
  free(x);
}

// ---------- read: sum every element, 16 independent accumulators per thread ----------
static void run_read(long bytes) {
  int T = omp_get_max_threads();
  long n = bytes / 4;
  n -= n % (256L * T);
  long per = n / T;
  float *x = aligned_alloc(64, n * 4);
#pragma omp parallel
  {
    long s = per * omp_get_thread_num();
    for (long i = s; i < s + per; i++) x[i] = 1.0f;
  }
  long passes = 1;
  double g[REPS], sink = 0;
  for (int r = -1; r < REPS; r++) {  // r = -1 calibrates the number of passes
    for (;;) {
      double t0 = now();
#pragma omp parallel reduction(+ : sink)
      {
        long s = per * omp_get_thread_num();
        __m512 acc[16];
        for (int j = 0; j < 16; j++) acc[j] = _mm512_setzero_ps();
        for (long p = 0; p < passes; p++)
          for (long i = s; i < s + per; i += 256)
            for (int j = 0; j < 16; j++) acc[j] = _mm512_add_ps(acc[j], _mm512_load_ps(x + i + 16 * j));
        for (int j = 1; j < 16; j++) acc[0] = _mm512_add_ps(acc[0], acc[j]);
        sink += _mm512_reduce_add_ps(acc[0]);
      }
      double dt = now() - t0;
      if (r >= 0) { g[r] = 4.0 * n * passes / dt / 1e9; break; }
      if (dt > 0.15) break;
      passes *= 2;
    }
    if (r == -1) continue;
  }
  qsort(g, REPS, sizeof g[0], cmpd);
  printf("{\"kind\":\"read\",\"bytes\":%ld,\"threads\":%d,\"gbs_median\":%.2f,\"gbs_min\":%.2f,"
         "\"gbs_max\":%.2f,\"sink\":%.0f}\n",
         n * 4, T, g[REPS / 2], g[0], g[REPS - 1], sink > 0 ? 1.0 : 0.0);
  free(x);
}

int main(int argc, char **argv) {
  if (argc >= 2 && !strcmp(argv[1], "peak")) {
    run_peak("avx512", peak_zmm, 20000000);
    run_peak("avx2", peak_ymm, 20000000);
    run_peak("scalar", peak_scalar, 20000000);
  } else if (argc >= 3 && !strcmp(argv[1], "read")) {
    run_read(atol(argv[2]));
  } else if (argc >= 3 && !strcmp(argv[1], "sweep")) {
    run_sweep(atol(argv[2]));
  } else {
    fprintf(stderr, "usage: %s peak | sweep BYTES | read BYTES\n", argv[0]);
    return 1;
  }
  return 0;
}
