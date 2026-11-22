// Skip lists and treaps against std::map and a sorted array, on 64-bit
// pageview key hashes (distinct.bin, in order of first appearance).
//
//   bench shape N SEEDS P      structure: skip-list height and level counts,
//                              mean and largest search cost over every key,
//                              treap mean depth and height, for SEEDS seeds
//   bench nodes N SEEDS P      skip list: mean number of distinct nodes whose
//                              key a search reads, against its comparisons
//   bench time N P ORDER        build and lookup time (ns per operation, median
//                              of 3) for each structure; ORDER is "hash" or
//                              "sorted" (keys inserted in increasing order)
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <vector>

static uint64_t S[4];
static inline uint64_t rotl(uint64_t x, int k) { return (x << k) | (x >> (64 - k)); }
static inline uint64_t rnd() {
  uint64_t r = rotl(S[1] * 5, 7) * 9, t = S[1] << 17;
  S[2] ^= S[0]; S[3] ^= S[1]; S[1] ^= S[2]; S[0] ^= S[3]; S[2] ^= t; S[3] = rotl(S[3], 45);
  return r;
}
static void seed(uint64_t x) {
  for (auto &s : S) { x += 0x9e3779b97f4a7c15ULL; uint64_t z = x;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL; z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL; s = z ^ (z >> 31); }
}
static uint64_t cmps;

// ---- Skip list (Pugh 1990). A node's level is 1 + the number of successes
// of a coin with probability p before the first failure, capped at MAXL.
static const int MAXL = 40;
struct SNode { uint64_t key; int lvl; SNode *next[1]; };
static SNode *snew(uint64_t k, int l) {
  SNode *n = (SNode *)malloc(sizeof(SNode) + (l - 1) * sizeof(SNode *));
  n->key = k; n->lvl = l; for (int i = 0; i < l; i++) n->next[i] = nullptr; return n;
}
struct Skip {
  SNode *head; int level = 1; double p; uint64_t thresh;
  explicit Skip(double p_) : p(p_) { head = snew(0, MAXL); thresh = (uint64_t)(p * 18446744073709551616.0); }
  int randomLevel() { int l = 1; while (l < MAXL && rnd() < thresh) l++; return l; }
  void insert(uint64_t k) {
    SNode *upd[MAXL]; SNode *x = head;
    for (int i = level - 1; i >= 0; i--) { while (x->next[i] && x->next[i]->key < k) x = x->next[i]; upd[i] = x; }
    if (x->next[0] && x->next[0]->key == k) return;
    int l = randomLevel();
    if (l > level) { for (int i = level; i < l; i++) upd[i] = head; level = l; }
    SNode *n = snew(k, l);
    for (int i = 0; i < l; i++) { n->next[i] = upd[i]->next[i]; upd[i]->next[i] = n; }
  }
  // Counts every key comparison of the search, including the one that ends
  // each level and the final equality test.
  bool find(uint64_t k) const {
    const SNode *x = head;
    for (int i = level - 1; i >= 0; i--) {
      while (x->next[i]) { cmps++; if (x->next[i]->key < k) x = x->next[i]; else break; }
    }
    x = x->next[0];
    cmps++;
    return x && x->key == k;
  }
  // Counts the distinct nodes whose key the search reads: a level-ending
  // comparison and the first comparison one level down often read the same node.
  uint64_t nodesRead(uint64_t k) const {
    const SNode *x = head, *last = nullptr; uint64_t n = 0;
    for (int i = level - 1; i >= 0; i--) {
      while (x->next[i]) { if (x->next[i] != last) { n++; last = x->next[i]; } if (x->next[i]->key < k) x = x->next[i]; else break; }
    }
    if (x->next[0] != last) n++;
    return n;
  }
  bool findFast(uint64_t k) const {
    const SNode *x = head;
    for (int i = level - 1; i >= 0; i--) while (x->next[i] && x->next[i]->key < k) x = x->next[i];
    x = x->next[0];
    return x && x->key == k;
  }
};

// ---- Treap (Seidel and Aragon 1996): a binary search tree on the keys that
// is a max-heap on independent random priorities.
struct TNode { uint64_t key, pri; TNode *l, *r; };
struct Treap {
  TNode *root = nullptr; std::vector<TNode> pool; size_t used = 0;
  explicit Treap(size_t n) : pool(n) {}
  TNode *ins(TNode *t, uint64_t k) {
    if (!t) { TNode *n = &pool[used++]; n->key = k; n->pri = rnd(); n->l = n->r = nullptr; return n; }
    if (k < t->key) { t->l = ins(t->l, k); if (t->l->pri > t->pri) { TNode *c = t->l; t->l = c->r; c->r = t; return c; } }
    else if (k > t->key) { t->r = ins(t->r, k); if (t->r->pri > t->pri) { TNode *c = t->r; t->r = c->l; c->l = t; return c; } }
    return t;
  }
  void insert(uint64_t k) { root = ins(root, k); }
  bool find(uint64_t k) const {
    const TNode *t = root;
    while (t) { cmps++; if (k == t->key) return true; t = k < t->key ? t->l : t->r; }
    return false;
  }
  bool findFast(uint64_t k) const {
    const TNode *t = root;
    while (t && t->key != k) t = k < t->key ? t->l : t->r;
    return t != nullptr;
  }
};
static void depths(const TNode *t, int d, double &sum, int &mx, size_t &cnt) {
  while (t) { sum += d; cnt++; if (d > mx) mx = d; depths(t->l, d + 1, sum, mx, cnt); t = t->r; d++; }
}

static std::vector<uint64_t> load(size_t n) {
  FILE *f = fopen("distinct.bin", "rb");
  std::vector<uint64_t> v(n);
  if (fread(v.data(), 8, n, f) != n) { fprintf(stderr, "short read\n"); exit(2); }
  fclose(f);
  return v;
}
static double secs() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }

int main(int argc, char **argv) {
  size_t N = strtoull(argv[2], 0, 10);
  std::vector<uint64_t> keys = load(N);
  if (!strcmp(argv[1], "shape")) {
    int seeds = atoi(argv[3]); double p = atof(argv[4]);
    for (int sd = 1; sd <= seeds; sd++) {
      seed(sd);
      Skip s(p);
      for (uint64_t k : keys) s.insert(k);
      std::vector<size_t> lv(MAXL + 1);
      for (const SNode *x = s.head->next[0]; x; x = x->next[0]) lv[x->lvl]++;
      cmps = 0; uint64_t mx = 0;
      for (uint64_t k : keys) { uint64_t c0 = cmps; if (!s.find(k)) return 5; if (cmps - c0 > mx) mx = cmps - c0; }
      printf("skip seed %d p %.4f height %d mean_cmps %.3f max_cmps %llu levels", sd, p, s.level, (double)cmps / N, (unsigned long long)mx);
      for (int i = 1; i <= s.level; i++) printf(" %zu", lv[i]);
      printf("\n");
      seed(1000 + sd);
      Treap t(N);
      for (uint64_t k : keys) t.insert(k);
      double sum = 0; int h = 0; size_t cnt = 0;
      depths(t.root, 1, sum, h, cnt);
      cmps = 0; for (uint64_t k : keys) if (!t.find(k)) return 6;
      printf("treap seed %d mean_depth %.3f height %d mean_cmps %.3f nodes %zu\n", sd, sum / cnt, h, (double)cmps / N, cnt);
      fflush(stdout);
    }
    return 0;
  }
  if (!strcmp(argv[1], "nodes")) {
    int seeds = atoi(argv[3]); double p = atof(argv[4]);
    for (int sd = 1; sd <= seeds; sd++) {
      seed(sd);
      Skip s(p);
      for (uint64_t k : keys) s.insert(k);
      cmps = 0; uint64_t nodes = 0;
      for (uint64_t k : keys) { s.find(k); nodes += s.nodesRead(k); }
      printf("skip seed %d p %.4f mean_cmps %.3f mean_nodes %.3f\n", sd, p, (double)cmps / N, (double)nodes / N);
      fflush(stdout);
    }
    return 0;
  }
  // time
  double p = atof(argv[3]);
  bool sorted = !strcmp(argv[4], "sorted");
  std::vector<uint64_t> ins = keys;
  if (sorted) std::sort(ins.begin(), ins.end());
  seed(99);
  size_t Q = 2000000;
  std::vector<uint64_t> q(Q);
  for (auto &x : q) x = keys[rnd() % N];
  auto med = [](std::vector<double> v) { std::sort(v.begin(), v.end()); return v[v.size() / 2]; };
  std::vector<double> bS, fS, bT, fT, bM, fM, bA, fA;
  size_t hits = 0;
  for (int rep = 0; rep < 3; rep++) {
    seed(rep + 1);
    { double a = secs(); Skip s(p); for (uint64_t k : ins) s.insert(k); double b = secs();
      for (uint64_t k : q) hits += s.findFast(k); double c = secs(); bS.push_back(1e9 * (b - a) / N); fS.push_back(1e9 * (c - b) / Q); }
    { double a = secs(); Treap t(N); for (uint64_t k : ins) t.insert(k); double b = secs();
      for (uint64_t k : q) hits += t.findFast(k); double c = secs(); bT.push_back(1e9 * (b - a) / N); fT.push_back(1e9 * (c - b) / Q); }
    { double a = secs(); std::map<uint64_t, uint64_t> m; for (uint64_t k : ins) m.emplace(k, k); double b = secs();
      for (uint64_t k : q) hits += m.find(k) != m.end(); double c = secs(); bM.push_back(1e9 * (b - a) / N); fM.push_back(1e9 * (c - b) / Q); }
    { double a = secs(); std::vector<uint64_t> v = ins; std::sort(v.begin(), v.end()); double b = secs();
      for (uint64_t k : q) hits += std::binary_search(v.begin(), v.end(), k); double c = secs(); bA.push_back(1e9 * (b - a) / N); fA.push_back(1e9 * (c - b) / Q); }
  }
  printf("N %zu p %.4f order %s hits %zu\n", N, p, argv[4], hits);
  printf("skiplist build %.1f find %.1f\n", med(bS), med(fS));
  printf("treap build %.1f find %.1f\n", med(bT), med(fT));
  printf("std::map build %.1f find %.1f\n", med(bM), med(fM));
  printf("sorted-array build %.1f find %.1f\n", med(bA), med(fA));
  return 0;
}
