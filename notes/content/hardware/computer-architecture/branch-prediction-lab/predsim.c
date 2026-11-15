// predsim: replay a conditional-branch trace from btrace through several
// direction predictors and count mispredictions.
//
// Build:  cc -O2 -o predsim predsim.c
// Use:    ./predsim TRACE.bin INSNS > result.json
//
// Every predictor sees the branches in program order, predicts, and is then
// told the outcome, exactly as a core's predictor is updated when the branch
// resolves (no delayed update, no wrong-path pollution). Tables are indexed
// by the low bits of the branch's byte address.
//
// Predictors:
//   always-taken, BTFNT   static: no state at all
//   onebit  N             last outcome per entry
//   bimodal N             2-bit saturating counter per entry (Smith 1981)
//   gshare  N             2-bit counters indexed by pc XOR global history,
//                         history length log2(N) (McFarling 1993)
//   tournament N          bimodal N + gshare N + a 2-bit chooser of N entries
//                         indexed by pc (McFarling's combining predictor)
//   tage                  a 4-table TAGE, about 8.3 KB (Seznec and Michaud 2006)

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  uint64_t pc;
  int backward, taken;
} Br;

static Br *trace;
static size_t n;

static void load(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) {
    perror(path);
    exit(1);
  }
  fseek(f, 0, SEEK_END);
  size_t bytes = (size_t)ftell(f);
  fseek(f, 0, SEEK_SET);
  n = bytes / 8;
  uint64_t *raw = malloc(bytes);
  trace = malloc(n * sizeof *trace);
  if (fread(raw, 8, n, f) != n) {
    fprintf(stderr, "short read\n");
    exit(1);
  }
  fclose(f);
  for (size_t i = 0; i < n; i++) {
    trace[i].pc = raw[i] >> 2;
    trace[i].backward = (raw[i] >> 1) & 1;
    trace[i].taken = raw[i] & 1;
  }
  free(raw);
}

static inline uint8_t sat2(uint8_t c, int t) { return t ? (c < 3 ? c + 1 : 3) : (c > 0 ? c - 1 : 0); }

static uint64_t run_static(int btfnt) {
  uint64_t miss = 0;
  for (size_t i = 0; i < n; i++) {
    int p = btfnt ? trace[i].backward : 1;
    miss += p != trace[i].taken;
  }
  return miss;
}

static uint64_t run_onebit(unsigned logn) {
  uint8_t *t = calloc(1u << logn, 1);  // 0 = not taken
  uint64_t mask = (1u << logn) - 1, miss = 0;
  for (size_t i = 0; i < n; i++) {
    uint8_t *e = &t[trace[i].pc & mask];
    miss += *e != trace[i].taken;
    *e = (uint8_t)trace[i].taken;
  }
  free(t);
  return miss;
}

static uint64_t run_bimodal(unsigned logn) {
  uint8_t *t = malloc(1u << logn);
  memset(t, 1, 1u << logn);  // weakly not taken
  uint64_t mask = (1u << logn) - 1, miss = 0;
  for (size_t i = 0; i < n; i++) {
    uint8_t *e = &t[trace[i].pc & mask];
    miss += (*e >= 2) != trace[i].taken;
    *e = sat2(*e, trace[i].taken);
  }
  free(t);
  return miss;
}

static uint64_t run_gshare(unsigned logn) {
  uint8_t *t = malloc(1u << logn);
  memset(t, 1, 1u << logn);
  uint64_t mask = (1u << logn) - 1, miss = 0, ghr = 0;
  for (size_t i = 0; i < n; i++) {
    uint8_t *e = &t[(trace[i].pc ^ ghr) & mask];
    miss += (*e >= 2) != trace[i].taken;
    *e = sat2(*e, trace[i].taken);
    ghr = ((ghr << 1) | (uint64_t)trace[i].taken) & mask;
  }
  free(t);
  return miss;
}

static uint64_t run_tournament(unsigned logn) {
  size_t sz = (size_t)1 << logn;
  uint8_t *bi = malloc(sz), *gs = malloc(sz), *ch = malloc(sz);
  memset(bi, 1, sz);
  memset(gs, 1, sz);
  memset(ch, 1, sz);  // chooser: >= 2 means trust gshare
  uint64_t mask = sz - 1, miss = 0, ghr = 0;
  for (size_t i = 0; i < n; i++) {
    int t = trace[i].taken;
    uint8_t *b = &bi[trace[i].pc & mask], *g = &gs[(trace[i].pc ^ ghr) & mask], *c = &ch[trace[i].pc & mask];
    int pb = *b >= 2, pg = *g >= 2;
    int p = *c >= 2 ? pg : pb;
    miss += p != t;
    if (pb != pg) *c = sat2(*c, pg == t);
    *b = sat2(*b, t);
    *g = sat2(*g, t);
    ghr = ((ghr << 1) | (uint64_t)t) & mask;
  }
  free(bi);
  free(gs);
  free(ch);
  return miss;
}

// ---- TAGE

#define NT 4
#define LOGT 10
#define LOGB 12
#define HMAX 256
static const int HLEN[NT] = {5, 15, 44, 130};
static const int TAGW[NT] = {8, 9, 10, 11};

typedef struct {
  uint32_t comp;
  int clen, olen, outpoint;
} Folded;

static void fold_init(Folded *f, int clen, int olen) {
  f->comp = 0;
  f->clen = clen;
  f->olen = olen;
  f->outpoint = clen % olen;
}

// hist[k] is the outcome k branches ago, newest first (k = 0 after the push).
static void fold_update(Folded *f, const uint8_t *hist) {
  f->comp = (f->comp << 1) ^ hist[0];
  f->comp ^= (uint32_t)hist[f->clen] << f->outpoint;
  f->comp ^= f->comp >> f->olen;
  f->comp &= (1u << f->olen) - 1;
}

typedef struct {
  uint16_t tag;
  uint8_t ctr;  // 3 bits, >= 4 predicts taken
  uint8_t u;    // 2 bits
} TEntry;

uint64_t tage_storage_bits(void) {
  uint64_t bits = (1u << LOGB) * 2 + 4;
  for (int i = 0; i < NT; i++) bits += (uint64_t)(1u << LOGT) * (3 + 2 + TAGW[i]);
  return bits + HLEN[NT - 1];
}

static uint64_t run_tage(void) {
  uint8_t *base = malloc(1u << LOGB);
  memset(base, 1, 1u << LOGB);
  TEntry *tab[NT];
  Folded fi[NT], ft1[NT], ft2[NT];
  for (int i = 0; i < NT; i++) {
    tab[i] = calloc(1u << LOGT, sizeof(TEntry));
    fold_init(&fi[i], HLEN[i], LOGT);
    fold_init(&ft1[i], HLEN[i], TAGW[i]);
    fold_init(&ft2[i], HLEN[i], TAGW[i] - 1);
  }
  // History buffer, newest at the front; shifted with memmove (HMAX bytes).
  uint8_t hist[HMAX + 1];
  memset(hist, 0, sizeof hist);
  int use_alt = 8;  // 4-bit counter: >= 8 means trust the alternate on a new entry
  uint64_t miss = 0;
  const uint64_t lmask = (1u << LOGT) - 1, bmask = (1u << LOGB) - 1;

  for (size_t k = 0; k < n; k++) {
    uint64_t pc = trace[k].pc;
    int t = trace[k].taken;
    uint32_t idx[NT], tag[NT];
    for (int i = 0; i < NT; i++) {
      idx[i] = (uint32_t)((pc ^ (pc >> LOGT) ^ fi[i].comp) & lmask);
      tag[i] = (uint32_t)((pc ^ ft1[i].comp ^ (ft2[i].comp << 1)) & ((1u << TAGW[i]) - 1));
    }
    int prov = -1, alt = -1;
    for (int i = NT - 1; i >= 0; i--) {
      if (tab[i][idx[i]].tag == tag[i]) {
        if (prov < 0)
          prov = i;
        else {
          alt = i;
          break;
        }
      }
    }
    uint8_t *b = &base[pc & bmask];
    int basepred = *b >= 2;
    int altpred = alt >= 0 ? tab[alt][idx[alt]].ctr >= 4 : basepred;
    int pred, provpred = basepred, weak = 0;
    if (prov >= 0) {
      TEntry *e = &tab[prov][idx[prov]];
      provpred = e->ctr >= 4;
      weak = (e->ctr == 3 || e->ctr == 4) && e->u == 0;
      pred = (weak && use_alt >= 8) ? altpred : provpred;
    } else {
      pred = basepred;
    }
    miss += pred != t;

    // Update.
    if (prov >= 0 && weak && provpred != altpred) {
      if (altpred == t) {
        if (use_alt < 15) use_alt++;
      } else if (use_alt > 0) {
        use_alt--;
      }
    }
    if (pred != t && prov < NT - 1) {
      int placed = 0;
      for (int j = prov + 1; j < NT; j++) {
        TEntry *e = &tab[j][idx[j]];
        if (e->u == 0) {
          e->tag = (uint16_t)tag[j];
          e->ctr = t ? 4 : 3;
          placed = 1;
          break;
        }
      }
      if (!placed)
        for (int j = prov + 1; j < NT; j++)
          if (tab[j][idx[j]].u > 0) tab[j][idx[j]].u--;
    }
    if (prov >= 0) {
      TEntry *e = &tab[prov][idx[prov]];
      if (t) {
        if (e->ctr < 7) e->ctr++;
      } else if (e->ctr > 0) {
        e->ctr--;
      }
      if (provpred != altpred) {
        if (provpred == t) {
          if (e->u < 3) e->u++;
        } else if (e->u > 0) {
          e->u--;
        }
      }
      if (alt < 0 && weak) *b = sat2(*b, t);  // keep the base trained while a new entry settles
    } else {
      *b = sat2(*b, t);
    }
    if ((k & ((1u << 18) - 1)) == (1u << 18) - 1)  // periodic aging of useful bits
      for (int i = 0; i < NT; i++)
        for (uint32_t j = 0; j <= lmask; j++) tab[i][j].u >>= 1;

    memmove(hist + 1, hist, HMAX);
    hist[0] = (uint8_t)t;
    for (int i = 0; i < NT; i++) {
      fold_update(&fi[i], hist);
      fold_update(&ft1[i], hist);
      fold_update(&ft2[i], hist);
    }
  }
  free(base);
  for (int i = 0; i < NT; i++) free(tab[i]);
  return miss;
}

// ---- Trace statistics

static int cmp_desc(const void *a, const void *b) {
  uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
  return x < y ? 1 : x > y ? -1 : 0;
}

static void footprint(uint64_t *statics, uint64_t *p90, uint64_t *p99) {
  // Count executions per static branch with an open-addressing hash table.
  size_t cap = 1 << 20;
  uint64_t *keys = calloc(cap, 8), *cnt = calloc(cap, 8);
  uint64_t s = 0;
  for (size_t i = 0; i < n; i++) {
    uint64_t k = trace[i].pc + 1;
    size_t h = (size_t)((k * 0x9E3779B97F4A7C15ull) >> 44) & (cap - 1);
    while (keys[h] && keys[h] != k) h = (h + 1) & (cap - 1);
    if (!keys[h]) {
      keys[h] = k;
      s++;
    }
    cnt[h]++;
  }
  uint64_t *c = malloc(s * 8);
  size_t m = 0;
  for (size_t h = 0; h < cap; h++)
    if (keys[h]) c[m++] = cnt[h];
  qsort(c, m, 8, cmp_desc);
  uint64_t acc = 0;
  *p90 = *p99 = 0;
  for (size_t i = 0; i < m; i++) {
    acc += c[i];
    if (!*p90 && acc * 10 >= (uint64_t)n * 9) *p90 = i + 1;
    if (!*p99 && acc * 100 >= (uint64_t)n * 99) *p99 = i + 1;
  }
  *statics = s;
  free(keys);
  free(cnt);
  free(c);
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: %s TRACE.bin INSNS\n", argv[0]);
    return 2;
  }
  load(argv[1]);
  uint64_t insns = strtoull(argv[2], NULL, 10), taken = 0, backward = 0, back_taken = 0;
  for (size_t i = 0; i < n; i++) {
    taken += trace[i].taken;
    backward += trace[i].backward;
    back_taken += trace[i].backward & trace[i].taken;
  }
  uint64_t statics, p90, p99;
  footprint(&statics, &p90, &p99);
  printf("{\"branches\": %zu, \"insns\": %llu, \"taken\": %llu, \"backward\": %llu, \"backward_taken\": %llu,\n",
         n, (unsigned long long)insns, (unsigned long long)taken, (unsigned long long)backward,
         (unsigned long long)back_taken);
  printf(" \"static_branches\": %llu, \"static_for_90pct\": %llu, \"static_for_99pct\": %llu,\n \"results\": [\n",
         (unsigned long long)statics, (unsigned long long)p90, (unsigned long long)p99);
#define ROW(name, size, bits, m, last) \
  printf("  {\"predictor\": \"%s\", \"entries\": %llu, \"bits\": %llu, \"misses\": %llu}%s\n", name, \
         (unsigned long long)(size), (unsigned long long)(bits), (unsigned long long)(m), last ? "" : ",")
  ROW("always-taken", 0, 0, run_static(0), 0);
  ROW("btfnt", 0, 0, run_static(1), 0);
  for (unsigned l = 6; l <= 16; l++) ROW("onebit", 1u << l, 1u << l, run_onebit(l), 0);
  for (unsigned l = 6; l <= 16; l++) ROW("bimodal", 1u << l, 2u << l, run_bimodal(l), 0);
  for (unsigned l = 6; l <= 16; l++) ROW("gshare", 1u << l, (2u << l) + l, run_gshare(l), 0);
  for (unsigned l = 6; l <= 15; l++) ROW("tournament", 1u << l, (6u << l) + l, run_tournament(l), 0);
  ROW("tage", 0, tage_storage_bits(), run_tage(), 1);
  printf(" ]}\n");
  return 0;
}
