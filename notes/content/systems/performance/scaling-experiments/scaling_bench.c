// scaling_bench.c: strong- and weak-scaling microbenchmarks for the Amdahl/Gustafson note.
// Build: gcc -O2 -pthread -o scaling_bench scaling_bench.c
// Usage: ./scaling_bench MODE N
//   amdahl   N : serial phase of S units on one thread, then P units split over N threads
//   weak     N : as amdahl, but the parallel phase is P*N units (Gustafson scaling)
//   counter  N : N threads perform TOTAL atomic increments on one shared counter
//   padded   N : as counter, but each thread increments its own cache-line-padded counter
//   triad    N : STREAM triad a = b + s*c over 3 x 64 Mi doubles, split over N threads
// Prints: mode N seconds
#define _GNU_SOURCE
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define UNIT 1000000ULL            /* iterations of the ALU kernel per work unit */
#define SERIAL_UNITS 50ULL          /* serial phase: 50 units */
#define PARALLEL_UNITS 950ULL       /* parallel phase: 950 units, designed f = 0.05 */
#define TOTAL_INCS 120000000ULL
#define TRIAD_LEN (64ULL << 20)
#define TRIAD_REPS 10

static double now(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec * 1e-9;
}

/* xorshift64 chain: one dependent ALU op sequence, no memory traffic */
static uint64_t spin(uint64_t units, uint64_t x) {
  for (uint64_t i = 0; i < units * UNIT; i++) { x ^= x << 13; x ^= x >> 7; x ^= x << 17; }
  return x;
}

typedef struct { int id, n; uint64_t units; uint64_t out; } work_t;
static _Atomic uint64_t shared_ctr;
typedef struct { _Alignas(64) _Atomic uint64_t v; char pad[56]; } padded_t;
static padded_t padded[64];
static double *A, *B, *C;
static int g_mode; /* 0 spin, 1 counter, 2 padded, 3 triad */

static void pin(int id) {
  cpu_set_t s; CPU_ZERO(&s); CPU_SET(id % 4, &s);
  pthread_setaffinity_np(pthread_self(), sizeof s, &s);
}

static void *worker(void *arg) {
  work_t *w = arg; pin(w->id);
  if (g_mode == 0) {
    w->out = spin(w->units, 88172645463325252ULL + w->id);
  } else if (g_mode == 1) {
    for (uint64_t i = 0; i < w->units; i++) atomic_fetch_add_explicit(&shared_ctr, 1, memory_order_relaxed);
  } else if (g_mode == 2) {
    for (uint64_t i = 0; i < w->units; i++) atomic_fetch_add_explicit(&padded[w->id].v, 1, memory_order_relaxed);
  } else {
    uint64_t lo = TRIAD_LEN * w->id / w->n, hi = TRIAD_LEN * (w->id + 1) / w->n;
    for (int r = 0; r < TRIAD_REPS; r++)
      for (uint64_t i = lo; i < hi; i++) A[i] = B[i] + 3.0 * C[i];
  }
  return NULL;
}

static void run_parallel(int n, uint64_t total_units, uint64_t *sink) {
  pthread_t th[64]; work_t w[64];
  for (int i = 0; i < n; i++) {
    w[i] = (work_t){ i, n, total_units * (i + 1) / n - total_units * i / n, 0 };
    pthread_create(&th[i], NULL, worker, &w[i]);
  }
  for (int i = 0; i < n; i++) { pthread_join(th[i], NULL); *sink ^= w[i].out; }
}

int main(int argc, char **argv) {
  if (argc != 3) { fprintf(stderr, "usage: %s MODE N\n", argv[0]); return 2; }
  const char *mode = argv[1]; int n = atoi(argv[2]);
  uint64_t sink = 0; double t0, t1;
  if (!strcmp(mode, "amdahl") || !strcmp(mode, "weak")) {
    g_mode = 0; pin(0);
    uint64_t par = PARALLEL_UNITS * (strcmp(mode, "weak") ? 1 : (uint64_t)n);
    t0 = now();
    sink ^= spin(SERIAL_UNITS, 1);
    run_parallel(n, par, &sink);
    t1 = now();
  } else if (!strcmp(mode, "counter") || !strcmp(mode, "padded")) {
    g_mode = strcmp(mode, "counter") ? 2 : 1;
    t0 = now(); run_parallel(n, TOTAL_INCS, &sink); t1 = now();
  } else if (!strcmp(mode, "triad")) {
    g_mode = 3;
    A = aligned_alloc(64, TRIAD_LEN * 8); B = aligned_alloc(64, TRIAD_LEN * 8); C = aligned_alloc(64, TRIAD_LEN * 8);
    /* initialized on one thread; the guest has a single NUMA node */
    for (uint64_t i = 0; i < TRIAD_LEN; i++) { A[i] = 0; B[i] = 1; C[i] = 2; }
    t0 = now(); run_parallel(n, 0, &sink); t1 = now();
    sink ^= (uint64_t)A[TRIAD_LEN / 3];
  } else { fprintf(stderr, "unknown mode\n"); return 2; }
  printf("%s %d %.6f %llu\n", mode, n, t1 - t0, (unsigned long long)(sink & 1));
  return 0;
}
