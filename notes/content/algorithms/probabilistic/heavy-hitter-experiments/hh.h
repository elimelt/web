// Counter summaries (Misra-Gries, Space-Saving, a top-K candidate set) kept
// as a binary min-heap indexed by a linear-probing hash table, and the three
// linear sketches with their update and query rules.
#ifndef HH_H
#define HH_H
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static inline uint64_t mix64(uint64_t z) {
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
  z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
  return z ^ (z >> 31);
}
static inline uint64_t splitmix(uint64_t *s) { return mix64(*s += 0x9E3779B97F4A7C15ULL); }

enum { SUM_MG, SUM_SS, SUM_TOPK };

typedef struct {
  int mode;
  uint32_t cap, n, hmask;
  uint64_t *key;
  int64_t *val;   // SS: count; MG: count + off; TOPK: current estimate
  int64_t *err;   // SS: overestimation bound recorded at insertion
  int32_t *hpos;  // heap position -> hash slot
  int32_t *slot;  // hash slot -> heap position, -1 if empty
  int64_t off;    // MG: total decrement applied to every counter
} summary;

static summary *summary_new(uint32_t cap, int mode) {
  summary *s = calloc(1, sizeof *s);
  s->mode = mode; s->cap = cap;
  uint32_t h = 1; while (h < 2 * cap + 2) h <<= 1;
  s->hmask = h - 1;
  s->key = calloc(cap, 8); s->val = calloc(cap, 8); s->err = calloc(cap, 8);
  s->hpos = calloc(cap, 4); s->slot = malloc(h * 4);
  memset(s->slot, 0xff, h * 4);
  return s;
}
static void summary_free(summary *s) {
  free(s->key); free(s->val); free(s->err); free(s->hpos); free(s->slot); free(s);
}
static inline uint32_t hslot(const summary *s, uint64_t k) { return (uint32_t)(mix64(k ^ 0x5bd1e995ULL) & s->hmask); }

static inline int32_t summary_find(const summary *s, uint64_t k) {
  for (uint32_t i = hslot(s, k);; i = (i + 1) & s->hmask) {
    int32_t p = s->slot[i];
    if (p < 0) return -1;
    if (s->key[p] == k) return p;
  }
}
static inline void hash_put(summary *s, uint64_t k, int32_t p) {
  uint32_t i = hslot(s, k);
  while (s->slot[i] >= 0) i = (i + 1) & s->hmask;
  s->slot[i] = p; s->hpos[p] = (int32_t)i;
}
// Backward-shift deletion for linear probing.
static inline void hash_del(summary *s, int32_t p) {
  uint32_t i = (uint32_t)s->hpos[p];
  s->slot[i] = -1;
  for (uint32_t j = (i + 1) & s->hmask;; j = (j + 1) & s->hmask) {
    int32_t q = s->slot[j];
    if (q < 0) return;
    uint32_t h = hslot(s, s->key[q]);
    // Move q back to i if its home h is not cyclically in (i, j].
    int move = (i <= j) ? (h <= i || h > j) : (h <= i && h > j);
    if (move) { s->slot[i] = q; s->hpos[q] = (int32_t)i; s->slot[j] = -1; i = j; }
  }
}
static inline void heap_swap(summary *s, uint32_t a, uint32_t b) {
  uint64_t tk = s->key[a]; s->key[a] = s->key[b]; s->key[b] = tk;
  int64_t tv = s->val[a]; s->val[a] = s->val[b]; s->val[b] = tv;
  int64_t te = s->err[a]; s->err[a] = s->err[b]; s->err[b] = te;
  int32_t th = s->hpos[a]; s->hpos[a] = s->hpos[b]; s->hpos[b] = th;
  s->slot[s->hpos[a]] = (int32_t)a; s->slot[s->hpos[b]] = (int32_t)b;
}
static inline uint32_t sift_up(summary *s, uint32_t i) {
  while (i > 0) { uint32_t p = (i - 1) / 2; if (s->val[p] <= s->val[i]) break; heap_swap(s, p, i); i = p; }
  return i;
}
static inline void sift_down(summary *s, uint32_t i) {
  for (;;) {
    uint32_t l = 2 * i + 1, r = l + 1, m = i;
    if (l < s->n && s->val[l] < s->val[m]) m = l;
    if (r < s->n && s->val[r] < s->val[m]) m = r;
    if (m == i) return;
    heap_swap(s, i, m); i = m;
  }
}
static inline void heap_insert(summary *s, uint64_t k, int64_t v, int64_t e) {
  uint32_t p = s->n++;
  s->key[p] = k; s->val[p] = v; s->err[p] = e;
  hash_put(s, k, (int32_t)p);
  sift_up(s, p);
}
static inline void heap_replace_root(summary *s, uint64_t k, int64_t v, int64_t e) {
  hash_del(s, 0);
  s->key[0] = k; s->val[0] = v; s->err[0] = e;
  hash_put(s, k, 0);
  sift_down(s, 0);
}
static inline void heap_pop(summary *s) {
  hash_del(s, 0);
  uint32_t last = --s->n;
  if (last == 0) return;
  s->key[0] = s->key[last]; s->val[0] = s->val[last]; s->err[0] = s->err[last];
  s->hpos[0] = s->hpos[last]; s->slot[s->hpos[0]] = 0;
  sift_down(s, 0);
}

// Space-Saving (Metwally, Agrawal and El Abbadi 2005) with weighted updates:
// an unmonitored key replaces the key with the smallest count and inherits
// that count as its overestimation bound.
static inline void ss_update(summary *s, uint64_t k, uint64_t c) {
  int32_t p = summary_find(s, k);
  if (p >= 0) { s->val[p] += (int64_t)c; sift_down(s, (uint32_t)p); return; }
  if (s->n < s->cap) { heap_insert(s, k, (int64_t)c, 0); return; }
  int64_t mn = s->val[0];
  heap_replace_root(s, k, mn + (int64_t)c, mn);
}

// Misra-Gries (1982) with weighted updates (Berinde et al. 2010): an
// unmonitored key arriving at a full summary decrements every counter, and
// itself, by min(c, smallest counter); counters that reach zero are removed.
// The decrement is kept as a global offset, so an update costs O(log k).
static inline void mg_update(summary *s, uint64_t k, uint64_t c) {
  int32_t p = summary_find(s, k);
  if (p >= 0) { s->val[p] += (int64_t)c; sift_down(s, (uint32_t)p); return; }
  if (s->n < s->cap) { heap_insert(s, k, s->off + (int64_t)c, 0); return; }
  int64_t mn = s->val[0] - s->off, cc = (int64_t)c;
  int64_t d = cc < mn ? cc : mn;
  s->off += d;
  while (s->n && s->val[0] <= s->off) heap_pop(s);
  if (cc > d) heap_insert(s, k, s->off + cc - d, 0);
}

// Candidate set for a sketch: the K keys with the largest estimate at the
// time they were last updated.
static inline void topk_offer(summary *s, uint64_t k, int64_t e) {
  int32_t p = summary_find(s, k);
  if (p >= 0) { s->val[p] = e; sift_down(s, sift_up(s, (uint32_t)p)); return; }
  if (s->n < s->cap) { heap_insert(s, k, e, 0); return; }
  if (e > s->val[0]) heap_replace_root(s, k, e, 0);
}

static inline int64_t summary_value(const summary *s, uint32_t i) {
  return s->mode == SUM_MG ? s->val[i] - s->off : s->val[i];
}
// Estimate of a key's count from a counter summary; -1 if the key is not
// monitored (the caller supplies the convention for that case).
static inline int64_t summary_lookup(const summary *s, uint64_t k) {
  int32_t p = summary_find(s, k);
  return p < 0 ? -1 : summary_value(s, (uint32_t)p);
}
static inline int64_t summary_min(const summary *s) {
  return s->n < s->cap || s->n == 0 ? 0 : summary_value(s, 0);
}

enum { SK_CS, SK_CMS, SK_CU };
typedef struct {
  int type, d;
  uint32_t w;
  uint64_t seed[8];
  int32_t *cell;
} sketch;

static sketch *sketch_new(int type, int d, uint32_t w, uint64_t seed) {
  sketch *k = calloc(1, sizeof *k);
  k->type = type; k->d = d; k->w = w;
  uint64_t r = seed * 0xD1B54A32D192ED03ULL + (uint64_t)type;
  for (int j = 0; j < d; j++) k->seed[j] = splitmix(&r);
  k->cell = calloc((size_t)d * w, 4);
  return k;
}
static void sketch_free(sketch *k) { free(k->cell); free(k); }

static inline int64_t med5(int64_t *v, int n) {
  for (int i = 1; i < n; i++) { int64_t x = v[i]; int j = i - 1; while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; } v[j + 1] = x; }
  return (n & 1) ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}
// Applies the update and returns the key's estimate afterwards.
static inline int64_t sketch_update(sketch *k, uint64_t key, uint64_t c) {
  uint32_t idx[8]; int sg[8];
  for (int j = 0; j < k->d; j++) {
    uint64_t h = mix64(key ^ k->seed[j]);
    idx[j] = j * k->w + (uint32_t)(((h >> 32) * (uint64_t)k->w) >> 32);
    sg[j] = (h & 1) ? 1 : -1;
  }
  if (k->type == SK_CS) {
    int64_t v[8];
    for (int j = 0; j < k->d; j++) { k->cell[idx[j]] += sg[j] * (int32_t)c; v[j] = (int64_t)sg[j] * k->cell[idx[j]]; }
    return med5(v, k->d);
  }
  if (k->type == SK_CMS) {
    int64_t m = INT64_MAX;
    for (int j = 0; j < k->d; j++) { k->cell[idx[j]] += (int32_t)c; if (k->cell[idx[j]] < m) m = k->cell[idx[j]]; }
    return m;
  }
  int64_t m = INT64_MAX;
  for (int j = 0; j < k->d; j++) if (k->cell[idx[j]] < m) m = k->cell[idx[j]];
  int64_t nv = m + (int64_t)c;
  for (int j = 0; j < k->d; j++) if (k->cell[idx[j]] < nv) k->cell[idx[j]] = (int32_t)nv;
  return nv;
}
static inline int64_t sketch_query(const sketch *k, uint64_t key) {
  int64_t v[8], m = INT64_MAX;
  for (int j = 0; j < k->d; j++) {
    uint64_t h = mix64(key ^ k->seed[j]);
    uint32_t i = j * k->w + (uint32_t)(((h >> 32) * (uint64_t)k->w) >> 32);
    int s = (h & 1) ? 1 : -1;
    v[j] = k->type == SK_CS ? (int64_t)s * k->cell[i] : k->cell[i];
    if (v[j] < m) m = v[j];
  }
  return k->type == SK_CS ? med5(v, k->d) : m;
}
#endif
