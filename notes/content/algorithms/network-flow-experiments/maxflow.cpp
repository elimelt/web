// Edmonds-Karp, Dinic and highest-label push-relabel on DIMACS max-flow files.
//
//   g++ -O2 -std=c++17 -o maxflow maxflow.cpp
//   taskset -c 2 ./maxflow instance.max --algos ek,dinic,pr --reps 5 --limit 60 --limit-ek 30
//
// For each repetition the algorithms run in a rotated order on a freshly reset
// residual graph. Every run is checked: capacity and conservation constraints,
// the flow value, and the s-t cut given by the vertices reachable from s in the
// final residual graph, whose capacity must equal the flow value. One JSON
// object per run is printed on stdout.

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <map>
#include <string>
#include <vector>

using i64 = long long;
using Clock = std::chrono::steady_clock;

struct Graph {
  int n = 0, s = -1, t = -1;
  std::vector<int> first;  // CSR offsets, size n + 1
  std::vector<int> head;   // arc -> head vertex
  std::vector<int> tail;   // arc -> tail vertex
  std::vector<int> mate;   // arc -> reverse arc
  std::vector<i64> orig;   // original capacity (0 for reverse arcs)
  std::vector<i64> res;    // residual capacity
  i64 edges = 0;
};

static Graph read_dimacs(const char* path) {
  FILE* f = std::fopen(path, "r");
  if (!f) {
    std::perror(path);
    std::exit(2);
  }
  Graph g;
  std::vector<int> eu, ev;
  std::vector<i64> ec;
  char line[512];
  while (std::fgets(line, sizeof line, f)) {
    if (line[0] == 'p') {
      char kind[16];
      long long n, m;
      std::sscanf(line, "p %15s %lld %lld", kind, &n, &m);
      g.n = (int)n;
      eu.reserve(m), ev.reserve(m), ec.reserve(m);
    } else if (line[0] == 'n') {
      int v;
      char w;
      std::sscanf(line, "n %d %c", &v, &w);
      if (w == 's') g.s = v - 1;
      else g.t = v - 1;
    } else if (line[0] == 'a') {
      int u, v;
      long long c;
      std::sscanf(line, "a %d %d %lld", &u, &v, &c);
      if (u == v) continue;
      eu.push_back(u - 1), ev.push_back(v - 1), ec.push_back(c);
    }
  }
  std::fclose(f);
  const size_t m = eu.size();
  g.edges = (i64)m;
  std::vector<int> deg(g.n + 1, 0);
  for (size_t i = 0; i < m; i++) deg[eu[i]]++, deg[ev[i]]++;
  g.first.assign(g.n + 1, 0);
  for (int v = 0; v < g.n; v++) g.first[v + 1] = g.first[v] + deg[v];
  std::vector<int> pos(g.first.begin(), g.first.end() - 1);
  g.head.resize(2 * m), g.tail.resize(2 * m), g.mate.resize(2 * m), g.orig.resize(2 * m);
  for (size_t i = 0; i < m; i++) {
    int a = pos[eu[i]]++, b = pos[ev[i]]++;
    g.head[a] = ev[i], g.tail[a] = eu[i], g.orig[a] = ec[i], g.mate[a] = b;
    g.head[b] = eu[i], g.tail[b] = ev[i], g.orig[b] = 0, g.mate[b] = a;
  }
  g.res = g.orig;
  return g;
}

struct Result {
  i64 value = 0;
  bool timeout = false;
  i64 augmentations = 0, phases = 0, arc_scans = 0;
  i64 pushes = 0, relabels = 0, global_relabels = 0, gap_nodes = 0;
  double phase1_s = 0;
};

static double since(Clock::time_point t0) { return std::chrono::duration<double>(Clock::now() - t0).count(); }

static void push_flow(Graph& g, int a, i64 d) {
  g.res[a] -= d;
  g.res[g.mate[a]] += d;
}

// ------------------------------------------------------------ Edmonds-Karp

static Result edmonds_karp(Graph& g, double limit) {
  Result r;
  auto t0 = Clock::now();
  std::vector<int> parent(g.n), queue(g.n);
  for (;;) {
    std::fill(parent.begin(), parent.end(), -1);
    parent[g.s] = -2;
    int qh = 0, qt = 0;
    queue[qt++] = g.s;
    while (qh < qt && parent[g.t] == -1) {
      int u = queue[qh++];
      for (int a = g.first[u]; a < g.first[u + 1]; a++) {
        r.arc_scans++;
        int v = g.head[a];
        if (g.res[a] > 0 && parent[v] == -1) {
          parent[v] = a;
          queue[qt++] = v;
        }
      }
    }
    if (parent[g.t] == -1) break;
    i64 b = INT64_MAX;
    for (int v = g.t; v != g.s; v = g.tail[parent[v]]) b = std::min(b, g.res[parent[v]]);
    for (int v = g.t; v != g.s; v = g.tail[parent[v]]) push_flow(g, parent[v], b);
    r.value += b;
    r.augmentations++;
    if ((r.augmentations & 255) == 0 && since(t0) > limit) {
      r.timeout = true;
      break;
    }
  }
  return r;
}

// ------------------------------------------------------------ Dinic

static Result dinic(Graph& g, double limit) {
  Result r;
  auto t0 = Clock::now();
  std::vector<int> level(g.n), cur(g.n), queue(g.n), path;
  path.reserve(g.n);
  for (;;) {
    std::fill(level.begin(), level.end(), -1);
    level[g.s] = 0;
    int qh = 0, qt = 0;
    queue[qt++] = g.s;
    while (qh < qt) {
      int u = queue[qh++];
      for (int a = g.first[u]; a < g.first[u + 1]; a++) {
        r.arc_scans++;
        int v = g.head[a];
        if (g.res[a] > 0 && level[v] < 0) {
          level[v] = level[u] + 1;
          queue[qt++] = v;
        }
      }
    }
    if (level[g.t] < 0) break;
    r.phases++;
    for (int v = 0; v < g.n; v++) cur[v] = g.first[v];
    // Blocking flow by depth-first search with current-arc pointers.
    path.clear();
    int u = g.s;
    for (;;) {
      if (u == g.t) {
        i64 b = INT64_MAX;
        for (int a : path) b = std::min(b, g.res[a]);
        size_t cut = path.size();
        for (size_t i = 0; i < path.size(); i++) {
          push_flow(g, path[i], b);
          if (g.res[path[i]] == 0 && cut == path.size()) cut = i;
        }
        r.value += b;
        r.augmentations++;
        u = g.tail[path[cut]];
        path.resize(cut);
        continue;
      }
      int a = cur[u];
      for (; a < g.first[u + 1]; a++) {
        r.arc_scans++;
        if (g.res[a] > 0 && level[g.head[a]] == level[u] + 1) break;
      }
      cur[u] = a;
      if (a < g.first[u + 1]) {
        path.push_back(a);
        u = g.head[a];
      } else {
        level[u] = -1;  // dead end for the rest of the phase
        if (u == g.s) break;
        int back = path.back();
        path.pop_back();
        u = g.tail[back];
        cur[u]++;
      }
    }
    if (since(t0) > limit) {
      r.timeout = true;
      break;
    }
  }
  return r;
}

// ------------------------------------------------------------ push-relabel
// Highest-label selection, exact global relabeling by reverse BFS, and the gap
// heuristic. Phase 1 computes a maximum preflow toward t; its value is the max
// flow and it already fixes a minimum cut. Phase 2 returns the remaining
// excess to s along the arcs that carry flow, so every run ends with a flow
// that is verified like the others.

struct PushRelabel {
  Graph& g;
  Result r;
  int n;
  const int sink, banned;
  std::vector<i64> excess;
  std::vector<int> d, cur;
  // bucket b holds active vertices of label b (singly linked stacks) and all
  // vertices of label b (doubly linked lists, for the gap heuristic)
  std::vector<int> act_head, act_next;
  std::vector<int> all_head, all_next, all_prev;
  std::vector<int> queue;
  int highest = 0, max_label = 0;
  i64 work = 0;
  const i64 update_work;

  explicit PushRelabel(Graph& gr)
      : g(gr), n(gr.n), sink(gr.t), banned(gr.s), excess(n, 0), d(n, 0), cur(n), act_head(n + 1, -1),
        act_next(n, -1), all_head(n + 1, -1), all_next(n, -1), all_prev(n, -1), queue(n),
        update_work(2 * (6 * (i64)gr.n + 2 * gr.edges)) {}

  void all_insert(int v) {
    int b = d[v];
    all_prev[v] = -1;
    all_next[v] = all_head[b];
    if (all_head[b] >= 0) all_prev[all_head[b]] = v;
    all_head[b] = v;
  }
  void all_remove(int v) {
    int b = d[v];
    if (all_prev[v] >= 0) all_next[all_prev[v]] = all_next[v];
    else all_head[b] = all_next[v];
    if (all_next[v] >= 0) all_prev[all_next[v]] = all_prev[v];
  }
  void activate(int v) {
    act_next[v] = act_head[d[v]];
    act_head[d[v]] = v;
    if (d[v] > highest) highest = d[v];
  }

  // d(v) = residual distance from v to the target; n where there is no path.
  void global_relabel() {
    r.global_relabels++;
    std::fill(act_head.begin(), act_head.end(), -1);
    std::fill(all_head.begin(), all_head.end(), -1);
    std::fill(d.begin(), d.end(), n);
    d[sink] = 0;
    int qh = 0, qt = 0;
    queue[qt++] = sink;
    while (qh < qt) {
      int v = queue[qh++];
      for (int a = g.first[v]; a < g.first[v + 1]; a++) {
        r.arc_scans++;
        int w = g.head[a];
        if (d[w] == n && w != banned && g.res[g.mate[a]] > 0) {
          d[w] = d[v] + 1;
          queue[qt++] = w;
        }
      }
    }
    highest = 0;
    max_label = 0;
    for (int v = 0; v < n; v++) {
      cur[v] = g.first[v];
      if (d[v] < n && v != sink) {
        all_insert(v);
        if (d[v] > max_label) max_label = d[v];
        if (excess[v] > 0) activate(v);
      }
    }
    work = 0;
  }

  // Every vertex with label in (k, max_label] can no longer reach the target.
  void gap(int k) {
    for (int b = k + 1; b <= max_label; b++) {
      for (int v = all_head[b]; v >= 0; v = all_next[v]) {
        d[v] = n;
        r.gap_nodes++;
      }
      all_head[b] = -1;
      act_head[b] = -1;
    }
    max_label = k - 1;
    if (highest > max_label) highest = max_label;
  }

  void relabel(int u) {
    r.relabels++;
    int old = d[u];
    all_remove(u);
    int best = 2 * n, besta = -1;
    for (int a = g.first[u]; a < g.first[u + 1]; a++) {
      r.arc_scans++;
      if (g.res[a] > 0 && d[g.head[a]] + 1 < best) best = d[g.head[a]] + 1, besta = a;
    }
    work += 12 + (g.first[u + 1] - g.first[u]);
    if (all_head[old] < 0) {  // u was the last vertex with its label
      d[u] = n;
      gap(old);
      return;
    }
    d[u] = best >= n ? n : best;
    if (d[u] < n) {
      cur[u] = besta;
      all_insert(u);
      if (d[u] > max_label) max_label = d[u];
    }
  }

  void discharge(int u) {
    while (excess[u] > 0) {
      int a = cur[u];
      const int end = g.first[u + 1];
      for (; a < end; a++) {
        r.arc_scans++;
        if (g.res[a] > 0 && d[g.head[a]] == d[u] - 1) break;
      }
      cur[u] = a;
      if (a == end) {
        relabel(u);
        if (d[u] >= n) return;
        continue;
      }
      int v = g.head[a];
      i64 delta = std::min(excess[u], g.res[a]);
      push_flow(g, a, delta);
      r.pushes++;
      excess[u] -= delta;
      if (excess[v] == 0 && v != sink) activate(v);
      excess[v] += delta;
    }
  }

  bool loop(Clock::time_point t0, double limit) {
    global_relabel();
    i64 iter = 0;
    while (highest >= 0) {
      int u = act_head[highest];
      if (u < 0) {
        highest--;
        continue;
      }
      act_head[highest] = act_next[u];
      if (d[u] >= n || excess[u] == 0) continue;
      discharge(u);
      if (d[u] < n && excess[u] > 0) activate(u);
      if (work > update_work) {
        global_relabel();
        if ((++iter & 15) == 0 && since(t0) > limit) return false;
      }
    }
    return true;
  }

  Result run(double limit) {
    auto t0 = Clock::now();
    for (int a = g.first[g.s]; a < g.first[g.s + 1]; a++) {
      i64 c = g.res[a];
      if (c > 0) {
        push_flow(g, a, c);
        excess[g.head[a]] += c;
        excess[g.s] -= c;
        r.pushes++;
      }
    }
    if (!loop(t0, limit)) {
      r.timeout = true;
      return r;
    }
    r.value = excess[g.t];
    r.phase1_s = since(t0);
    return_excess();
    for (int v = 0; v < n; v++)
      if (v != g.s && v != g.t && excess[v] != 0) std::abort();  // phase 2 leaves no excess
    return r;
  }

  // Phase 2: cancel flow cycles by depth-first search over arcs that carry
  // flow, then visit vertices in DFS post-order (a reverse topological order of
  // the now acyclic flow) and return each vertex's excess along arcs that
  // carry flow into it. Every such arc starts at s or at a vertex visited later.
  void return_excess() {
    auto flow_out = [&](int a) { return g.orig[a] > 0 ? g.res[g.mate[a]] : 0; };
    std::vector<char> color(n, 0);
    std::vector<int> parent(n, -1), stack, order;
    order.reserve(n);
    for (int v = 0; v < n; v++) cur[v] = g.first[v];
    for (int root = 0; root < n; root++) {
      if (root == g.s || root == g.t || color[root]) continue;
      color[root] = 1;
      stack.assign(1, root);
      while (!stack.empty()) {
        int u = stack.back();
        int a = cur[u];
        for (; a < g.first[u + 1]; a++) {
          int w = g.head[a];
          if (w != g.s && w != g.t && color[w] != 2 && flow_out(a) > 0) break;
        }
        cur[u] = a;
        if (a == g.first[u + 1]) {
          color[u] = 2;
          order.push_back(u);
          stack.pop_back();
          continue;
        }
        int w = g.head[a];
        if (color[w] == 0) {
          color[w] = 1;
          parent[w] = a;
          stack.push_back(w);
          continue;
        }
        // w is on the stack: cancel the cycle w -> ... -> u -> w
        i64 delta = flow_out(a);
        for (int x = u; x != w; x = g.tail[parent[x]]) delta = std::min(delta, flow_out(parent[x]));
        push_flow(g, g.mate[a], delta);
        for (int x = u; x != w; x = g.tail[parent[x]]) push_flow(g, g.mate[parent[x]], delta);
        while (stack.back() != w) {
          color[stack.back()] = 0;
          stack.pop_back();
        }
      }
    }
    for (int v : order) {
      for (int b = g.first[v]; b < g.first[v + 1] && excess[v] > 0; b++) {
        if (g.orig[b] != 0 || g.res[b] == 0) continue;  // b is the reverse of an arc u -> v carrying flow
        i64 delta = std::min(excess[v], g.res[b]);
        push_flow(g, b, delta);
        excess[v] -= delta;
        excess[g.head[b]] += delta;
      }
    }
  }
};

// ------------------------------------------------------------ verification

struct Check {
  bool ok = true;
  i64 net_out = 0, cut_cap = 0;
  int cut_size = 0;
  std::string why;
};

static Check verify(const Graph& g, i64 claimed) {
  Check c;
  std::vector<i64> net(g.n, 0);
  for (size_t a = 0; a < g.res.size(); a++) {
    if (g.orig[a] > 0) {
      // a forward arc's mate is its reverse arc, whose residual is the flow
      i64 f = g.orig[a] - g.res[a];
      if (g.res[a] < 0 || f < 0 || g.res[g.mate[a]] != f) c.ok = false, c.why = "capacity";
      net[g.tail[a]] += f;
      net[g.head[a]] -= f;
    }
  }
  for (int v = 0; v < g.n; v++)
    if (v != g.s && v != g.t && net[v] != 0) c.ok = false, c.why = "conservation";
  c.net_out = net[g.s];
  if (c.net_out != claimed || -net[g.t] != claimed) c.ok = false, c.why = "value";
  std::vector<char> seen(g.n, 0);
  std::vector<int> q{g.s};
  seen[g.s] = 1;
  for (size_t i = 0; i < q.size(); i++) {
    int u = q[i];
    for (int a = g.first[u]; a < g.first[u + 1]; a++)
      if (g.res[a] > 0 && !seen[g.head[a]]) seen[g.head[a]] = 1, q.push_back(g.head[a]);
  }
  if (seen[g.t]) c.ok = false, c.why = "augmenting path left";
  c.cut_size = (int)q.size();
  for (size_t a = 0; a < g.res.size(); a++)
    if (g.orig[a] > 0 && seen[g.tail[a]] && !seen[g.head[a]]) c.cut_cap += g.orig[a];
  if (c.cut_cap != claimed) c.ok = false, c.why = "cut capacity";
  return c;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s file.max [--algos ek,dinic,pr] [--reps 5] [--limit 60]\n", argv[0]);
    return 2;
  }
  std::string algos = "ek,dinic,pr";
  int reps = 5;
  double limit = 60;
  std::map<std::string, double> own_limit;  // --limit-ek 30 overrides --limit for one algorithm
  for (int i = 2; i + 1 < argc; i += 2) {
    if (!std::strcmp(argv[i], "--algos")) algos = argv[i + 1];
    else if (!std::strcmp(argv[i], "--reps")) reps = std::atoi(argv[i + 1]);
    else if (!std::strcmp(argv[i], "--limit")) limit = std::atof(argv[i + 1]);
    else if (!std::strncmp(argv[i], "--limit-", 8)) own_limit[argv[i] + 8] = std::atof(argv[i + 1]);
  }
  Graph g = read_dimacs(argv[1]);
  std::vector<std::string> list;
  for (size_t p = 0; p <= algos.size();) {
    size_t q = algos.find(',', p);
    if (q == std::string::npos) q = algos.size();
    list.push_back(algos.substr(p, q - p));
    p = q + 1;
  }
  std::vector<char> dead(list.size(), 0);
  for (int rep = 0; rep < reps; rep++) {
    for (size_t k = 0; k < list.size(); k++) {
      size_t j = (k + rep) % list.size();
      if (dead[j]) continue;
      const std::string& name = list[j];
      g.res = g.orig;
      auto t0 = Clock::now();
      Result r;
      const double lim = own_limit.count(name) ? own_limit[name] : limit;
      if (name == "ek") r = edmonds_karp(g, lim);
      else if (name == "dinic") r = dinic(g, lim);
      else {
        PushRelabel pr(g);
        r = pr.run(lim);
      }
      double secs = since(t0);
      Check c;
      if (!r.timeout) c = verify(g, r.value);
      else dead[j] = 1;
      std::printf(
          "{\"file\":\"%s\",\"n\":%d,\"m\":%lld,\"algo\":\"%s\",\"rep\":%d,\"seconds\":%.6f,\"timeout\":%s,"
          "\"value\":%lld,\"ok\":%s,\"why\":\"%s\",\"cut_cap\":%lld,\"source_side\":%d,"
          "\"augmentations\":%lld,\"phases\":%lld,\"arc_scans\":%lld,\"pushes\":%lld,\"relabels\":%lld,"
          "\"global_relabels\":%lld,\"gap_nodes\":%lld,\"phase1_seconds\":%.6f}\n",
          argv[1], g.n, g.edges, name.c_str(), rep, secs, r.timeout ? "true" : "false", r.value,
          (!r.timeout && c.ok) ? "true" : "false", c.why.c_str(), c.cut_cap, c.cut_size, r.augmentations, r.phases,
          r.arc_scans, r.pushes, r.relabels, r.global_relabels, r.gap_nodes, r.phase1_s);
      std::fflush(stdout);
    }
  }
  return 0;
}
