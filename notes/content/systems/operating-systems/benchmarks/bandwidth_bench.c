// bandwidth_bench.c: STREAM-style bandwidth sweep over kernels, thread counts
// and working-set sizes.
//
// Kernels (n elements of double per array, s a scalar):
//   read     sum += a[i]                 counted bytes 8n
//   copy     c[i] = a[i]                 counted bytes 16n
//   triad    a[i] = b[i] + s * c[i]      counted bytes 24n
//   copy-nt  copy with non-temporal (streaming) stores
//   triad-nt triad with non-temporal (streaming) stores
//
// Bytes are counted as STREAM counts them: one read or one write per array
// element touched. A normal store to a line not in cache also reads the line
// first (write-allocate), which STREAM does not count; the -nt kernels avoid
// that read.
//
// The working set is the total size of the arrays a kernel touches, so all
// kernels at the same working-set size occupy the same amount of cache.
//
// Output: one JSON object per line on stdout, one per (kernel, threads, size),
// with every timed sample.
//
// Build and run with run_bandwidth_bench.sh, which records the machine.
//
// -fno-tree-loop-distribute-patterns stops GCC from turning the copy loop into
// a call to memcpy, which switches to non-temporal stores above a size
// threshold and would blur the copy / copy-nt comparison.

#define _GNU_SOURCE
#include <immintrin.h>
#include <omp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>

#define MIN_WS (16UL << 10)  // 16 KiB
#define MAX_WS (4UL << 30)   // 4 GiB
#define SAMPLES 7
#define TARGET_NS 20000000.0  // each sample runs the kernel for at least 20 ms
#define ALIGN (2UL << 20)

enum { K_READ, K_COPY, K_TRIAD, K_COPY_NT, K_TRIAD_NT, K_COUNT };
static const char *kname[K_COUNT] = {"read", "copy", "triad", "copy-nt", "triad-nt"};
static const int narrays[K_COUNT] = {1, 2, 3, 2, 3};

static double *A, *B, *C;
static volatile double sink;

static double now_ns(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC_RAW, &ts);
  return ts.tv_sec * 1e9 + ts.tv_nsec;
}

static double *alloc_array(size_t bytes) {
  void *p = NULL;
  if (posix_memalign(&p, ALIGN, bytes)) {
    perror("posix_memalign");
    exit(1);
  }
  madvise(p, bytes, MADV_HUGEPAGE);
  return p;
}

// Each thread owns the range [lo, hi), a multiple of 8 doubles (one 64-byte
// line) aligned to a line, so streaming stores never straddle two threads.
static void my_range(size_t n, int t, int nt, size_t *lo, size_t *hi) {
  size_t lines = n / 8;
  *lo = (lines * t / nt) * 8;
  *hi = (lines * (t + 1) / nt) * 8;
}

// Runs kernel k `reps` times over n elements with the current team.
// Each thread repeats its own range with no barrier between repetitions:
// the ranges are disjoint and every kernel is idempotent, so the result is
// the same, and the barrier cost does not pollute small working sets.
static void run(int k, size_t n, long reps) {
  const double s = 3.0;
#pragma omp parallel
  {
    size_t lo, hi;
    my_range(n, omp_get_thread_num(), omp_get_num_threads(), &lo, &hi);
    double *restrict a = A, *restrict b = B, *restrict c = C;
    double acc = 0.0;
    for (long r = 0; r < reps; r++) {
      switch (k) {
        case K_READ: {
          // Four independent vector accumulators. With one, every add waits
          // for the previous one to finish, which caps an L1- or L2-resident
          // read well below the cache's bandwidth.
          __m512d s0 = _mm512_setzero_pd(), s1 = s0, s2 = s0, s3 = s0;
          size_t i = lo;
          for (; i + 32 <= hi; i += 32) {
            s0 = _mm512_add_pd(s0, _mm512_load_pd(a + i));
            s1 = _mm512_add_pd(s1, _mm512_load_pd(a + i + 8));
            s2 = _mm512_add_pd(s2, _mm512_load_pd(a + i + 16));
            s3 = _mm512_add_pd(s3, _mm512_load_pd(a + i + 24));
          }
          for (; i < hi; i += 8) s0 = _mm512_add_pd(s0, _mm512_load_pd(a + i));
          acc += _mm512_reduce_add_pd(
              _mm512_add_pd(_mm512_add_pd(s0, s1), _mm512_add_pd(s2, s3)));
          break;
        }
        case K_COPY:
          for (size_t i = lo; i < hi; i++) c[i] = a[i];
          break;
        case K_TRIAD:
          for (size_t i = lo; i < hi; i++) a[i] = b[i] + s * c[i];
          break;
        case K_COPY_NT:
          for (size_t i = lo; i < hi; i += 8)
            _mm512_stream_pd(c + i, _mm512_load_pd(a + i));
          _mm_sfence();
          break;
        case K_TRIAD_NT: {
          const __m512d vs = _mm512_set1_pd(s);
          for (size_t i = lo; i < hi; i += 8)
            _mm512_stream_pd(a + i, _mm512_fmadd_pd(vs, _mm512_load_pd(c + i),
                                                    _mm512_load_pd(b + i)));
          _mm_sfence();
          break;
        }
      }
      // Keep the compiler from merging or dropping repetitions.
      __asm__ volatile("" ::: "memory");
    }
    if (acc == 1.2345) sink = acc;
  }
}

static int cmp_double(const void *x, const void *y) {
  double a = *(const double *)x, b = *(const double *)y;
  return (a > b) - (a < b);
}

static void shuffle(int *v, int n, unsigned *state) {
  for (int i = n - 1; i > 0; i--) {
    int j = rand_r(state) % (i + 1);
    int t = v[i];
    v[i] = v[j];
    v[j] = t;
  }
}

int main(int argc, char **argv) {
  unsigned seed = argc > 1 ? (unsigned)atoi(argv[1]) : 1;
  int maxthreads = omp_get_max_threads();
  if (maxthreads > 4) maxthreads = 4;

  // Largest array for each kernel: read uses 1 array of MAX_WS, copy 2 of
  // MAX_WS/2, triad 3 of MAX_WS/3. A holds the largest of these.
  A = alloc_array(MAX_WS);
  B = alloc_array(MAX_WS / 2 + ALIGN);
  C = alloc_array(MAX_WS / 2 + ALIGN);

  // First touch from the widest team so every page is backed before timing.
  omp_set_num_threads(maxthreads);
  size_t na = MAX_WS / 8, nb = (MAX_WS / 2 + ALIGN) / 8;
#pragma omp parallel for schedule(static)
  for (size_t i = 0; i < na; i++) A[i] = 1.0;
#pragma omp parallel for schedule(static)
  for (size_t i = 0; i < nb; i++) {
    B[i] = 2.0;
    C[i] = 0.5;
  }

  // Working-set sizes: powers of two and their midpoints (x1.5).
  size_t sizes[64];
  int nsizes = 0;
  for (size_t ws = MIN_WS; ws <= MAX_WS; ws *= 2) {
    sizes[nsizes++] = ws;
    if (ws * 3 / 2 <= MAX_WS && ws < MAX_WS) sizes[nsizes++] = ws * 3 / 2;
  }

  // Every (kernel, threads, size) cell, in an order shuffled by the seed so
  // slow drift on a shared host spreads across cells instead of biasing one.
  int ncells = K_COUNT * maxthreads * nsizes;
  int *order = malloc(sizeof(int) * ncells);
  for (int i = 0; i < ncells; i++) order[i] = i;
  unsigned st = seed;
  shuffle(order, ncells, &st);

  fprintf(stderr, "seed %u, %d threads max, %d sizes, %d cells\n", seed,
          maxthreads, nsizes, ncells);
  for (int ci = 0; ci < ncells; ci++) {
    int cell = order[ci];
    int k = cell % K_COUNT;
    int threads = 1 + (cell / K_COUNT) % maxthreads;
    size_t ws = sizes[cell / (K_COUNT * maxthreads)];

    // Elements per array, a multiple of 8 lines per thread so ranges align.
    size_t n = ws / 8 / narrays[k];
    size_t quantum = 64 * (size_t)threads;
    n = n / quantum * quantum;
    if (n == 0) continue;
    double counted = 8.0 * n * narrays[k];

    omp_set_num_threads(threads);
    run(k, n, 1);  // warm-up: page in, fill caches, start the team
    double t0 = now_ns();
    run(k, n, 1);
    double one = now_ns() - t0;
    long reps = (long)(TARGET_NS / (one > 1 ? one : 1)) + 1;
    if (reps < 1) reps = 1;

    double gbs[SAMPLES];
    for (int sidx = 0; sidx < SAMPLES; sidx++) {
      t0 = now_ns();
      run(k, n, reps);
      double dt = now_ns() - t0;
      gbs[sidx] = counted * reps / dt;  // bytes per ns == GB/s
    }
    double sorted[SAMPLES];
    memcpy(sorted, gbs, sizeof gbs);
    qsort(sorted, SAMPLES, sizeof(double), cmp_double);

    printf("{\"seed\":%u,\"kernel\":\"%s\",\"threads\":%d,\"ws_bytes\":%zu,"
           "\"n\":%zu,\"counted_bytes\":%.0f,\"reps\":%ld,\"median_gbs\":%.3f,"
           "\"max_gbs\":%.3f,\"samples_gbs\":[",
           seed, kname[k], threads, (size_t)(counted), n, counted, reps,
           sorted[SAMPLES / 2], sorted[SAMPLES - 1]);
    for (int sidx = 0; sidx < SAMPLES; sidx++)
      printf("%s%.3f", sidx ? "," : "", gbs[sidx]);
    printf("]}\n");
    fflush(stdout);
  }
  return 0;
}
