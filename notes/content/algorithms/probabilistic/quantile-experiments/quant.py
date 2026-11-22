"""Quantile sketches on the response-start timings.

Reads all.i32 (the values in partition order) and, for each sketch and size,
records the estimate at a grid of quantiles, its rank error and relative
error against the exact answer, and the sketch's size. Runs each randomized
sketch TRIALS times, in partition order and in a shuffled order, and the
merge experiment (one sketch per site, merged) for the mergeable sketches.

Usage: python3 -I quant.py DIR TRIALS   (DIR holds all.i32, sites.i32, gk, tdigest)
Writes DIR/quant.json.
"""
import json
import os
import subprocess
import sys

import numpy as np
import datasketches as ds
from ddsketch import DDSketch

D = sys.argv[1]
TRIALS = int(sys.argv[2])
QS = [0.5, 0.75, 0.9, 0.95, 0.99, 0.995, 0.999]
x = np.fromfile(os.path.join(D, "all.i32"), dtype=np.int32)
site = np.fromfile(os.path.join(D, "sites.i32"), dtype=np.int32)
n = len(x)
srt = np.sort(x)
vals, cnts = np.unique(x, return_counts=True)
rng = np.random.default_rng(20261122)
perm = rng.permutation(n)
xs = x[perm]
xs.tofile(os.path.join(D, "shuf.i32"))
xf = x.astype(np.float32)
xsf = xs.astype(np.float32)


def truth(q):
    return int(srt[int(np.ceil(q * n)) - 1])


def errors(q, est):
    lo = np.searchsorted(srt, est, "left") / n
    hi = np.searchsorted(srt, est, "right") / n
    t = truth(q)
    return {"q": q, "est": float(est), "true": t, "rank_err": float(max(0.0, lo - q, q - hi)),
            "rel_err": float(abs(est - t) / t)}


out = {"n": n, "qs": QS, "truth": {str(q): truth(q) for q in QS},
       "at_cap": int((x == x.max()).sum()), "max": int(x.max()), "distinct": int(len(vals)), "runs": []}


def record(name, param, order, trial, est_fn, size):
    out["runs"].append({"sketch": name, "param": param, "order": order, "trial": trial, "bytes": size,
                        "res": [errors(q, est_fn(q)) for q in QS]})


def kll(k): return ds.kll_floats_sketch(k)
def req(k): return ds.req_floats_sketch(k, True)
def cls(k): return ds.quantiles_floats_sketch(k)
def tdg(k): return ds.tdigest_float(k)


LIB = {"kll": (kll, [50, 100, 200, 400, 800], True),
       "req": (req, [6, 12, 24, 48], True),
       "classic": (cls, [32, 64, 128, 256], True)}
FINE = [i / 400 for i in range(1, 400)]
out["monotone"] = {}

for name, (mk, params, randomized) in LIB.items():
    for p in params:
        for order, data in (("file", xf), ("shuffled", xsf)):
            for t in range(TRIALS if randomized else 1):
                s = mk(p)
                s.update(data)
                record(name, p, order, t, lambda q: s.get_quantile(q), len(s.serialize()))
                if t == 0:
                    f = [s.get_quantile(q) for q in FINE]
                    out["monotone"][f"{name} {p} {order}"] = bool(all(a <= b for a, b in zip(f, f[1:])))
        print(name, p, flush=True)

# The datasketches t-digest, kept only to document its get_quantile: on this
# data its answers are not monotone in q and disagree with its own get_rank.
for order, data in (("file", xf), ("shuffled", xsf)):
    s = tdg(100)
    s.update(data)
    s.compress()
    f = [s.get_quantile(q) for q in FINE]
    out["monotone"][f"datasketches-tdigest 100 {order}"] = bool(all(a <= b for a, b in zip(f, f[1:])))
    record("tdigest-ds", 100, order, 0, lambda q: s.get_quantile(q), len(s.serialize()))
    out.setdefault("ds_roundtrip", {})[order] = [float(s.get_rank(s.get_quantile(q))) for q in QS]


def run_td(delta, values, groups=None):
    cmd = [os.path.join(D, "tdigest"), str(delta), os.path.join(D, values)]
    if groups:
        cmd.append(os.path.join(D, groups))
    r = subprocess.run(cmd + ["--"] + [str(q) for q in QS], capture_output=True, text=True,
                       check=True).stdout.strip().split("\n")
    est = {float(l.split()[0]): float(l.split()[1]) for l in r[:-1]}
    return est, int(r[-1].split()[1])


# t-digest (k1 scale, merging), deterministic given the order; 16 bytes per centroid.
for delta in [25, 50, 100, 200, 400]:
    for order, f in (("file", "all.i32"), ("shuffled", "shuf.i32")):
        est, cen = run_td(delta, f)
        record("tdigest", delta, order, 0, lambda q: est[round(q, 6)], 16 * cen)
    print("tdigest", delta, cen, flush=True)

# DDSketch is order-independent: add each distinct value with its count.
for a in [0.05, 0.02, 0.01, 0.005, 0.002]:
    s = DDSketch(a)
    for v, c in zip(vals.tolist(), cnts.tolist()):
        s.add(float(v), float(c))
    bins = s._store.max_key - s._store.min_key + 1
    record("ddsketch", a, "any", 0, lambda q: s.get_quantile_value(q), 8 * bins)
    print("ddsketch", a, bins, flush=True)

# GK, deterministic given the order.
for eps in [0.01, 0.003, 0.001, 0.0003]:
    for order, f in (("file", "all.i32"), ("shuffled", "shuf.i32")):
        r = subprocess.run([os.path.join(D, "gk"), str(eps), os.path.join(D, f)] + [str(q) for q in QS],
                           capture_output=True, text=True, check=True).stdout.strip().split("\n")
        est = {float(l.split()[0]): float(l.split()[1]) for l in r[:-1]}
        tuples = int(r[-1].split()[1])
        record("gk", eps, order, 0, lambda q: est[round(q, 6)], 12 * tuples)
        print("gk", eps, order, tuples, flush=True)

# Merging: one sketch per site in partition order, merged in site-id order,
# against one sketch over the whole stream.
order_idx = np.argsort(site, kind="stable")
bounds = np.flatnonzero(np.diff(site[order_idx])) + 1
groups = np.split(order_idx, bounds)
out["sites"] = len(groups)
for name, mk, p in (("kll", kll, 200), ("req", req, 12)):
    for t in range(TRIALS):
        m = mk(p)
        for g in groups:
            s = mk(p)
            s.update(xf[np.sort(g)])
            m.merge(s)
        record(name, p, "merged", t, lambda q: m.get_quantile(q), len(m.serialize()))
    print("merged", name, flush=True)
bysite = np.concatenate([np.sort(g) for g in groups])
x[bysite].tofile(os.path.join(D, "bysite.i32"))
np.cumsum([len(g) for g in groups]).astype(np.int64).tofile(os.path.join(D, "groups.i64"))
est, cen = run_td(100, "bysite.i32", "groups.i64")
record("tdigest", 100, "merged", 0, lambda q: est[round(q, 6)], 16 * cen)
for a in [0.01]:
    m = DDSketch(a)
    for g in groups:
        s = DDSketch(a)
        v, c = np.unique(x[g], return_counts=True)
        for vv, cc in zip(v.tolist(), c.tolist()):
            s.add(float(vv), float(cc))
        m.merge(s)
    record("ddsketch", a, "merged", 0, lambda q: m.get_quantile_value(q), 8 * (m._store.max_key - m._store.min_key + 1))

json.dump(out, open(os.path.join(D, "quant.json"), "w"), indent=0)
print("done", flush=True)
