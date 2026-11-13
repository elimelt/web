// Page replacement simulator for page reference strings.
// Input: a file of little-endian uint32 page ids numbered 0..D-1.
// usage: pagesim TRACE POLICY F1 [F2 ...]   POLICY in fifo lru clock opt arc random:SEED
// Prints one line per frame count: "<policy> <frames> <faults>".
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint32_t *ref; static long n; static uint32_t D;

static void load(const char *path) {
  FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(1); }
  fseek(f, 0, SEEK_END); n = ftell(f) / 4; fseek(f, 0, SEEK_SET);
  ref = malloc(n * 4); if (fread(ref, 4, n, f) != (size_t)n) exit(1); fclose(f);
  D = 0; for (long i = 0; i < n; i++) if (ref[i] + 1 > D) D = ref[i] + 1;
}

static long fifo(int F) {
  int32_t *slot = malloc(D * 4); memset(slot, -1, D * 4);
  uint32_t *q = malloc(F * 4); long faults = 0; int used = 0, head = 0;
  for (long t = 0; t < n; t++) {
    uint32_t p = ref[t]; if (slot[p] >= 0) continue; faults++;
    if (used < F) { q[used] = p; slot[p] = used++; }
    else { slot[q[head]] = -1; q[head] = p; slot[p] = head; head = (head + 1) % F; }
  }
  free(slot); free(q); return faults;
}

static long clock_(int F) {
  int32_t *slot = malloc(D * 4); memset(slot, -1, D * 4);
  uint32_t *pg = malloc(F * 4); uint8_t *bit = calloc(F, 1); long faults = 0; int used = 0, hand = 0;
  for (long t = 0; t < n; t++) {
    uint32_t p = ref[t];
    if (slot[p] >= 0) { bit[slot[p]] = 1; continue; }
    faults++;
    if (used < F) { pg[used] = p; bit[used] = 1; slot[p] = used++; continue; }
    while (bit[hand]) { bit[hand] = 0; hand = (hand + 1) % F; }
    slot[pg[hand]] = -1; pg[hand] = p; bit[hand] = 1; slot[p] = hand; hand = (hand + 1) % F;
  }
  free(slot); free(pg); free(bit); return faults;
}

// LRU with a doubly linked list over page ids.
static long lru(int F) {
  int32_t *prev = malloc(D * 4), *next = malloc(D * 4); uint8_t *in = calloc(D, 1);
  int32_t headp = -1, tailp = -1; long faults = 0; int used = 0;
  for (long t = 0; t < n; t++) {
    int32_t p = ref[t];
    if (in[p]) {
      if (p == headp) continue;
      next[prev[p]] = next[p]; if (next[p] >= 0) prev[next[p]] = prev[p]; else tailp = prev[p];
    } else {
      faults++;
      if (used == F) { int32_t v = tailp; in[v] = 0; tailp = prev[v]; if (tailp >= 0) next[tailp] = -1; else headp = -1; }
      else used++;
      in[p] = 1;
    }
    prev[p] = -1; next[p] = headp; if (headp >= 0) prev[headp] = p; headp = p; if (tailp < 0) tailp = p;
  }
  free(prev); free(next); free(in); return faults;
}

// OPT (Belady's MIN): evict the resident page whose next use is furthest away.
static int32_t *nextuse;
static void build_next(void) {
  nextuse = malloc(n * 4); int32_t *last = malloc(D * 4);
  for (uint32_t i = 0; i < D; i++) last[i] = INT32_MAX;
  for (long t = n - 1; t >= 0; t--) { nextuse[t] = last[ref[t]]; last[ref[t]] = (int32_t)t; }
  free(last);
}
// max-heap of (next use, page) with lazy deletion
typedef struct { int32_t key; uint32_t page; } item;
static long opt(int F) {
  if (!nextuse) build_next();
  int32_t *cur = malloc(D * 4); for (uint32_t i = 0; i < D; i++) cur[i] = -1; // current next use if resident
  long cap = n + 1; item *h = malloc(cap * sizeof(item)); long hn = 0; long faults = 0; int used = 0;
  #define PUSH(k, pp) do { long i_ = hn++; h[i_] = (item){k, pp}; while (i_ > 0) { long par = (i_ - 1) / 2; if (h[par].key >= h[i_].key) break; item tmp = h[par]; h[par] = h[i_]; h[i_] = tmp; i_ = par; } } while (0)
  for (long t = 0; t < n; t++) {
    uint32_t p = ref[t];
    if (cur[p] >= 0) { cur[p] = nextuse[t]; PUSH(nextuse[t], p); continue; }
    faults++;
    if (used < F) used++;
    else {
      for (;;) { // pop max, skipping stale entries
        item top = h[0]; h[0] = h[--hn]; long i = 0;
        for (;;) { long l = 2 * i + 1, r = l + 1, m = i; if (l < hn && h[l].key > h[m].key) m = l; if (r < hn && h[r].key > h[m].key) m = r; if (m == i) break; item tmp = h[m]; h[m] = h[i]; h[i] = tmp; i = m; }
        if (cur[top.page] == top.key) { cur[top.page] = -1; break; }
      }
    }
    cur[p] = nextuse[t]; PUSH(nextuse[t], p);
    if (hn > cap - 2) { fprintf(stderr, "heap overflow\n"); exit(1); }
  }
  free(cur); free(h); return faults;
}

static long randomp(int F, uint64_t seed) {
  int32_t *slot = malloc(D * 4); memset(slot, -1, D * 4);
  uint32_t *pg = malloc(F * 4); long faults = 0; int used = 0; uint64_t x = seed * 2654435761u + 1;
  for (long t = 0; t < n; t++) {
    uint32_t p = ref[t]; if (slot[p] >= 0) continue; faults++;
    if (used < F) { pg[used] = p; slot[p] = used++; continue; }
    x ^= x << 13; x ^= x >> 7; x ^= x << 17; int v = x % F;
    slot[pg[v]] = -1; pg[v] = p; slot[p] = v;
  }
  free(slot); free(pg); return faults;
}

// ARC (Megiddo and Modha, FAST 2003, Fig. 4). Lists: T1, T2 resident; B1, B2 ghosts.
enum { NONE, T1, T2, B1, B2 };
static int32_t *pv, *nx; static uint8_t *where; static int32_t hd[5], tl[5]; static long len[5];
static void rm(int32_t p) { int L = where[p]; if (pv[p] >= 0) nx[pv[p]] = nx[p]; else hd[L] = nx[p]; if (nx[p] >= 0) pv[nx[p]] = pv[p]; else tl[L] = pv[p]; len[L]--; where[p] = NONE; }
static void push_mru(int L, int32_t p) { pv[p] = -1; nx[p] = hd[L]; if (hd[L] >= 0) pv[hd[L]] = p; hd[L] = p; if (tl[L] < 0) tl[L] = p; len[L]++; where[p] = L; }
static int32_t lru_of(int L) { return tl[L]; }
static double arc_p;
static void replace(int32_t x, long c) {
  if (len[T1] > 0 && (len[T1] > arc_p || (where[x] == B2 && (double)len[T1] == arc_p))) { int32_t v = lru_of(T1); rm(v); push_mru(B1, v); }
  else { int32_t v = lru_of(T2); rm(v); push_mru(B2, v); }
  (void)c;
}
static long arc(int F) {
  long c = F; pv = malloc(D * 4); nx = malloc(D * 4); where = calloc(D, 1);
  for (int i = 0; i < 5; i++) { hd[i] = tl[i] = -1; len[i] = 0; } arc_p = 0; long faults = 0;
  for (long t = 0; t < n; t++) {
    int32_t x = ref[t]; int w = where[x];
    if (w == T1 || w == T2) { rm(x); push_mru(T2, x); continue; }
    faults++;
    if (w == B1) {
      double d = len[B1] >= len[B2] ? 1 : (double)len[B2] / len[B1];
      arc_p = arc_p + d < c ? arc_p + d : c; replace(x, c); rm(x); push_mru(T2, x); continue;
    }
    if (w == B2) {
      double d = len[B2] >= len[B1] ? 1 : (double)len[B1] / len[B2];
      arc_p = arc_p - d > 0 ? arc_p - d : 0; replace(x, c); rm(x); push_mru(T2, x); continue;
    }
    long l1 = len[T1] + len[B1];
    if (l1 == c) {
      if (len[T1] < c) { rm(lru_of(B1)); replace(x, c); }
      else rm(lru_of(T1));
    } else {
      long tot = l1 + len[T2] + len[B2];
      if (tot >= c) { if (tot == 2 * c) rm(lru_of(B2)); replace(x, c); }
    }
    push_mru(T1, x);
  }
  free(pv); free(nx); free(where); return faults;
}

int main(int argc, char **argv) {
  load(argv[1]); const char *pol = argv[2];
  for (int i = 3; i < argc; i++) {
    int F = atoi(argv[i]); long f;
    if (!strcmp(pol, "fifo")) f = fifo(F);
    else if (!strcmp(pol, "lru")) f = lru(F);
    else if (!strcmp(pol, "clock")) f = clock_(F);
    else if (!strcmp(pol, "opt")) f = opt(F);
    else if (!strcmp(pol, "arc")) f = arc(F);
    else if (!strncmp(pol, "random:", 7)) f = randomp(F, strtoull(pol + 7, NULL, 10));
    else { fprintf(stderr, "unknown policy\n"); return 1; }
    printf("%s %d %ld\n", pol, F, f); fflush(stdout);
  }
  printf("# refs %ld distinct %u\n", n, D);
  return 0;
}
