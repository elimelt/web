// Fingerprint filters: cuckoo, quotient, xor, binary fuse and ribbon.
// Every filter takes 64-bit keys and hashes them with fmix64(key ^ seed).
#pragma once
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>

static inline uint64_t fmix64(uint64_t k) { k ^= k >> 33; k *= 0xff51afd7ed558ccdULL; k ^= k >> 33; k *= 0xc4ceb9fe1a85ec53ULL; k ^= k >> 33; return k; }
static inline uint64_t sm64(uint64_t *s) { uint64_t z = (*s += 0x9e3779b97f4a7c15ULL); z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; return z ^ (z >> 31); }
static inline uint64_t mulhi(uint64_t a, uint64_t b) { return (uint64_t)(((unsigned __int128)a * b) >> 64); }
static inline uint64_t rotl64(uint64_t x, int r) { return (x << r) | (x >> (64 - r)); }

/* ---------------- Cuckoo filter (Fan et al. 2014) ----------------
   nb buckets of b slots holding f-bit fingerprints (0 = empty).
   i1 = hash mod nb, fp = nonzero f-bit value from other hash bits,
   alternate bucket: xor form i2 = i1 ^ (H(fp) mod nb) when nb is a power of two,
   otherwise the involution i2 = (H(fp) - i1) mod nb.
*/
typedef struct { uint64_t nb; int b, f, pow2, maxkicks; uint16_t *t; uint64_t seed, rng; uint64_t n; long kicks; } cuckoo;

static inline uint64_t ck_althash(uint16_t fp) { return fmix64((uint64_t)fp * 0x5bd1e9955bd1e995ULL); }
static inline uint64_t ck_alt(const cuckoo *c, uint64_t i, uint16_t fp) {
  uint64_t h = ck_althash(fp);
  if (c->pow2) return i ^ (h & (c->nb - 1));
  uint64_t hm = mulhi(h, c->nb); return hm >= i ? hm - i : hm + c->nb - i;
}
static inline void ck_hash(const cuckoo *c, uint64_t x, uint64_t *i1, uint16_t *fp) {
  uint64_t h = fmix64(x ^ c->seed);
  *i1 = c->pow2 ? (h & (c->nb - 1)) : mulhi(h, c->nb);
  uint16_t v = (uint16_t)((c->pow2 ? (h >> 40) : h) & ((1u << c->f) - 1)); if (v == 0) v = 1; *fp = v;
}
static void ck_init(cuckoo *c, uint64_t nb, int b, int f, int pow2, uint64_t seed) {
  c->nb = nb; c->b = b; c->f = f; c->pow2 = pow2; c->maxkicks = 500; c->seed = seed; c->rng = seed ^ 0xabcdefULL; c->n = 0; c->kicks = 0;
  c->t = calloc(nb * b, 2);
}
static inline int ck_put(cuckoo *c, uint64_t i, uint16_t fp) {
  uint16_t *s = c->t + i * c->b; for (int j = 0; j < c->b; j++) if (!s[j]) { s[j] = fp; return 1; } return 0;
}
// Returns 1 on success, 0 if insertion failed after maxkicks (the victim is lost).
static int ck_insert(cuckoo *c, uint64_t x) {
  uint64_t i1; uint16_t fp; ck_hash(c, x, &i1, &fp);
  if (ck_put(c, i1, fp)) { c->n++; return 1; }
  uint64_t i2 = ck_alt(c, i1, fp); if (ck_put(c, i2, fp)) { c->n++; return 1; }
  uint64_t i = (sm64(&c->rng) & 1) ? i1 : i2;
  for (int k = 0; k < c->maxkicks; k++) {
    int j = (int)(sm64(&c->rng) % c->b); uint16_t *s = c->t + i * c->b; uint16_t v = s[j]; s[j] = fp; fp = v; c->kicks++;
    i = ck_alt(c, i, fp); if (ck_put(c, i, fp)) { c->n++; return 1; }
  }
  return 0;
}
static inline int ck_query(const cuckoo *c, uint64_t x) {
  uint64_t i1; uint16_t fp; ck_hash(c, x, &i1, &fp); uint64_t i2 = ck_alt(c, i1, fp);
  const uint16_t *s = c->t + i1 * c->b, *u = c->t + i2 * c->b; int hit = 0;
  for (int j = 0; j < c->b; j++) hit |= (s[j] == fp) | (u[j] == fp);
  return hit;
}

/* ---------------- Quotient filter (Bender et al. 2012) ----------------
   2^q slots; slot metadata is_occupied, is_continuation, is_shifted;
   remainders of r bits. Fingerprint = top q+r bits of the hash.
   Runs are kept unsorted (new remainder appended at the end of its run).
*/
typedef struct { int q, r; uint64_t ns, mask; uint16_t *sl; uint64_t seed; uint64_t n; long shifts; } qfilter;
#define QF_OCC 1
#define QF_CONT 2
#define QF_SHF 4
static void qf_init(qfilter *f, int q, int r, uint64_t seed) {
  f->q = q; f->r = r; f->ns = 1ULL << q; f->mask = f->ns - 1; f->seed = seed; f->n = 0; f->shifts = 0; f->sl = calloc(f->ns, 2);
}
static void qf_free(qfilter *f) { free(f->sl); }
static inline void qf_fp(const qfilter *f, uint64_t x, uint64_t *fq, uint16_t *fr) {
  uint64_t h = fmix64(x ^ f->seed); *fq = h >> (64 - f->q); *fr = (uint16_t)((h >> (64 - f->q - f->r)) & ((1u << f->r) - 1));
}
static inline int qf_occ(const qfilter *f, uint64_t i) { return f->sl[i] & QF_OCC; }
static inline int qf_cont(const qfilter *f, uint64_t i) { return f->sl[i] & QF_CONT; }
static inline int qf_shf(const qfilter *f, uint64_t i) { return f->sl[i] & QF_SHF; }
static inline uint16_t qf_rem(const qfilter *f, uint64_t i) { return f->sl[i] >> 3; }
static inline int qf_empty(const qfilter *f, uint64_t i) { return (f->sl[i] & 7) == 0; }
// Start slot of the run of quotient fq (fq must be marked occupied).
static inline uint64_t qf_run_start(const qfilter *f, uint64_t fq) {
  uint64_t b = fq; while (qf_shf(f, b)) b = (b - 1) & f->mask;
  uint64_t s = b;
  while (b != fq) {
    do { s = (s + 1) & f->mask; } while (qf_cont(f, s));
    do { b = (b + 1) & f->mask; } while (!qf_occ(f, b));
  }
  return s;
}
static int qf_insert(qfilter *f, uint64_t x) {
  uint64_t fq; uint16_t fr; qf_fp(f, x, &fq, &fr);
  if (f->n >= f->ns) return 0;
  if (qf_empty(f, fq)) { f->sl[fq] = (uint16_t)(fr << 3 | QF_OCC); f->n++; return 1; }
  int was = qf_occ(f, fq); f->sl[fq] |= QF_OCC;
  uint64_t p = qf_run_start(f, fq);
  if (was) { do { p = (p + 1) & f->mask; } while (qf_cont(f, p)); }
  // Place the new remainder at p and shift the rest of the cluster right by one; occupied bits stay put.
  uint16_t cur = (uint16_t)(fr << 3 | (was ? QF_CONT : 0) | (p != fq ? QF_SHF : 0));
  for (;;) {
    uint16_t old = f->sl[p];
    if ((old & 7) == 0) { f->sl[p] = (uint16_t)(cur | (old & QF_OCC)); break; }
    f->sl[p] = (uint16_t)((cur & ~QF_OCC) | (old & QF_OCC));
    cur = (uint16_t)((old & ~(QF_OCC | QF_SHF)) | QF_SHF); p = (p + 1) & f->mask; f->shifts++;
  }
  f->n++; return 1;
}
static inline int qf_query(qfilter *f, uint64_t x) {
  uint64_t fq; uint16_t fr; qf_fp(f, x, &fq, &fr);
  if (!qf_occ(f, fq)) return 0;
  uint64_t s = qf_run_start(f, fq);
  do { if (qf_rem(f, s) == fr) return 1; s = (s + 1) & f->mask; } while (qf_cont(f, s));
  return 0;
}
// Number of slots read by a lookup: from the cluster start to the later of fq and the end of fq's run (1 if fq unoccupied).
static long qf_probe_len(const qfilter *f, uint64_t x) {
  uint64_t fq; uint16_t fr; qf_fp(f, x, &fq, &fr);
  if (!qf_occ(f, fq)) return 1;
  uint64_t b = fq; while (qf_shf(f, b)) b = (b - 1) & f->mask;
  uint64_t s = qf_run_start(f, fq), e = s; while (qf_cont(f, (e + 1) & f->mask)) e = (e + 1) & f->mask;
  uint64_t de = (e - b) & f->mask, dq = (fq - b) & f->mask;
  return (long)(de > dq ? de : dq) + 1;
}

/* ---------------- Xor filter (Graf and Lemire 2020) ----------------
   Array of c = floor(factor*n) + 32 cells in three equal blocks; key x maps
   to h0, h1, h2, one per block; B[h0]^B[h1]^B[h2] = fp(x). Built by peeling.
*/
typedef struct { uint64_t n, cap, bl; int f; uint32_t *B; uint64_t seed; } xorf;
static inline void xr_pos(const xorf *x, uint64_t h, uint64_t *h0, uint64_t *h1, uint64_t *h2) {
  *h0 = mulhi(h, x->bl); *h1 = x->bl + mulhi(rotl64(h, 21), x->bl); *h2 = 2 * x->bl + mulhi(rotl64(h, 42), x->bl);
}
static inline uint32_t fpmask(int f) { return f >= 32 ? 0xffffffffu : ((1u << f) - 1); }
static inline uint32_t xr_fp(uint64_t h, int f) { return (uint32_t)(h ^ (h >> 32)) & fpmask(f); }
// Generic 3-wise or segmented peeling on precomputed positions. Returns 1 if peelable.
// pos: 3n positions; ncell cells. On success fills order[] (key idx) and slot[] (cell peeled at).
static int peel3(uint64_t n, uint64_t ncell, const uint32_t *pos, uint32_t *order, uint32_t *slot, uint64_t *coreleft) {
  uint32_t *cnt = calloc(ncell, 4); uint64_t *xm = calloc(ncell, 8); uint32_t *q = malloc(ncell * 4);
  for (uint64_t i = 0; i < n; i++) for (int j = 0; j < 3; j++) { uint32_t c = pos[3 * i + j]; cnt[c]++; xm[c] ^= i; }
  uint64_t qh = 0, qt = 0, done = 0;
  for (uint64_t c = 0; c < ncell; c++) if (cnt[c] == 1) q[qt++] = (uint32_t)c;
  while (qh < qt) {
    uint32_t c = q[qh++]; if (cnt[c] != 1) continue;
    uint64_t i = xm[c]; order[done] = (uint32_t)i; slot[done] = c; done++;
    for (int j = 0; j < 3; j++) { uint32_t d = pos[3 * i + j]; cnt[d]--; xm[d] ^= i; if (cnt[d] == 1) q[qt++] = d; }
  }
  free(cnt); free(xm); free(q);
  if (coreleft) *coreleft = n - done;
  return done == n;
}
static void assign3(uint64_t n, const uint32_t *pos, const uint32_t *order, const uint32_t *slot, const uint32_t *fps, uint32_t *B) {
  for (uint64_t k = n; k-- > 0;) {
    uint32_t i = order[k], c = slot[k]; uint32_t v = fps[i];
    for (int j = 0; j < 3; j++) { uint32_t d = pos[3 * i + j]; if (d != c) v ^= B[d]; }
    B[c] = v;
  }
}
// Build an xor filter with capacity factor; returns 1 on success.
static int xr_build(xorf *x, const uint64_t *keys, uint64_t n, int f, double factor, uint64_t seed, uint64_t *coreleft) {
  x->n = n; x->f = f; x->seed = seed; x->cap = (uint64_t)floor(factor * n) + 32; x->bl = x->cap / 3; x->cap = 3 * x->bl;
  uint32_t *pos = malloc(3 * n * 4), *fps = malloc(n * 4), *order = malloc(n * 4), *slot = malloc(n * 4);
  for (uint64_t i = 0; i < n; i++) { uint64_t h = fmix64(keys[i] ^ seed), a, b, c; xr_pos(x, h, &a, &b, &c); pos[3 * i] = a; pos[3 * i + 1] = b; pos[3 * i + 2] = c; fps[i] = xr_fp(h, f); }
  int ok = peel3(n, x->cap, pos, order, slot, coreleft);
  x->B = NULL;
  if (ok) { x->B = calloc(x->cap, 4); assign3(n, pos, order, slot, fps, x->B); }
  free(pos); free(fps); free(order); free(slot); return ok;
}
static inline int xr_query(const xorf *x, uint64_t key) {
  uint64_t h = fmix64(key ^ x->seed), a, b, c; xr_pos(x, h, &a, &b, &c);
  return (x->B[a] ^ x->B[b] ^ x->B[c]) == xr_fp(h, x->f);
}

/* ---------------- Binary fuse filter, 3-wise (Graf and Lemire 2022) ---------------- */
typedef struct { uint64_t n, seglen, segmask, segcount, segcountlen, len; int f; uint32_t *B; uint64_t seed; double factor; } fusef;
static uint64_t bf_seglen(uint64_t n) { if (n < 2) n = 2; uint64_t s = 1ULL << (int)floor(log((double)n) / log(3.33) + 2.25); return s > 262144 ? 262144 : s; }
static double bf_factor(uint64_t n) { if (n < 2) n = 2; return fmax(1.125, 0.875 + 0.25 * log(1000000.0) / log((double)n)); }
static void bf_size(fusef *b, uint64_t n, double factor, uint64_t seglen) {
  b->n = n; b->seglen = seglen; b->segmask = seglen - 1; b->factor = factor;
  uint64_t cap = n <= 1 ? 0 : (uint64_t)llround(n * factor);
  int64_t init = (int64_t)((cap + seglen - 1) / seglen) - 2;
  uint64_t len = (uint64_t)(init + 2) * seglen;
  int64_t sc = (int64_t)((len + seglen - 1) / seglen); sc = sc <= 2 ? 1 : sc - 2;
  b->segcount = (uint64_t)sc; b->len = (b->segcount + 2) * seglen; b->segcountlen = b->segcount * seglen;
}
static inline void bf_pos(const fusef *b, uint64_t h, uint64_t *h0, uint64_t *h1, uint64_t *h2) {
  uint64_t hi = mulhi(h, b->segcountlen); *h0 = hi; *h1 = hi + b->seglen; *h2 = *h1 + b->seglen;
  *h1 ^= (h >> 18) & b->segmask; *h2 ^= h & b->segmask;
}
static int bf_build(fusef *b, const uint64_t *keys, uint64_t n, int f, double factor, uint64_t seglen, uint64_t seed, uint64_t *coreleft) {
  bf_size(b, n, factor, seglen); b->f = f; b->seed = seed;
  uint32_t *pos = malloc(3 * n * 4), *fps = malloc(n * 4), *order = malloc(n * 4), *slot = malloc(n * 4);
  for (uint64_t i = 0; i < n; i++) { uint64_t h = fmix64(keys[i] ^ seed), a, c, d; bf_pos(b, h, &a, &c, &d); pos[3 * i] = a; pos[3 * i + 1] = c; pos[3 * i + 2] = d; fps[i] = xr_fp(h, f); }
  int ok = peel3(n, b->len, pos, order, slot, coreleft);
  b->B = NULL;
  if (ok) { b->B = calloc(b->len, 4); assign3(n, pos, order, slot, fps, b->B); }
  free(pos); free(fps); free(order); free(slot); return ok;
}
static inline int bf_query(const fusef *b, uint64_t key) {
  uint64_t h = fmix64(key ^ b->seed), a, c, d; bf_pos(b, h, &a, &c, &d);
  return (b->B[a] ^ b->B[c] ^ b->B[d]) == xr_fp(h, b->f);
}

/* ---------------- Standard ribbon filter (Dillinger and Walzer 2021), width 64 ----------------
   m columns. Key x: start s in [0, m-64], coefficient c (64 bits, bit 0 set), result r = fp(x).
   On-the-fly Gaussian elimination keeps row i with leading bit at column i.
   Solution stored interleaved: for block B of 64 columns, f words (one per result bit).
*/
typedef struct { uint64_t m, nblk; int f; uint64_t *S; uint64_t seed; } ribbon;
static inline void rb_hash(uint64_t m, uint64_t seed, uint64_t x, int f, uint64_t *s, uint64_t *c, uint32_t *r) {
  uint64_t h = fmix64(x ^ seed); *s = mulhi(h, m - 63); *c = fmix64(h ^ 0x9e3779b97f4a7c15ULL) | 1; *r = xr_fp(fmix64(h + 0x2545f4914f6cdd1dULL), f);
}
// Returns 1 on success.
typedef struct { uint64_t s, c; uint32_t r; } rb_row;
// Sorts rows by start position into buckets of 64 columns (counting sort).
static void rb_sort(rb_row *in, rb_row *out, uint64_t n, uint64_t m) {
  uint64_t nb = m / 64 + 2; uint64_t *cnt = calloc(nb + 1, 8);
  for (uint64_t k = 0; k < n; k++) cnt[in[k].s / 64 + 1]++;
  for (uint64_t b = 0; b < nb; b++) cnt[b + 1] += cnt[b];
  for (uint64_t k = 0; k < n; k++) out[cnt[in[k].s / 64]++] = in[k];
  free(cnt);
}
static int rb_build(ribbon *rb, const uint64_t *keys, uint64_t n, int f, uint64_t m, uint64_t seed) {
  rb->m = m; rb->f = f; rb->seed = seed; rb->nblk = (m + 63) / 64;
  rb_row *A = malloc(n * sizeof(rb_row)), *Bs = malloc(n * sizeof(rb_row));
  for (uint64_t k = 0; k < n; k++) rb_hash(m, seed, keys[k], f, &A[k].s, &A[k].c, &A[k].r);
  rb_sort(A, Bs, n, m); free(A);
  uint64_t *C = calloc(m, 8); uint32_t *R = calloc(m, 4); int ok = 1;
  for (uint64_t k = 0; k < n && ok; k++) {
    uint64_t i = Bs[k].s, c = Bs[k].c; uint32_t r = Bs[k].r;
    for (;;) {
      if (!C[i]) { C[i] = c; R[i] = r; break; }
      c ^= C[i]; r ^= R[i];
      if (!c) { if (r) ok = 0; break; }
      int j = __builtin_ctzll(c); c >>= j; i += j;
    }
  }
  free(Bs);
  rb->S = NULL;
  if (ok) {
    uint32_t *sol = calloc(m + 64, 4);
    for (uint64_t i = m; i-- > 0;) {
      uint64_t c = C[i]; uint32_t v = R[i];
      if (c) { c >>= 1; uint64_t k = i + 1; while (c) { int j = __builtin_ctzll(c); k += j; v ^= sol[k]; c >>= j; c >>= 1; k++; } }
      else v = 0;
      sol[i] = v;
    }
    rb->S = calloc((rb->nblk + 1) * f, 8);
    for (uint64_t i = 0; i < m; i++) for (int b = 0; b < f; b++) if (sol[i] >> b & 1) rb->S[(i / 64) * f + b] |= 1ULL << (i % 64);
    free(sol);
  }
  free(C); free(R); return ok;
}
static inline int rb_query(const ribbon *rb, uint64_t x) {
  uint64_t s, c; uint32_t r; rb_hash(rb->m, rb->seed, x, rb->f, &s, &c, &r);
  uint64_t B = s / 64; int o = s % 64; const uint64_t *lo = rb->S + B * rb->f, *hi = lo + rb->f; uint32_t v = 0;
  for (int b = 0; b < rb->f; b++) { uint64_t w = o ? (lo[b] >> o) | (hi[b] << (64 - o)) : lo[b]; v |= (uint32_t)(__builtin_popcountll(w & c) & 1) << b; }
  return v == r;
}
// Ribbon construction success test only, for widths 32, 64 and 128.
static int rb_try(const uint64_t *keys, uint64_t n, uint64_t m, int w, uint64_t seed) {
  int ok = 1;
  if (w == 128) {
    unsigned __int128 *C = calloc(m, 16);
    for (uint64_t k = 0; k < n && ok; k++) {
      uint64_t h = fmix64(keys[k] ^ seed); uint64_t i = mulhi(h, m - 127);
      unsigned __int128 c = ((unsigned __int128)fmix64(h ^ 0x9e3779b97f4a7c15ULL) << 64) | fmix64(h ^ 0x3c6ef372fe94f82aULL) | 1;
      uint32_t r = (uint32_t)fmix64(h + 0x2545f4914f6cdd1dULL);
      (void)r;
      for (;;) {
        if (!C[i]) { C[i] = c; break; }
        c ^= C[i]; if (!c) { ok = 0; break; }
        uint64_t lo = (uint64_t)c; int j = lo ? __builtin_ctzll(lo) : 64 + __builtin_ctzll((uint64_t)(c >> 64)); c >>= j; i += j;
      }
    }
    free(C); return ok;
  }
  uint64_t *C = calloc(m, 8); uint64_t wm = w == 64 ? ~0ULL : ((1ULL << w) - 1);
  for (uint64_t k = 0; k < n && ok; k++) {
    uint64_t h = fmix64(keys[k] ^ seed); uint64_t i = mulhi(h, m - w + 1); uint64_t c = (fmix64(h ^ 0x9e3779b97f4a7c15ULL) & wm) | 1;
    for (;;) {
      if (!C[i]) { C[i] = c; break; }
      c ^= C[i]; if (!c) { ok = 0; break; }
      int j = __builtin_ctzll(c); c >>= j; i += j;
    }
  }
  free(C); return ok;
}

/* Standard ribbon filter with width 128: start s in [0, m-128], 128-bit coefficient with bit 0 set. */
typedef unsigned __int128 u128;
typedef struct { uint64_t m, nblk; int f; uint64_t *S; uint64_t seed; } ribbon128;
static inline void rb128_hash(uint64_t m, uint64_t seed, uint64_t x, int f, uint64_t *s, u128 *c, uint32_t *r) {
  uint64_t h = fmix64(x ^ seed); *s = mulhi(h, m - 127);
  *c = ((u128)fmix64(h ^ 0x9e3779b97f4a7c15ULL) << 64) | fmix64(h ^ 0x3c6ef372fe94f82aULL) | 1;
  *r = xr_fp(fmix64(h + 0x2545f4914f6cdd1dULL), f);
}
static inline int ctz128(u128 c) { uint64_t lo = (uint64_t)c; return lo ? __builtin_ctzll(lo) : 64 + __builtin_ctzll((uint64_t)(c >> 64)); }
typedef struct { uint64_t s; u128 c; uint32_t r; } rb128_row;
static int rb128_build(ribbon128 *rb, const uint64_t *keys, uint64_t n, int f, uint64_t m, uint64_t seed) {
  rb->m = m; rb->f = f; rb->seed = seed; rb->nblk = (m + 63) / 64;
  rb128_row *A = malloc(n * sizeof(rb128_row)), *Bs = malloc(n * sizeof(rb128_row));
  for (uint64_t k = 0; k < n; k++) rb128_hash(m, seed, keys[k], f, &A[k].s, &A[k].c, &A[k].r);
  { uint64_t nb = m / 64 + 2; uint64_t *cnt = calloc(nb + 1, 8);
    for (uint64_t k = 0; k < n; k++) cnt[A[k].s / 64 + 1]++;
    for (uint64_t b = 0; b < nb; b++) cnt[b + 1] += cnt[b];
    for (uint64_t k = 0; k < n; k++) Bs[cnt[A[k].s / 64]++] = A[k];
    free(cnt); }
  free(A);
  u128 *C = calloc(m, 16); uint32_t *R = calloc(m, 4); int ok = 1;
  for (uint64_t k = 0; k < n && ok; k++) {
    uint64_t i = Bs[k].s; u128 c = Bs[k].c; uint32_t r = Bs[k].r;
    for (;;) {
      if (!C[i]) { C[i] = c; R[i] = r; break; }
      c ^= C[i]; r ^= R[i];
      if (!c) { if (r) ok = 0; break; }
      int j = ctz128(c); c >>= j; i += j;
    }
  }
  free(Bs);
  rb->S = NULL;
  if (ok) {
    uint32_t *sol = calloc(m + 128, 4);
    for (uint64_t i = m; i-- > 0;) {
      u128 c = C[i]; uint32_t v = R[i];
      if (c) { c >>= 1; uint64_t k = i + 1; while (c) { int j = ctz128(c); k += j; v ^= sol[k]; c >>= j; c >>= 1; k++; } } else v = 0;
      sol[i] = v;
    }
    rb->S = calloc((rb->nblk + 2) * f, 8);
    for (uint64_t i = 0; i < m; i++) { uint32_t v = sol[i]; while (v) { int b = __builtin_ctz(v); rb->S[(i / 64) * f + b] |= 1ULL << (i % 64); v &= v - 1; } }
    free(sol);
  }
  free(C); free(R); return ok;
}
static inline int rb128_query(const ribbon128 *rb, uint64_t x) {
  uint64_t s; u128 c; uint32_t r; rb128_hash(rb->m, rb->seed, x, rb->f, &s, &c, &r);
  uint64_t B = s / 64; int o = s % 64; const uint64_t *a = rb->S + B * rb->f, *b = a + rb->f, *d = b + rb->f;
  uint64_t clo = (uint64_t)c, chi = (uint64_t)(c >> 64); uint32_t v = 0;
  for (int k = 0; k < rb->f; k++) {
    uint64_t w0 = o ? (a[k] >> o) | (b[k] << (64 - o)) : a[k];
    uint64_t w1 = o ? (b[k] >> o) | (d[k] << (64 - o)) : b[k];
    v |= (uint32_t)((__builtin_popcountll(w0 & clo) ^ __builtin_popcountll(w1 & chi)) & 1) << k;
  }
  return v == r;
}
