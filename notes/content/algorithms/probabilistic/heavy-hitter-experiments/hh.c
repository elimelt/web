// Heavy hitters on the pageview stream: Misra-Gries, Space-Saving, Count
// Sketch with a candidate heap, Count-Min with a candidate heap, and Count-Min
// with conservative update and a candidate heap.
//
// Usage: ./hh ORDER SEED OUT
//   ORDER  0 = records in file order (hour by hour, sorted by page within an
//          hour), 1 = a uniformly random permutation of the records drawn
//          with SEED.
//   SEED   seeds the permutation and the sketch hash functions.
//   OUT    binary output file (format in write_run below).
//
// Every configuration runs over the same in-memory stream; configurations
// run in parallel with OpenMP.  Inputs in the working directory: stream.bin
// ({uint64 key, uint32 count} records) and agg.bin ({uint64 key, uint64
// total} per distinct key), both written by prep.c of the sketch experiments.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <omp.h>
#include "hh.h"

#define NTOP 5000            /* true top keys whose estimates are written */

typedef struct __attribute__((packed)) { uint64_t k; uint32_t c; } rec;
typedef struct { uint64_t k, c; } pair;

static int cmp_desc(const void *a, const void *b) {
  const pair *x = a, *y = b;
  return x->c < y->c ? 1 : x->c > y->c ? -1 : (x->k < y->k ? -1 : x->k > y->k);
}

static const int MS[] = {250, 1000, 4000, 16000, 64000};
#define NM (int)(sizeof MS / sizeof MS[0])
enum { A_MG, A_MGm1, A_SS, A_CS, A_CMS, A_CU, NA };
static const char *ANAME[] = {"mg", "mg_m1", "ss", "cs", "cms", "cu"};

static void write_run(FILE *f, int alg, int m, const int64_t *est, const summary *s) {
  // Then NTOP int64 estimates for the true top keys in rank order (-1 for a
  // key a counter summary does not monitor), then the candidates as
  // {uint64 key, int64 estimate, int64 err}.
  // header: alg, m, number of candidates, then the summary's smallest
  // counter (0 unless full) and, for Misra-Gries, the total decrement.
  int32_t h[3] = {alg, m, (int32_t)s->n};
  int64_t h2[2] = {summary_min(s), s->off};
  fwrite(h, 4, 3, f); fwrite(h2, 8, 2, f);
  fwrite(est, 8, NTOP, f);
  for (uint32_t i = 0; i < s->n; i++) {
    int64_t v[3] = {(int64_t)s->key[i], summary_value(s, i), (int64_t)s->err[i]};
    fwrite(v, 8, 3, f);
  }
}

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: hh ORDER SEED OUT\n"); return 1; }
  int order = atoi(argv[1]);
  uint64_t seed = strtoull(argv[2], NULL, 10);
  FILE *fs = fopen("stream.bin", "rb");
  fseek(fs, 0, SEEK_END); size_t T = ftell(fs) / sizeof(rec); rewind(fs);
  rec *S = malloc(T * sizeof(rec));
  if (fread(S, sizeof(rec), T, fs) != T) return 2;
  fclose(fs);
  if (order == 1) {
    uint64_t r = seed * 0x9E3779B97F4A7C15ULL + 12345;
    for (size_t i = T - 1; i > 0; i--) {
      size_t j = (size_t)(((unsigned __int128)splitmix(&r) * (i + 1)) >> 64);
      rec t = S[i]; S[i] = S[j]; S[j] = t;
    }
  }
  // Truth: the NTOP most viewed keys.
  FILE *fa = fopen("agg.bin", "rb");
  fseek(fa, 0, SEEK_END); size_t D = ftell(fa) / sizeof(pair); rewind(fa);
  pair *A = malloc(D * sizeof(pair));
  if (fread(A, sizeof(pair), D, fa) != D) return 2;
  fclose(fa);
  qsort(A, D, sizeof(pair), cmp_desc);
  uint64_t topk[NTOP];
  for (int i = 0; i < NTOP; i++) topk[i] = A[i].k;
  free(A);

  FILE *fo = fopen(argv[3], "wb");
  int32_t hdr[4] = {order, (int32_t)seed, NM, NA};
  fwrite(hdr, 4, 4, fo);
  #pragma omp parallel for schedule(dynamic, 1)
  for (int job = 0; job < NM * NA; job++) {
    int alg = job % NA, m = MS[job / NA];
    if (order == 0 && seed != 1 && (alg == A_MG || alg == A_MGm1 || alg == A_SS)) continue;
    int64_t *est = calloc(NTOP, 8);
    summary *s = NULL; sketch *sk = NULL;
    if (alg == A_MG) s = summary_new(m, SUM_MG);
    else if (alg == A_MGm1) s = summary_new(m - 1, SUM_MG);
    else if (alg == A_SS) s = summary_new(m, SUM_SS);
    else {
      // The same bytes as m counters of 16 bytes: three quarters as 4-byte
      // cells, one quarter as a heap of 16-byte candidates.
      int K = m / 4, cells = 3 * m;
      int d = alg == A_CS ? 5 : 4;
      sk = sketch_new(alg == A_CS ? SK_CS : alg == A_CMS ? SK_CMS : SK_CU, d, cells / d, seed);
      s = summary_new(K, SUM_TOPK);
    }
    for (size_t t = 0; t < T; t++) {
      uint64_t k = S[t].k, c = S[t].c;
      if (sk) { int64_t e = sketch_update(sk, k, c); topk_offer(s, k, e); }
      else if (alg == A_SS) ss_update(s, k, c);
      else mg_update(s, k, c);
    }
    for (int i = 0; i < NTOP; i++) {
      est[i] = sk ? sketch_query(sk, topk[i]) : summary_lookup(s, topk[i]);
    }
    #pragma omp critical
    { write_run(fo, alg, m, est, s); fflush(fo);
      fprintf(stderr, "order %d seed %llu %s m=%d done\n", order, (unsigned long long)seed, ANAME[alg], m); }
    free(est); summary_free(s); if (sk) sketch_free(sk);
  }
  fclose(fo);
  return 0;
}
