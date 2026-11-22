"""MinHash error on pairs that share no document.

Usage: python3 -I indep7.py DIR
The joined pairs are heavily overlapping (one cluster of near-identical pages
contributes most pairs at J >= 0.7), so the per-bin errors in analysis.json
weight a few clusters heavily. This takes, in random order, each joined pair
whose documents are both unused (a random maximal matching), adds 20,000
random pairs with J < 0.3, and reports MinHash RMSE and bias by J bin against
sqrt(J(1-J)/k). Writes DIR/indep.json.
"""
import json
import sys

import numpy as np

D = sys.argv[1]
K = 256
off = np.fromfile(f"{D}/offsets.i64", dtype=np.int64)
n = len(off) - 1
sizes = np.diff(off)
sig = np.fromfile(f"{D}/sig.u64", dtype=np.uint64).reshape(n, K)
P = np.loadtxt(f"{D}/pairs.tsv", dtype=np.float64, ndmin=2)
pi, pj, pJ = P[:, 0].astype(np.int64), P[:, 1].astype(np.int64), P[:, 4]
rng = np.random.default_rng(7)
used = np.zeros(n, bool)
keep = []
for t in rng.permutation(len(pi)):
    a, b = pi[t], pj[t]
    if not used[a] and not used[b]:
        used[a] = used[b] = True
        keep.append(t)
keep = np.array(keep)
tok = np.fromfile(f"{D}/sets.u64", dtype=np.uint64)
ra = rng.integers(0, n, 20000)
rb = rng.integers(0, n, 20000)
ok = ra != rb
ra, rb = ra[ok], rb[ok]
rJ = np.array([len(np.intersect1d(tok[off[a]:off[a + 1]], tok[off[b]:off[b + 1]], assume_unique=True)) for a, b in zip(ra, rb)], dtype=np.float64)
rJ = rJ / (sizes[ra] + sizes[rb] - rJ)
low = rJ < 0.3
A = np.concatenate([pi[keep], ra[low]])
B = np.concatenate([pj[keep], rb[low]])
J = np.concatenate([pJ[keep], rJ[low]])
eq = sig[A] == sig[B]
bins = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0001]
out = {"matched_pairs": int(len(keep)), "random_pairs": int(low.sum()), "rows": {}}
for k in (16, 32, 64, 128, 256):
    e = eq[:, :k].mean(1)
    rows = []
    for lo, hi in zip(bins, bins[1:]):
        m = (J >= lo) & (J < hi)
        if m.sum() < 20:
            continue
        rows.append({"lo": lo, "hi": hi, "pairs": int(m.sum()), "rmse": float(np.sqrt(((e[m] - J[m]) ** 2).mean())),
                     "bias": float((e[m] - J[m]).mean()), "theory": float(np.sqrt((J[m] * (1 - J[m]) / k).mean()))})
    out["rows"][k] = rows
json.dump(out, open(f"{D}/indep.json", "w"), indent=1)
print(out["matched_pairs"], out["random_pairs"])
for k, rows in out["rows"].items():
    print(k, [(r["lo"], r["pairs"], round(r["rmse"], 4), round(r["theory"], 4), round(r["bias"], 4)) for r in rows])
