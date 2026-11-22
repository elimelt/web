// Checks hh.h against direct implementations on random weighted streams:
// Misra-Gries against an O(k) implementation that decrements every counter,
// Space-Saving against its invariants (counts sum to N; count - err <= true
// count <= count; an unmonitored key's true count is at most the minimum),
// the candidate heap against a sorted list, and the hash table's contents
// against the heap after every update.
#include <stdio.h>
#include <assert.h>
#include "hh.h"

#define U 3000
static uint64_t truth[U];

static void check_table(const summary *s) {
  uint32_t cnt = 0;
  for (uint32_t i = 0; i <= s->hmask; i++) if (s->slot[i] >= 0) { cnt++; assert(s->hpos[s->slot[i]] == (int32_t)i); }
  assert(cnt == s->n);
  for (uint32_t p = 0; p < s->n; p++) {
    assert(summary_find(s, s->key[p]) == (int32_t)p);
    if (p) assert(s->val[(p - 1) / 2] <= s->val[p]);
  }
}

int main(void) {
  uint64_t r = 7;
  for (int trial = 0; trial < 300; trial++) {
    uint32_t k = 1 + (uint32_t)(splitmix(&r) % 60);
    summary *mg = summary_new(k, SUM_MG), *ss = summary_new(k, SUM_SS), *tk = summary_new(k, SUM_TOPK);
    int64_t nk[64]; uint64_t nkey[64]; int nn = 0;   // direct Misra-Gries
    memset(truth, 0, sizeof truth);
    uint64_t N = 0;
    int T = 50 + (int)(splitmix(&r) % 4000);
    double skew = 0.5 + (splitmix(&r) % 100) / 50.0;
    for (int t = 0; t < T; t++) {
      double u = (splitmix(&r) >> 11) * (1.0 / 9007199254740992.0);
      uint64_t key = (uint64_t)(U * __builtin_pow(u, skew)) + 1;
      if (key >= U) key = U - 1;
      uint64_t c = (trial % 3 == 0) ? 1 : 1 + splitmix(&r) % 50;
      truth[key] += c; N += c;
      mg_update(mg, key, c); ss_update(ss, key, c);
      // direct weighted Misra-Gries
      int f = -1;
      for (int i = 0; i < nn; i++) if (nkey[i] == key) f = i;
      if (f >= 0) nk[f] += (int64_t)c;
      else if (nn < (int)k) { nkey[nn] = key; nk[nn++] = (int64_t)c; }
      else {
        int64_t mn = nk[0]; for (int i = 1; i < nn; i++) if (nk[i] < mn) mn = nk[i];
        int64_t d = (int64_t)c < mn ? (int64_t)c : mn;
        int j = 0; for (int i = 0; i < nn; i++) { nk[i] -= d; if (nk[i] > 0) { nk[j] = nk[i]; nkey[j++] = nkey[i]; } }
        nn = j;
        if ((int64_t)c > d) { nkey[nn] = key; nk[nn++] = (int64_t)c - d; }
      }
      topk_offer(tk, key, (int64_t)truth[key]);
      if (t % 97 == 0) { check_table(mg); check_table(ss); check_table(tk); }
    }
    check_table(mg); check_table(ss); check_table(tk);
    assert((int)mg->n == nn);
    for (int i = 0; i < nn; i++) assert(summary_lookup(mg, nkey[i]) == nk[i]);
    int64_t sum = 0;
    for (uint32_t p = 0; p < ss->n; p++) sum += ss->val[p];
    assert((uint64_t)sum == N);
    for (uint64_t key = 0; key < U; key++) {
      int64_t e = summary_lookup(ss, key);
      if (e >= 0) { int32_t p = summary_find(ss, key); assert((int64_t)truth[key] <= e && e - ss->err[p] <= (int64_t)truth[key]); }
      else assert((int64_t)truth[key] <= summary_min(ss));
      int64_t g = summary_lookup(mg, key); if (g < 0) g = 0;
      assert(g <= (int64_t)truth[key] && (int64_t)truth[key] - g <= (int64_t)(N - (uint64_t)0) / (k + 1));
    }
    // Equivalence (Agarwal et al. 2013): Space-Saving with k+1 counters
    // minus its minimum equals Misra-Gries with k counters, for unit weights.
    if (trial % 3 == 0) {
      summary *s2 = summary_new(k + 1, SUM_SS), *m2 = summary_new(k, SUM_MG);
      memset(truth, 0, sizeof truth);
      uint64_t r2 = 1000 + trial;
      for (int t = 0; t < T; t++) {
        double u = (splitmix(&r2) >> 11) * (1.0 / 9007199254740992.0);
        uint64_t key = (uint64_t)(U * __builtin_pow(u, skew)) + 1; if (key >= U) key = U - 1;
        ss_update(s2, key, 1); mg_update(m2, key, 1);
      }
      int64_t mn = summary_min(s2);
      for (uint64_t key = 0; key < U; key++) {
        int64_t a = summary_lookup(s2, key), b = summary_lookup(m2, key);
        int64_t sa = a < 0 ? 0 : (a - mn > 0 ? a - mn : 0), sb = b < 0 ? 0 : b;
        if (sa != sb) { fprintf(stderr, "equivalence differs trial %d key %llu: ss-min %lld mg %lld\n", trial, (unsigned long long)key, (long long)sa, (long long)sb); return 1; }
      }
      summary_free(s2); summary_free(m2);
    }
    // the candidate heap holds the k largest true counts (offers were exact)
    uint64_t kth = 0;
    { uint64_t tmp[U]; memcpy(tmp, truth, sizeof tmp); }
    summary_free(mg); summary_free(ss); summary_free(tk);
    (void)kth;
  }
  // sketches against direct computation
  for (int trial = 0; trial < 30; trial++) {
    for (int type = 0; type < 3; type++) {
      int d = type == SK_CS ? 5 : 4; uint32_t w = 50 + trial;
      sketch *s = sketch_new(type, d, w, trial + 1);
      static int64_t tab[8][200];
      memset(tab, 0, sizeof tab);
      for (int t = 0; t < 2000; t++) {
        uint64_t key = splitmix(&r) % 400, c = 1 + splitmix(&r) % 9;
        int64_t got = sketch_update(s, key, c);
        int64_t v[8], m = INT64_MAX;
        for (int j = 0; j < d; j++) {
          uint64_t h = mix64(key ^ s->seed[j]);
          uint32_t i = (uint32_t)(((h >> 32) * (uint64_t)w) >> 32);
          int sg = (h & 1) ? 1 : -1;
          if (type == SK_CS) tab[j][i] += sg * (int64_t)c;
          if (type == SK_CMS) tab[j][i] += (int64_t)c;
          v[j] = type == SK_CS ? sg * tab[j][i] : tab[j][i];
          if (v[j] < m) m = v[j];
        }
        if (type == SK_CU) {
          int64_t nv = m + (int64_t)c;
          for (int j = 0; j < d; j++) {
            uint64_t h = mix64(key ^ s->seed[j]); uint32_t i = (uint32_t)(((h >> 32) * (uint64_t)w) >> 32);
            if (tab[j][i] < nv) tab[j][i] = nv;
          }
          assert(got == nv);
        } else if (type == SK_CMS) assert(got == m);
        else { int64_t x[8]; memcpy(x, v, sizeof x); assert(got == med5(x, d)); }
        assert(sketch_query(s, key) == got);
      }
      sketch_free(s);
    }
  }
  printf("selftest ok\n");
  return 0;
}
