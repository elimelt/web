"""Measurements for the dynamic programming note. Writes experiments_results.json.

    python3 experiments.py

1. Calls made by the uncached weighted-interval-scheduling recursion.
2. Knapsack: top down vs bottom up vs one row vs NumPy, and the recursion limit.
3. Python alignment cost per cell: memory (tracemalloc) and time.
4. Yeast tRNA-Phe: maximum pairing (the note's ssi) vs ViennaRNA vs the cloverleaf.

Needs numpy and ViennaRNA (pip install ViennaRNA).
"""
import json
import platform
import random
import statistics
import sys
import time
import tracemalloc
from bisect import bisect_right

import note_code

ns = note_code.load()
out = {"python": sys.version.split()[0], "platform": platform.platform(), "processor": platform.processor()}


def timed(fn, runs=5):
    ts = []
    for _ in range(runs):
        t0 = time.perf_counter()
        r = fn()
        ts.append(time.perf_counter() - t0)
    return r, ts


# 1. Uncached scheduling recursion -------------------------------------------
def count_calls(jobs):
    jobs = sorted(jobs, key=lambda job: job[1])
    finish = [f for _, f, _ in jobs]
    p = [bisect_right(finish, s) for s, _, _ in jobs]
    calls = 0

    def opt(j):
        nonlocal calls
        calls += 1
        if j == 0:
            return 0
        return max(opt(j - 1), jobs[j - 1][2] + opt(p[j - 1]))

    value = opt(len(jobs))
    return calls, value


def chain(n):
    # job j overlaps only its neighbours: [2j, 2j + 3), so p(j) = j - 2
    return [(2 * j, 2 * j + 3, 1 + j % 3) for j in range(n)]


def random_jobs(n, seed):
    r = random.Random(seed)
    jobs = []
    for _ in range(n):
        s = r.randint(0, 1000)
        jobs.append((s, s + r.randint(1, 100), r.randint(1, 100)))
    return jobs


def disjoint(n):
    # no two jobs overlap, so p(j) = j - 1 and both branches recurse on j - 1
    return [(2 * j, 2 * j + 1, 1) for j in range(n)]


calls = {"chain": {}, "random": {}, "disjoint": {}}
for n in (10, 15, 20):
    c, _ = count_calls(disjoint(n))
    assert c == 2 ** (n + 1) - 1
    calls["disjoint"][n] = c
for n in (10, 20, 25, 30):
    c, v = count_calls(chain(n))
    assert v == ns["max_weight_schedule"](chain(n))
    calls["chain"][n] = c
    rc = []
    for seed in range(5):
        jobs = random_jobs(n, seed)
        c, v = count_calls(jobs)
        assert v == ns["max_weight_schedule"](jobs)
        rc.append(c)
    calls["random"][n] = rc
_, ts = timed(lambda: count_calls(chain(30)), runs=3)
calls["chain30_seconds"] = ts
out["calls"] = calls
print("calls", calls)

# 2. Knapsack timing -------------------------------------------------------
import numpy as np


def knapsack_numpy(W, w, v):
    best = np.zeros(W + 1, dtype=np.int64)
    for wi, vi in zip(w, v):
        if wi <= W:
            best[wi:] = np.maximum(best[wi:], vi + best[:-wi] if wi else best)
    return int(best[W])


def knap_instance(n, W, seed):
    r = random.Random(seed)
    w = [r.randint(max(1, W // 20), W // 4) for _ in range(n)]
    v = [r.randint(1, 1000) for _ in range(n)]
    return w, v


def touched(W, w, v):
    """How many table cells the top-down recursion fills."""
    seen = set()

    def dp(i, cap):
        if i == 0 or cap == 0 or (i, cap) in seen:
            return
        seen.add((i, cap))
        dp(i - 1, cap)
        if w[i - 1] <= cap:
            dp(i - 1, cap - w[i - 1])

    sys.setrecursionlimit(10000)
    dp(len(w), W)
    sys.setrecursionlimit(1000)
    return len(seen)


knap = {}
N_ITEMS = 100
for W in (1000, 10000):
    w, v = knap_instance(N_ITEMS, W, seed=W)
    row = {}
    ref = None
    for name, fn in [("top down", ns["knapsack_rec"]), ("bottom up", ns["knapsack_it"]),
                     ("one row", ns["knapsack_one_row"]), ("one row, NumPy", knapsack_numpy)]:
        r, ts = timed(lambda: fn(W, w, v), runs=5)
        ref = r if ref is None else ref
        assert r == ref, (name, r, ref)
        row[name] = ts
    row["cells"] = (N_ITEMS + 1) * (W + 1)
    row["top_down_touched"] = touched(W, w, v)
    knap[W] = row
    print("knapsack", W, {k: (round(statistics.median(x), 4) if isinstance(x, list) else x) for k, x in row.items()})
out["knapsack"] = knap

# recursion limit
w, v = knap_instance(2000, 1000, seed=1)
try:
    ns["knapsack_rec"](1000, w, v)
    out["recursion"] = {"n": 2000, "top_down": "ok"}
except RecursionError:
    out["recursion"] = {"n": 2000, "top_down": "RecursionError", "limit": sys.getrecursionlimit(),
                        "bottom_up": ns["knapsack_it"](1000, w, v)}
print("recursion", out["recursion"])

# 3. Python alignment memory and time ---------------------------------------
def dna(n, seed):
    r = random.Random(seed)
    return "".join(r.choice("ACGT") for _ in range(n)), "".join(r.choice("ACGT") for _ in range(n))


py_align = []
for n in (1000, 2000):
    for seed in range(3):
        x, y = dna(n, seed)
        t0 = time.perf_counter()
        M = ns["align_cost"](x, y)
        t_full = time.perf_counter() - t0
        cost = M[-1][-1]
        del M
        t0 = time.perf_counter()
        c2 = ns["align_cost_two_rows"](x, y)
        t_rows = time.perf_counter() - t0
        assert c2 == cost
        # memory in a separate run: tracemalloc slows every allocation
        tracemalloc.start()
        M = ns["align_cost"](x, y)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        del M
        cells = (n + 1) ** 2
        py_align.append({"n": n, "seed": seed, "cost": cost, "full_s": t_full, "rows_s": t_rows,
                         "peak_bytes": peak, "bytes_per_cell": peak / cells,
                         "ns_per_cell_full": t_full / cells * 1e9, "ns_per_cell_rows": t_rows / cells * 1e9})
        print("py align", py_align[-1])
out["py_align"] = py_align

# 4. tRNA ------------------------------------------------------------------
import RNA

TRNA = "GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA"
STEMS = [(1, 72, 7), (10, 25, 4), (27, 43, 5), (49, 65, 5)]  # (5' start, 3' end, length), 1-based
REF = {(a + k, b - k) for a, b, L in STEMS for k in range(L)}


def dotbracket(pairs, n):
    s = ["."] * n
    for i, j in pairs:
        s[i - 1], s[j - 1] = "(", ")"
    return "".join(s)


def pairs_of(db):
    stack, out_ = [], set()
    for k, c in enumerate(db, 1):
        if c == "(":
            stack.append(k)
        elif c == ")":
            out_.add((stack.pop(), k))
    return out_


def nussinov(B, allow_gu=False, ref=frozenset()):
    """Max pairs; among maximum structures, also the most pairs shared with ref,
    the number of maximum structures, and one structure attaining the overlap."""
    ok = {("A", "U"), ("U", "A"), ("C", "G"), ("G", "C")}
    if allow_gu:
        ok |= {("G", "U"), ("U", "G")}
    n = len(B)
    # value(i, j) = (pairs, ref hits) compared lexicographically; count(i, j) = # max-pair structures
    P = {}
    H = {}
    C = {}

    def get(i, j):
        if i >= j - 4:
            return 0, 0, 1
        return P[i, j], H[i, j], C[i, j]

    for l in range(1, n + 1):
        for i in range(1, n - l + 2):
            j = i + l - 1
            if i >= j - 4:
                continue
            p, h, c = get(i, j - 1)
            best_p, best_h, cnt = p, h, c
            for t in range(i, j - 4):
                if (B[t - 1], B[j - 1]) in ok:
                    lp, lh, lc = get(i, t - 1) if t > i else (0, 0, 1)
                    ip, ih, ic = get(t + 1, j - 1)
                    q = 1 + lp + ip
                    hq = lh + ih + ((t, j) in ref)
                    if q > best_p:
                        best_p, best_h, cnt = q, hq, lc * ic
                    elif q == best_p:
                        best_h = max(best_h, hq)
                        cnt += lc * ic
            P[i, j], H[i, j], C[i, j] = best_p, best_h, cnt
    # traceback for the max-overlap structure
    pairs = set()

    def tb(i, j):
        if i >= j - 4:
            return
        p, h, _ = get(i, j)
        q0, h0, _ = get(i, j - 1)
        if (q0, h0) == (p, h):
            return tb(i, j - 1)
        for t in range(i, j - 4):
            if (B[t - 1], B[j - 1]) in ok:
                lp, lh, _ = get(i, t - 1) if t > i else (0, 0, 1)
                ip, ih, _ = get(t + 1, j - 1)
                if 1 + lp + ip == p and lh + ih + ((t, j) in ref) == h:
                    pairs.add((t, j))
                    if t > i:
                        tb(i, t - 1)
                    tb(t + 1, j - 1)
                    return
        raise AssertionError("traceback failed")

    tb(1, n)
    return P[1, n], H[1, n], C[1, n], pairs


def f1(pred, ref):
    tp = len(pred & ref)
    return 2 * tp / (len(pred) + len(ref)) if pred else 0.0


n = len(TRNA)
fc = RNA.fold_compound(TRNA)
mfe_db, mfe = fc.mfe()
mfe_pairs = pairs_of(mfe_db)
kinds = [TRNA[i - 1] + TRNA[j - 1] for i, j in sorted(REF)]
rna = {"vienna_version": RNA.__version__, "n": n, "ref_pairs": len(REF),
       "ref_wc": sum(k in ("AU", "UA", "CG", "GC") for k in kinds), "ref_gu": sum(k in ("GU", "UG") for k in kinds),
       "ref_other": [k for k in kinds if k not in ("AU", "UA", "CG", "GC", "GU", "UG")], "ref_db": dotbracket(REF, n),
       "ref_energy": fc.eval_structure(dotbracket(REF, n)), "mfe_db": mfe_db, "mfe": mfe,
       "mfe_pairs": len(mfe_pairs), "mfe_ref_shared": len(mfe_pairs & REF), "mfe_f1": f1(mfe_pairs, REF)}
assert ns["ssi"](TRNA) == nussinov(TRNA)[0]
for label, gu in (("wc", False), ("wc_gu", True)):
    p, h, c, pairs = nussinov(TRNA, gu, frozenset(REF))
    p0, h0, _, pairs0 = nussinov(TRNA, gu)  # an arbitrary (first-found) optimum
    db = dotbracket(pairs, n)
    rna[label] = {"max_pairs": p, "num_optimal": c, "best_shared": h, "best_db": db, "best_f1": f1(pairs, REF),
                  "best_energy": fc.eval_structure(db), "any_db": dotbracket(pairs0, n),
                  "any_shared": len(pairs0 & REF), "any_energy": fc.eval_structure(dotbracket(pairs0, n))}
out["rna"] = rna
print(json.dumps(rna, indent=1))

with open("experiments_results.json", "w") as f:
    json.dump(out, f, indent=1)
