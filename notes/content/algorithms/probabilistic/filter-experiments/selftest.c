// Checks: no false negatives for every filter, and FPR near theory, on 200k random keys.
#include "filters.h"
int main(void) { setvbuf(stdout, 0, _IONBF, 0);
  uint64_t n = 200000, nq = 2000000, s = 42; uint64_t *k = malloc((n + nq) * 8); for (uint64_t i = 0; i < n + nq; i++) k[i] = sm64(&s);
  { cuckoo c; ck_init(&c, 1 << 16, 4, 12, 1, 7); uint64_t m = (uint64_t)(0.9 * (1 << 18)); int fails = 0; for (uint64_t i = 0; i < m; i++) fails += !ck_insert(&c, k[i]);
    long fn = 0, fp = 0; for (uint64_t i = 0; i < m; i++) fn += !ck_query(&c, k[i]); for (uint64_t i = n; i < n + nq; i++) fp += ck_query(&c, k[i]);
    printf("cuckoo pow2 fails %d fn %ld fpr %.3e theory %.3e\n", fails, fn, (double)fp / nq, 8 * 0.9 / 4095.0); }
  { cuckoo c; ck_init(&c, 55555, 4, 12, 0, 7); uint64_t m = (uint64_t)(0.9 * 4 * 55555); int fails = 0; for (uint64_t i = 0; i < m; i++) fails += !ck_insert(&c, k[i]);
    long fn = 0, fp = 0; for (uint64_t i = 0; i < m; i++) fn += !ck_query(&c, k[i]); for (uint64_t i = n; i < n + nq; i++) fp += ck_query(&c, k[i]);
    printf("cuckoo mod fails %d fn %ld fpr %.3e theory %.3e\n", fails, fn, (double)fp / nq, 8 * 0.9 / 4095.0); }
  { qfilter f; qf_init(&f, 18, 8, 9); uint64_t m = (uint64_t)(0.7 * (1 << 18)); for (uint64_t i = 0; i < m; i++) qf_insert(&f, k[i]);
    long fn = 0, fp = 0; for (uint64_t i = 0; i < m; i++) fn += !qf_query(&f, k[i]); for (uint64_t i = n; i < n + nq; i++) fp += qf_query(&f, k[i]);
    printf("qf fn %ld fpr %.3e theory %.3e\n", fn, (double)fp / nq, 1 - exp(-0.7 / 256)); }
  { qfilter f; qf_init(&f, 12, 8, 9); uint64_t m = (uint64_t)(0.95 * (1 << 12)); for (uint64_t i = 0; i < m; i++) qf_insert(&f, k[i]);
    long fn = 0; for (uint64_t i = 0; i < m; i++) fn += !qf_query(&f, k[i]); printf("qf high load fn %ld\n", fn); }
  { xorf x; uint64_t core; int ok = xr_build(&x, k, n, 8, 1.23, 3, &core); long fn = 0, fp = 0; for (uint64_t i = 0; i < n; i++) fn += !xr_query(&x, k[i]); for (uint64_t i = n; i < n + nq; i++) fp += xr_query(&x, k[i]);
    printf("xor ok %d fn %ld fpr %.3e theory %.3e bpk %.3f\n", ok, fn, (double)fp / nq, 1 / 256.0, 8.0 * x.cap / n); }
  { fusef b; uint64_t core; int ok = bf_build(&b, k, n, 8, bf_factor(n), bf_seglen(n), 3, &core); long fn = 0, fp = 0; for (uint64_t i = 0; i < n; i++) fn += !bf_query(&b, k[i]); for (uint64_t i = n; i < n + nq; i++) fp += bf_query(&b, k[i]);
    printf("fuse ok %d fn %ld fpr %.3e theory %.3e bpk %.3f seglen %lu\n", ok, fn, (double)fp / nq, 1 / 256.0, 8.0 * b.len / n, b.seglen); }
  { ribbon r; int ok = rb_build(&r, k, n, 8, (uint64_t)(1.10 * n), 5); if (!ok) { printf("ribbon build failed\n"); } else { long fn = 0, fp = 0; for (uint64_t i = 0; i < n; i++) fn += !rb_query(&r, k[i]); for (uint64_t i = n; i < n + nq; i++) fp += rb_query(&r, k[i]);
    printf("ribbon ok %d fn %ld fpr %.3e theory %.3e\n", ok, fn, (double)fp / nq, 1 / 256.0); } }
  { ribbon128 r; int ok = rb128_build(&r, k, n, 10, (uint64_t)(1.05 * n), 5); if (ok) { long fn = 0, fp = 0; for (uint64_t i = 0; i < n; i++) fn += !rb128_query(&r, k[i]); for (uint64_t i = n; i < n + nq; i++) fp += rb128_query(&r, k[i]);
    printf("ribbon128 ok %d fn %ld fpr %.3e theory %.3e\n", ok, fn, (double)fp / nq, 1 / 1024.0); } else printf("ribbon128 failed\n"); }
  for (int w = 32; w <= 128; w *= 2) { int succ = 0; for (int t = 0; t < 20; t++) succ += rb_try(k, 100000, (uint64_t)(1.10 * 100000), w, t); printf("ribbon w %d eps .10 success %d/20\n", w, succ); }
  return 0;
}
