// Experiments for the fingerprint-filter note. Keys: the 61 million distinct
// pageview keys of 4 March 2026 (64-bit MurmurHash64A values), in order of
// first appearance; the first 5,843,219 are hour 0.  Negative queries for the
// false-positive runs are keys[8,000,000 ..], disjoint from every insert set.
//
//   ./exp F T    space and false-positive rate at full scale, T seeds
//   ./exp L T    cuckoo filter: load at the first failed insertion
//   ./exp Q T    quotient filter: probe and shift lengths against load
//   ./exp X      xor and binary fuse: construction success against size factor
//   ./exp R      ribbon: construction success against overhead and width
#include "filters.h"
#include <omp.h>
static uint64_t *keys; static long nk; static const long N0 = 5843219, NEG = 8000000;
static void load(void) {
  FILE *fp = fopen("distinct.bin", "rb"); fseek(fp, 0, SEEK_END); nk = ftell(fp) / 8; rewind(fp);
  keys = malloc(nk * 8); if (fread(keys, 8, nk, fp) != (size_t)nk) exit(1); fclose(fp);
}
static uint64_t seedof(int t, int salt) { uint64_t s = 0x1234567ULL * (t + 1) + 7777ULL * salt; return sm64(&s); }

static void modeF(int T) {
  printf("# filter param n slots bits_per_key fails fp negatives\n");
  long nneg = nk - NEG;
  for (int t = 0; t < T; t++) {
    // Cuckoo filter, b = 4, 2^21 buckets (power of two), loads 0.95 and the hour-0 set.
    int fs[] = {8, 12, 16};
    #pragma omp parallel for schedule(dynamic)
    for (int fi = 0; fi < 6; fi++) {
      int f = fs[fi % 3]; long n = fi < 3 ? (long)(0.95 * (1 << 23)) : N0;
      cuckoo c; ck_init(&c, 1 << 21, 4, f, 1, seedof(t, 100 + f)); long fails = 0;
      for (long i = 0; i < n; i++) fails += !ck_insert(&c, keys[i]);
      long fp = 0; for (long i = NEG; i < nk; i++) fp += ck_query(&c, keys[i]);
      #pragma omp critical
      printf("cuckoo4 f=%d %ld %d %.4f %ld %ld %ld\n", f, n, 1 << 23, (double)f * (1 << 23) / n, fails, fp, nneg);
      free(c.t);
    }
    // Quotient filter, q = 23, loads 0.75 and 0.9 and the hour-0 set; r = 8, 13.
    #pragma omp parallel for schedule(dynamic)
    for (int ci = 0; ci < 6; ci++) {
      int r = ci < 3 ? 8 : 13; double a = (ci % 3 == 0) ? 0.75 : 0.9; long n = (ci % 3 == 2) ? N0 : (long)(a * (1 << 23));
      qfilter q; qf_init(&q, 23, r, seedof(t, 200 + r)); for (long i = 0; i < n; i++) qf_insert(&q, keys[i]);
      long fp = 0; for (long i = NEG; i < nk; i++) fp += qf_query(&q, keys[i]);
      #pragma omp critical
      printf("quotient r=%d %ld %d %.4f 0 %ld %ld\n", r, n, 1 << 23, (double)(r + 3) * (1 << 23) / n, fp, nneg);
      qf_free(&q);
    }
    // Static filters on the hour-0 set.
    #pragma omp parallel for schedule(dynamic)
    for (int ci = 0; ci < 9; ci++) {
      long fp = 0; int ok = 0; double bpk = 0; char name[64]; uint64_t slots = 0;
      if (ci < 2) { int f = ci ? 16 : 8; xorf x; uint64_t core; ok = xr_build(&x, keys, N0, f, 1.23, seedof(t, 300 + f), &core); slots = x.cap;
        if (ok) { for (long i = NEG; i < nk; i++) fp += xr_query(&x, keys[i]); free(x.B); } bpk = (double)f * x.cap / N0; sprintf(name, "xor f=%d", f); }
      else if (ci < 4) { int f = ci == 3 ? 16 : 8; fusef b; uint64_t core; ok = bf_build(&b, keys, N0, f, bf_factor(N0), bf_seglen(N0), seedof(t, 400 + f), &core); slots = b.len;
        if (ok) { for (long i = NEG; i < nk; i++) fp += bf_query(&b, keys[i]); free(b.B); } bpk = (double)f * b.len / N0; sprintf(name, "fuse3 f=%d", f); }
      else { int fr[] = {7, 8, 10, 13, 16}; int f = fr[ci - 4]; double eps = 0.08; uint64_t m = (uint64_t)((1 + eps) * N0); ribbon rb;
        ok = rb_build(&rb, keys, N0, f, m, seedof(t, 500 + f)); slots = m;
        if (ok) { for (long i = NEG; i < nk; i++) fp += rb_query(&rb, keys[i]); free(rb.S); } bpk = (double)f * m / N0; sprintf(name, "ribbon64 f=%d", f); }
      #pragma omp critical
      printf("%s %ld %lu %.4f %d %ld %ld\n", name, N0, slots, bpk, !ok, fp, nneg);
    }
    fflush(stdout);
  }
}

static void modeG(int T) {
  printf("# filter param n slots bits_per_key failed_seeds fp negatives\n");
  long nneg = nk - NEG;
  #pragma omp parallel for schedule(dynamic) collapse(2)
  for (int t = 0; t < T; t++) for (int ci = 0; ci < 10; ci++) {
    int fr[] = {7, 8, 10, 13, 16}; int f = fr[ci % 5]; int w = ci < 5 ? 128 : 64; double eps = w == 128 ? 0.07 : 0.15;
    uint64_t m = (uint64_t)((1 + eps) * N0); long fp = 0; int tries = 0; uint64_t sd = seedof(t, 600 + f + w);
    if (w == 128) { ribbon128 rb; while (!rb128_build(&rb, keys, N0, f, m, sd)) { tries++; sd = sm64(&sd); } for (long i = NEG; i < nk; i++) fp += rb128_query(&rb, keys[i]); free(rb.S); }
    else { ribbon rb; while (!rb_build(&rb, keys, N0, f, m, sd)) { tries++; sd = sm64(&sd); } for (long i = NEG; i < nk; i++) fp += rb_query(&rb, keys[i]); free(rb.S); }
    #pragma omp critical
    printf("ribbon%d f=%d %ld %lu %.4f %d %ld %ld\n", w, f, N0, m, (double)f * m / N0, tries, fp, nneg);
  }
}

// The figure's six layouts on S = 4096 slots with the pageview keys: successes out of T builds per load.
static void modeJ(int T) {
  printf("# kind S load trials ok\n");
  const char *kn[] = {"cuckoo2", "cuckoo4", "xor", "fuse", "ribbon32", "ribbon64"}; uint64_t S = 4096;
  #pragma omp parallel for schedule(dynamic) collapse(2)
  for (int ki = 0; ki < 6; ki++) for (int li = 0; li <= 20; li++) {
    double load = 0.60 + 0.02 * li; long n = lround(load * S); int ok = 0;
    for (int t = 0; t < T; t++) {
      uint64_t off = ((uint64_t)t * 104729 + li * 7919 + ki * 131) * 4099 % (nk - n); const uint64_t *k = keys + off; uint64_t seed = seedof(t, 7000 + ki * 100 + li); int good;
      if (ki < 2) { int b = ki ? 4 : 2; cuckoo c; ck_init(&c, S / b, b, 16, 1, seed); long i = 0; while (i < n && ck_insert(&c, k[i])) i++; good = i == n; free(c.t); }
      else if (ki == 2) { xorf x; x.bl = S / 3; x.cap = 3 * x.bl; uint32_t *pos = malloc(12 * n), *o = malloc(4 * n), *sl = malloc(4 * n); uint64_t core;
        for (long i = 0; i < n; i++) { uint64_t h = fmix64(k[i] ^ seed), a, b, c; xr_pos(&x, h, &a, &b, &c); pos[3 * i] = a; pos[3 * i + 1] = b; pos[3 * i + 2] = c; }
        good = peel3(n, x.cap, pos, o, sl, &core); free(pos); free(o); free(sl); }
      else if (ki == 3) { fusef b; uint64_t seg = bf_seglen(n); if (seg > S / 4) seg = S / 4; b.seglen = seg; b.segmask = seg - 1; b.segcount = S / seg - 2; b.segcountlen = b.segcount * seg; b.len = S;
        uint32_t *pos = malloc(12 * n), *o = malloc(4 * n), *sl = malloc(4 * n); uint64_t core;
        for (long i = 0; i < n; i++) { uint64_t h = fmix64(k[i] ^ seed), a, c, d; bf_pos(&b, h, &a, &c, &d); pos[3 * i] = a; pos[3 * i + 1] = c; pos[3 * i + 2] = d; }
        good = peel3(n, S, pos, o, sl, &core); free(pos); free(o); free(sl); }
      else good = rb_try(k, n, S, ki == 4 ? 32 : 64, seed);
      ok += good;
    }
    #pragma omp critical
    printf("%s %lu %.2f %d %d\n", kn[ki], S, load, T, ok);
  }
}

static void modeL(int T) {
  printf("# variant b f slots trial load_at_first_failure kicks_per_insert\n");
  typedef struct { int b, f, lg, pow2; } cfg; cfg cs[64]; int nc = 0;
  int lgs[] = {12, 16, 20, 23};
  for (int li = 0; li < 4; li++) for (int b = 1; b <= 8; b *= 2) cs[nc++] = (cfg){b, 16, lgs[li], 1};
  int fs[] = {4, 5, 6, 7, 8, 10, 12};
  for (int fi = 0; fi < 7; fi++) for (int li = 1; li < 4; li++) cs[nc++] = (cfg){4, fs[fi], lgs[li], 1};
  for (int fi = 0; fi < 7; fi++) cs[nc++] = (cfg){4, fs[fi], 23, 0};
  cs[nc++] = (cfg){4, 16, 23, 0};
  #pragma omp parallel for schedule(dynamic) collapse(2)
  for (int ci = 0; ci < nc; ci++) for (int t = 0; t < T; t++) {
    cfg g = cs[ci]; uint64_t slots = 1ULL << g.lg; cuckoo c; ck_init(&c, slots / g.b, g.b, g.f, g.pow2, seedof(t, 1000 + ci));
    long i = 0; uint64_t off = (uint64_t)t * 1000003 % (nk - slots); while (i < (long)slots && ck_insert(&c, keys[off + i])) i++;
    #pragma omp critical
    printf("%s %d %d %lu %d %.6f %.3f\n", g.pow2 ? "xor" : "mod", g.b, g.f, slots, t, (double)i / slots, (double)c.kicks / (i + 1));
    free(c.t);
  }
}

static void modeQ(int T) {
  printf("# trial alpha mean_probe_neg mean_shift_per_insert_in_interval mean_cluster p99_cluster max_cluster sizebiased_cluster\n");
  int q = 22; uint64_t ns = 1ULL << q;
  double as[] = {0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95};
  #pragma omp parallel for schedule(dynamic)
  for (int t = 0; t < T; t++) {
    qfilter f; qf_init(&f, q, 8, seedof(t, 2000)); long done = 0;
    for (int ai = 0; ai < 8; ai++) {
      long target = (long)(as[ai] * ns); long sh0 = f.shifts;
      for (; done < target; done++) qf_insert(&f, keys[done]);
      double shift = (double)(f.shifts - sh0) / (target - (ai ? (long)(as[ai - 1] * ns) : 0));
      long tot = 0, cnt = 400000; for (long i = 0; i < cnt; i++) tot += qf_probe_len(&f, keys[NEG + i]);
      // cluster lengths: maximal runs of nonempty slots
      long *hist = calloc(ns + 1, 8); uint64_t start = 0; while (!qf_empty(&f, start)) start++;
      long len = 0, ncl = 0, sum = 0, mx = 0;
      for (uint64_t k = 1; k <= ns; k++) { uint64_t i = (start + k) & f.mask; if (qf_empty(&f, i)) { if (len) { hist[len]++; ncl++; sum += len; if (len > mx) mx = len; } len = 0; } else len++; }
      long acc = 0, p99 = 0; double sq = 0; for (long L = 1; L <= mx; L++) sq += (double)L * L * hist[L]; for (long L = 1; L <= mx; L++) { acc += hist[L]; if (acc >= 0.99 * ncl) { p99 = L; break; } }
      #pragma omp critical
      printf("%d %.2f %.4f %.4f %.4f %ld %ld %.4f\n", t, as[ai], (double)tot / cnt, shift, (double)sum / ncl, p99, mx, sq / sum);
      free(hist);
    }
    qf_free(&f);
  }
}

static void modeX(void) {
  printf("# kind n factor trial ok core_left_fraction len\n");
  long ns[] = {1000, 10000, 100000, 1000000, 5843219}; int trials[] = {400, 200, 100, 40, 12};
  typedef struct { int kind; long n; double fac; int t; } job; job *J = malloc(200000 * sizeof(job)); long nj = 0;
  for (int ni = 0; ni < 5; ni++) {
    for (int k = 0; k <= 16; k++) for (int t = 0; t < trials[ni]; t++) J[nj++] = (job){0, ns[ni], 1.15 + 0.01 * k, t};
    for (int k = 0; k <= 20; k++) for (int t = 0; t < trials[ni]; t++) J[nj++] = (job){1, ns[ni], 1.04 + 0.01 * k, t};
  }
  #pragma omp parallel for schedule(dynamic)
  for (long j = 0; j < nj; j++) {
    job g = J[j]; uint64_t off = (uint64_t)g.t * 7919 * 131 % (nk - g.n); uint64_t core = 0; int ok; uint64_t len;
    // fixed-factor builds: xor uses factor*n (no +32 slack) so the threshold is visible at small n
    if (g.kind == 0) {
      xorf x; x.n = g.n; uint64_t cap = (uint64_t)floor(g.fac * g.n); uint64_t bl = cap / 3; x.bl = bl; x.cap = 3 * bl; len = x.cap;
      uint32_t *pos = malloc(3 * g.n * 4), *order = malloc(g.n * 4), *slot = malloc(g.n * 4); uint64_t seed = seedof(g.t, 3000 + (int)(g.fac * 100));
      for (long i = 0; i < g.n; i++) { uint64_t h = fmix64(keys[off + i] ^ seed), a, b, c; xr_pos(&x, h, &a, &b, &c); pos[3 * i] = a; pos[3 * i + 1] = b; pos[3 * i + 2] = c; }
      ok = peel3(g.n, x.cap, pos, order, slot, &core); free(pos); free(order); free(slot);
    } else {
      fusef b; bf_size(&b, g.n, g.fac, bf_seglen(g.n)); len = b.len;
      uint32_t *pos = malloc(3 * g.n * 4), *order = malloc(g.n * 4), *slot = malloc(g.n * 4); uint64_t seed = seedof(g.t, 4000 + (int)(g.fac * 100));
      for (long i = 0; i < g.n; i++) { uint64_t h = fmix64(keys[off + i] ^ seed), a, c, d; bf_pos(&b, h, &a, &c, &d); pos[3 * i] = a; pos[3 * i + 1] = c; pos[3 * i + 2] = d; }
      ok = peel3(g.n, b.len, pos, order, slot, &core); free(pos); free(order); free(slot);
    }
    #pragma omp critical
    printf("%s %ld %.2f %d %d %.6f %lu\n", g.kind ? "fuse3" : "xor", g.n, g.fac, g.t, ok, (double)core / g.n, len);
  }
}

static void modeR(void) {
  printf("# w n eps trial ok\n");
  long ns[] = {10000, 100000, 1000000, 5843219}; int trials[] = {200, 100, 40, 10};
  typedef struct { int w; long n; double e; int t; } job; job *J = malloc(400000 * sizeof(job)); long nj = 0;
  double e32[] = {0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50};
  double e64[] = {0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.10, 0.12, 0.15};
  double e128[] = {0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.06};
  for (int ni = 0; ni < 4; ni++) for (int t = 0; t < trials[ni]; t++) {
    for (int k = 0; k < 8; k++) J[nj++] = (job){32, ns[ni], e32[k], t};
    for (int k = 0; k < 10; k++) J[nj++] = (job){64, ns[ni], e64[k], t};
    for (int k = 0; k < 9; k++) J[nj++] = (job){128, ns[ni], e128[k], t};
  }
  #pragma omp parallel for schedule(dynamic)
  for (long j = 0; j < nj; j++) {
    job g = J[j]; uint64_t off = (uint64_t)g.t * 7919 * 131 % (nk - g.n);
    int ok = rb_try(keys + off, g.n, (uint64_t)ceil((1 + g.e) * g.n), g.w, seedof(g.t, 5000 + g.w + (int)(g.e * 1000)));
    #pragma omp critical
    printf("%d %ld %.3f %d %d\n", g.w, g.n, g.e, g.t, ok);
  }
}

int main(int argc, char **argv) {
  setvbuf(stdout, 0, _IOLBF, 0); load(); char m = argv[1][0]; int T = argc > 2 ? atoi(argv[2]) : 1;
  printf("# keys %ld\n", nk);
  if (m == 'F') modeF(T); else if (m == 'L') modeL(T); else if (m == 'Q') modeQ(T); else if (m == 'X') modeX(); else if (m == 'R') modeR(); else if (m == 'G') modeG(T); else if (m == 'J') modeJ(T);
  return 0;
}
