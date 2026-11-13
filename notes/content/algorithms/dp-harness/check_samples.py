"""Checks every Python block in dynamic-programming.mdx against brute force.

    python3 check_samples.py            # prints one line per check, exits 1 on failure
    python3 check_samples.py --json     # also writes check_results.json and
                                        # align_fixtures.json, which the
                                        # alignment figure's test reads

Each check draws small random inputs from a seeded generator, so a run is
reproducible. The brute-force solvers below are deliberately different
algorithms from the note's (enumeration, search), not the same recurrence.
"""
import itertools
import json
import random
import sys
from collections import deque

import note_code

ns = note_code.load()
rng = random.Random(20261113)
results = {}


def check(name, trials, fn):
    for t in range(trials):
        fn(t)
    results[name] = trials
    print(f"ok  {name:28s} {trials} random inputs")


# --- weighted interval scheduling -------------------------------------------
def random_jobs():
    jobs = []
    for _ in range(rng.randint(0, 9)):
        s = rng.randint(0, 20)
        jobs.append((s, s + rng.randint(1, 8), rng.randint(0, 10)))
    return jobs


def compatible(js):
    js = sorted(js, key=lambda j: j[1])
    return all(a[1] <= b[0] for a, b in zip(js, js[1:]))


def brute_schedule(jobs):
    best = 0
    for r in range(len(jobs) + 1):
        for sub in itertools.combinations(jobs, r):
            if compatible(sub):
                best = max(best, sum(j[2] for j in sub))
    return best


def t_schedule(_):
    jobs = random_jobs()
    best = brute_schedule(jobs)
    assert ns["max_weight_schedule"](jobs) == best, jobs
    picked = ns["chosen_jobs"](jobs)
    assert compatible(picked) and sum(j[2] for j in picked) == best, (jobs, picked)


check("weighted interval scheduling", 3000, t_schedule)


# --- knapsack ---------------------------------------------------------------
def brute_knapsack(W, w, v):
    best = 0
    for mask in range(1 << len(w)):
        tw = sum(w[i] for i in range(len(w)) if mask >> i & 1)
        if tw <= W:
            best = max(best, sum(v[i] for i in range(len(w)) if mask >> i & 1))
    return best


def t_knapsack(_):
    n = rng.randint(0, 9)
    w = [rng.randint(1, 12) for _ in range(n)]
    v = [rng.randint(0, 20) for _ in range(n)]
    W = rng.randint(0, 30)
    b = brute_knapsack(W, w, v)
    for f in ("knapsack_rec", "knapsack_it", "knapsack_one_row"):
        assert ns[f](W, w, v) == b, (f, W, w, v)


check("knapsack (3 versions)", 3000, t_knapsack)


# --- string building --------------------------------------------------------
def brute_strings(n, ka, kb):
    count = 0
    for s in itertools.product("AB", repeat=n):
        ok, run = True, 1
        for i in range(1, n + 1):
            if i == n or s[i] != s[i - 1]:
                if run > (ka if s[i - 1] == "A" else kb):
                    ok = False
                    break
                run = 1
            else:
                run += 1
        count += ok
    return count


def t_strings(_):
    n, ka, kb = rng.randint(1, 13), rng.randint(1, 5), rng.randint(1, 5)
    assert ns["num_strings"](n, ka, kb) == brute_strings(n, ka, kb), (n, ka, kb)


check("string building", 600, t_strings)


# --- post office ------------------------------------------------------------
def brute_post(X, K):
    return min(sum(min(abs(x - o) for o in offices) for x in X) for offices in itertools.combinations(X, K))


def t_post(_):
    n = rng.randint(1, 9)
    X = rng.sample(range(0, 60), n)
    K = rng.randint(1, n)
    assert ns["min_dist_td"](X, K) == brute_post(X, K), (X, K)


check("post office", 1500, t_post)


# --- RNA --------------------------------------------------------------------
PAIRS = {("A", "U"), ("U", "A"), ("C", "G"), ("G", "C")}


def brute_rna(B):
    n = len(B)
    cand = [(i, j) for i in range(n) for j in range(i + 5, n) if (B[i], B[j]) in PAIRS]
    best = 0

    def go(k, chosen, used):
        nonlocal best
        best = max(best, len(chosen))
        if len(chosen) + len(cand) - k <= best:
            return
        for idx in range(k, len(cand)):
            i, j = cand[idx]
            if i in used or j in used:
                continue
            if any(a < i < b < j or i < a < j < b for a, b in chosen):
                continue
            chosen.append((i, j)); used |= {i, j}
            go(idx + 1, chosen, used)
            chosen.pop(); used -= {i, j}

    go(0, [], set())
    return best


def t_rna(_):
    B = "".join(rng.choice("ACGU") for _ in range(rng.randint(0, 16)))
    assert ns["ssi"](B) == brute_rna(B), B


check("RNA secondary structure", 1500, t_rna)


# --- alignment --------------------------------------------------------------
def brute_edit(x, y):
    """Breadth-first search over strings: fewest single-character edits."""
    if x == y:
        return 0
    alphabet = sorted(set(x + y))
    seen, frontier, d = {x}, [x], 0
    while frontier:
        d += 1
        nxt = []
        for s in frontier:
            outs = [s[:i] + s[i + 1:] for i in range(len(s))]
            outs += [s[:i] + c + s[i:] for i in range(len(s) + 1) for c in alphabet]
            outs += [s[:i] + c + s[i + 1:] for i in range(len(s)) for c in alphabet if c != s[i]]
            for o in outs:
                if o == y:
                    return d
                if o not in seen and len(o) <= max(len(x), len(y)) + 1:
                    seen.add(o)
                    nxt.append(o)
        frontier = nxt


def brute_align(x, y, gap, mismatch):
    """Enumerates every alignment (as a set of non-crossing pairs) and scores it."""
    best = float("inf")

    def go(i, j, cost):
        nonlocal best
        if cost >= best:
            return
        if i == len(x) or j == len(y):
            best = min(best, cost + gap * ((len(x) - i) + (len(y) - j)))
            return
        go(i + 1, j + 1, cost + (0 if x[i] == y[j] else mismatch))
        go(i + 1, j, cost + gap)
        go(i, j + 1, cost + gap)

    go(0, 0, 0)
    return best


def score(top, bottom, gap, mismatch):
    return sum(gap if "-" in (a, b) else (0 if a == b else mismatch) for a, b in zip(top, bottom))


def t_align(t):
    x = "".join(rng.choice("abc") for _ in range(rng.randint(0, 5)))
    y = "".join(rng.choice("abc") for _ in range(rng.randint(0, 5)))
    if t % 2 == 0:
        d = brute_edit(x, y)
        assert ns["align_cost"](x, y)[-1][-1] == d == ns["align_cost_two_rows"](x, y), (x, y)
    gap, mismatch = rng.choice([0.5, 1, 1.5, 2, 3]), rng.choice([0, 0.5, 1, 2, 3, 4])
    b = brute_align(x, y, gap, mismatch)
    assert ns["align_cost"](x, y, gap, mismatch)[-1][-1] == b == ns["align_cost_two_rows"](x, y, gap, mismatch)
    top, bottom = ns["alignment"](x, y, gap, mismatch)
    assert top.replace("-", "") == x and bottom.replace("-", "") == y and len(top) == len(bottom)
    assert score(top, bottom, gap, mismatch) == b, (x, y, gap, mismatch, top, bottom)


check("sequence alignment", 1500, t_align)


# --- longest path in a DAG -------------------------------------------------
def random_dag():
    n = rng.randint(0, 8)
    order = list(range(n)); rng.shuffle(order)
    edges = [(order[a], order[b]) for a in range(n) for b in range(a + 1, n) if rng.random() < 0.35]
    return n, edges


def brute_longest(n, edges):
    adj = {v: [b for a, b in edges if a == v] for v in range(n)}

    def dfs(v):
        return max((1 + dfs(u) for u in adj[v]), default=0)

    return max((dfs(v) for v in range(n)), default=0)


def t_dag(_):
    n, edges = random_dag()
    assert ns["longest_path"](n, edges) == brute_longest(n, edges), (n, edges)


check("longest path in a DAG", 2000, t_dag)


# --- LIS --------------------------------------------------------------------
def brute_lis(X):
    for r in range(len(X), 0, -1):
        for sub in itertools.combinations(X, r):
            if all(a < b for a, b in zip(sub, sub[1:])):
                return r
    return 0


def t_lis(_):
    X = [rng.randint(0, 8) for _ in range(rng.randint(0, 11))]
    b = brute_lis(X)
    assert ns["LIS"](X) == b == ns["lis_length"](X), X


check("longest increasing subsequence", 2000, t_lis)


# --- Bellman-Ford -----------------------------------------------------------
def brute_paths(n, edges, s):
    """Cheapest simple path to each vertex, and whether a reachable negative cycle exists."""
    out = {v: [] for v in range(n)}
    for u, v, c in edges:
        out[u].append((v, c))
    dist = [float("inf")] * n
    neg = False

    def go(v, cost, path):
        nonlocal neg
        dist[v] = min(dist[v], cost)
        for w, c in out[v]:
            if w in path:
                # closing a cycle: its cost is the path segment from w back to v, plus c
                k = path.index(w)
                cyc = c + sum(cc for cc in costs[k:])
                if cyc < 0:
                    neg = True
            else:
                path.append(w); costs.append(c)
                go(w, cost + c, path)
                path.pop(); costs.pop()

    costs = []
    go(s, 0, [s])
    return dist, neg


def t_bf(_):
    n = rng.randint(1, 6)
    edges = [(u, v, rng.randint(-3, 8)) for u in range(n) for v in range(n) if u != v and rng.random() < 0.4]
    s = rng.randrange(n)
    dist, neg = brute_paths(n, edges, s)
    got = ns["bellman_ford"](n, edges, s)
    if neg:
        assert got is None, (n, edges, s)
    else:
        assert got == dist, (n, edges, s, got, dist)


check("Bellman-Ford", 3000, t_bf)


# --- P1 ---------------------------------------------------------------------
worst = 1.0


def t_p1(_):
    global worst
    W = rng.randint(2, 40)
    n = rng.randint(1, 9)
    w = [rng.randint(1, W // 2) for _ in range(n)]
    v = [rng.randint(1, 30) for _ in range(n)]
    opt = brute_knapsack(W, w, v)
    got = ns["A"](w, v, W)
    assert 2 * got >= opt and got <= opt, (W, w, v, got, opt)
    worst = min(worst, got / opt)


check("P1 knapsack 2-approximation", 4000, t_p1)
results["p1_worst_ratio"] = worst
print(f"    worst ratio found: {worst:.3f}")


# --- P2 ---------------------------------------------------------------------
def brute_rect(A):
    n = len(A)
    best = 0
    for x1 in range(n):
        for x2 in range(x1, n):
            for y1 in range(n):
                for y2 in range(y1, n):
                    best = max(best, sum(A[i][j] for i in range(x1, x2 + 1) for j in range(y1, y2 + 1)))
    return best


def t_p2(_):
    n = rng.randint(1, 6)
    A = [[rng.randint(-9, 6) for _ in range(n)] for _ in range(n)]
    assert ns["max_rectangle"](A) == brute_rect(A), A


check("P2 maximum sub-rectangle", 1500, t_p2)


# --- P3 ---------------------------------------------------------------------
def random_tree(n):
    T = {0: []}
    for v in range(1, n):
        u = rng.choice([u for u in T if len(T[u]) < 3])
        T[v] = [u]
        T[u].append(v)
    return T


def brute_connected(T, k):
    count = 0
    for S in itertools.combinations(T, k):
        S = set(S)
        start = next(iter(S))
        seen, q = {start}, deque([start])
        while q:
            v = q.popleft()
            for u in T[v]:
                if u in S and u not in seen:
                    seen.add(u); q.append(u)
        count += seen == S
    return count


def t_p3(_):
    n = rng.randint(1, 11)
    T = random_tree(n)
    # start the BFS from a random vertex, which may have 3 children
    keys = list(T); rng.shuffle(keys)
    T = {v: T[v] for v in keys}
    k = rng.randint(1, n)
    assert ns["num_sets_deg_3"](T, k) == brute_connected(T, k), (T, k)


check("P3 connected subsets", 1500, t_p3)

total = sum(v for k, v in results.items() if isinstance(v, int))
print(f"all {sum(isinstance(v, int) for v in results.values())} checks passed on {total} random inputs")
if "--json" in sys.argv:
    with open("check_results.json", "w") as f:
        json.dump({"checks": {k: v for k, v in results.items() if isinstance(v, int)},
                   "total_inputs": total, "p1_worst_ratio": worst, "python": sys.version.split()[0]}, f, indent=2)
    # Fixtures for the alignment figure: the note's alignment() on random
    # words and costs in steps of 0.5, which the figure stores exactly as
    # half units. The figure must find the same cost and, since both prefer
    # the diagonal and then the gap in x on ties, the same alignment.
    frng = random.Random(7)
    fixtures = [{"x": "ocurrance", "y": "occurrence", "gap": 1, "mismatch": 1}]
    for _ in range(200):
        fixtures.append({
            "x": "".join(frng.choice("acgt") for _ in range(frng.randint(0, 12))),
            "y": "".join(frng.choice("acgt") for _ in range(frng.randint(0, 12))),
            "gap": frng.choice([0.5, 1, 1.5, 2, 3, 4]),
            "mismatch": frng.choice([0, 0.5, 1, 1.5, 2, 3, 4]),
        })
    for fx in fixtures:
        fx["cost"] = ns["align_cost"](fx["x"], fx["y"], fx["gap"], fx["mismatch"])[-1][-1]
        fx["top"], fx["bottom"] = ns["alignment"](fx["x"], fx["y"], fx["gap"], fx["mismatch"])
    with open("align_fixtures.json", "w") as f:
        json.dump(fixtures, f)
