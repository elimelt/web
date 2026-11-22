// Single-thread build and lookup cost, ns per key, for each filter on the
// hour-0 keys (dynamic filters at their table's design load). Run pinned:
//   taskset -c 3 ./speed R    (R repetitions; prints every repetition)
#include "filters.h"
#include <time.h>
static uint64_t *keys; static long nk; static const long N0 = 5843219, NEG = 8000000;
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e9 + t.tv_nsec; }
// Bloom filters for reference: standard (k probes anywhere) and blocked into 512-bit lines.
typedef struct { uint64_t m; int k, blk; uint64_t *b; uint64_t seed[17]; } bloom;
static inline int bl_op(bloom *f, uint64_t x, int set) {
  uint64_t h = fmix64(x ^ f->seed[0]); int all = 1;
  if (f->blk) { uint64_t base = mulhi(h, f->m / 512) * 512; uint64_t g = fmix64(h ^ f->seed[1]);
    for (int i = 0; i < f->k; i++) { uint64_t p = base + ((g >> (9 * (i % 7))) & 511); if (i % 7 == 6) g = fmix64(g ^ f->seed[2 + i / 7]);
      if (set) f->b[p >> 6] |= 1ULL << (p & 63); else if (!(f->b[p >> 6] >> (p & 63) & 1)) return 0; } }
  else { for (int i = 0; i < f->k; i++) { uint64_t p = mulhi(fmix64(h ^ f->seed[i + 1]), f->m);
      if (set) f->b[p >> 6] |= 1ULL << (p & 63); else if (!(f->b[p >> 6] >> (p & 63) & 1)) return 0; } }
  return all;
}
int main(int argc, char **argv) {
  int R = argc > 1 ? atoi(argv[1]) : 3;
  FILE *fp = fopen("distinct.bin", "rb"); fseek(fp, 0, SEEK_END); nk = ftell(fp) / 8; rewind(fp); keys = malloc(nk * 8); if (fread(keys, 8, nk, fp) != (size_t)nk) return 1; fclose(fp);
  long NQ = N0; uint64_t *pos = malloc(8 * 8000000), *neg = keys + NEG;
  printf("# rep filter n bytes build_ns_per_key pos_ns neg_ns check\n");
  for (int rep = 0; rep < R; rep++) {
    for (int which = 0; which < 9; which++) {
      long n = N0; double t0, t1, t2, t3; long hits = 0, nh = 0; size_t bytes = 0; char name[40];
      if (which == 2) n = (long)(0.95 * (1 << 23)); if (which == 3) n = (long)(0.9 * (1 << 23)); if (which == 8) n = (long)(0.75 * (1 << 23));
      // shuffled copy of the inserted keys for positive lookups
      for (long i = 0; i < n; i++) pos[i] = keys[i]; uint64_t s = 99 + rep; for (long i = n - 1; i > 0; i--) { long j = sm64(&s) % (i + 1); uint64_t t = pos[i]; pos[i] = pos[j]; pos[j] = t; }
      long nq = n < NQ ? n : NQ;
      if (which <= 1) {
        bloom f = {12 * (uint64_t)n, 8, which, 0}; f.m = (f.m + 511) / 512 * 512; f.b = calloc(f.m / 64, 8); uint64_t z = 5 + rep; for (int i = 0; i < 17; i++) f.seed[i] = sm64(&z);
        t0 = now(); for (long i = 0; i < n; i++) bl_op(&f, keys[i], 1); t1 = now();
        for (long i = 0; i < nq; i++) hits += bl_op(&f, pos[i], 0); t2 = now(); for (long i = 0; i < nq; i++) nh += bl_op(&f, neg[i], 0); t3 = now();
        bytes = f.m / 8; sprintf(name, which ? "bloom-blocked512-12bpk-k8" : "bloom-12bpk-k8"); free(f.b);
      } else if (which == 2) {
        cuckoo c; ck_init(&c, 1 << 21, 4, 12, 1, 11 + rep); t0 = now(); for (long i = 0; i < n; i++) ck_insert(&c, keys[i]); t1 = now();
        for (long i = 0; i < nq; i++) hits += ck_query(&c, pos[i]); t2 = now(); for (long i = 0; i < nq; i++) nh += ck_query(&c, neg[i]); t3 = now();
        bytes = (1 << 23) * 12 / 8; sprintf(name, "cuckoo-b4-f12-load0.95"); free(c.t);
      } else if (which == 3 || which == 8) {
        qfilter q; qf_init(&q, 23, 8, 13 + rep); t0 = now(); for (long i = 0; i < n; i++) qf_insert(&q, keys[i]); t1 = now();
        for (long i = 0; i < nq; i++) hits += qf_query(&q, pos[i]); t2 = now(); for (long i = 0; i < nq; i++) nh += qf_query(&q, neg[i]); t3 = now();
        bytes = (1 << 23) * 11 / 8; sprintf(name, which == 3 ? "quotient-r8-load0.9" : "quotient-r8-load0.75"); qf_free(&q);
      } else if (which == 4) {
        xorf x; uint64_t core; t0 = now(); xr_build(&x, keys, n, 8, 1.23, 17 + rep, &core); t1 = now();
        for (long i = 0; i < nq; i++) hits += xr_query(&x, pos[i]); t2 = now(); for (long i = 0; i < nq; i++) nh += xr_query(&x, neg[i]); t3 = now();
        bytes = x.cap; sprintf(name, "xor8"); free(x.B);
      } else if (which == 5) {
        fusef b; uint64_t core; t0 = now(); bf_build(&b, keys, n, 8, bf_factor(n), bf_seglen(n), 19 + rep, &core); t1 = now();
        for (long i = 0; i < nq; i++) hits += bf_query(&b, pos[i]); t2 = now(); for (long i = 0; i < nq; i++) nh += bf_query(&b, neg[i]); t3 = now();
        bytes = b.len; sprintf(name, "fuse8"); free(b.B);
      } else if (which == 6) {
        ribbon128 r; uint64_t sd = 23 + rep; t0 = now(); while (!rb128_build(&r, keys, n, 8, (uint64_t)(1.07 * n), sd)) sd += 1000; t1 = now();
        for (long i = 0; i < nq; i++) hits += rb128_query(&r, pos[i]); t2 = now(); for (long i = 0; i < nq; i++) nh += rb128_query(&r, neg[i]); t3 = now();
        bytes = (size_t)(1.07 * n) * 8 / 8; sprintf(name, "ribbon128-f8-eps0.07"); free(r.S);
      } else if (which == 7) {
        ribbon r; uint64_t sd = 29 + rep; t0 = now(); while (!rb_build(&r, keys, n, 8, (uint64_t)(1.15 * n), sd)) sd += 1000; t1 = now();
        for (long i = 0; i < nq; i++) hits += rb_query(&r, pos[i]); t2 = now(); for (long i = 0; i < nq; i++) nh += rb_query(&r, neg[i]); t3 = now();
        bytes = (size_t)(1.15 * n); sprintf(name, "ribbon64-f8-eps0.15"); free(r.S);
      }
      printf("%d %s %ld %zu %.2f %.2f %.2f %ld/%ld fp=%ld\n", rep, name, n, bytes, (t1 - t0) / n, (t2 - t1) / nq, (t3 - t2) / nq, hits, nq, nh); fflush(stdout);
    }
  }
  return 0;
}
