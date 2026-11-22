"""MinHash and LSH measurements against the exact join.

Usage: python3 -I analyze7.py DIR   (DIR holds sets.u64, offsets.i64, sig.u64,
pairs.tsv from join at T=0.3, docs.tsv). Writes DIR/analysis.json.
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
out = {"docs": int(n), "shingles": int(off[-1]), "median_set": float(np.median(sizes)),
       "pairs_ge": {str(t): int((pJ >= t - 1e-12).sum()) for t in (0.3, 0.5, 0.7, 0.8, 0.9, 1.0)}}
# Documents with at least one partner at J >= 0.8, and connected components at 0.8.
par = np.arange(n)


def find(a):
    while par[a] != a:
        par[a] = par[par[a]]
        a = par[a]
    return a


for a, b, j in zip(pi, pj, pJ):
    if j >= 0.8 - 1e-12:
        ra, rb = find(a), find(b)
        if ra != rb:
            par[ra] = rb
roots = np.array([find(a) for a in range(n)])
_, cs = np.unique(roots, return_counts=True)
out["clusters08"] = {"docs_in_clusters": int(cs[cs > 1].sum()), "clusters": int((cs > 1).sum()),
                     "largest": int(cs.max()), "sizes_top": sorted(cs.tolist(), reverse=True)[:10]}

# Random pairs (almost all with J < 0.3); their exact J is computed directly.
rng = np.random.default_rng(20261122)
R = 20000
ra = rng.integers(0, n, R); rb = rng.integers(0, n, R)
keep = ra != rb
ra, rb = ra[keep], rb[keep]
tok = np.fromfile(f"{D}/sets.u64", dtype=np.uint64)
rJ = np.array([len(np.intersect1d(tok[off[a]:off[a + 1]], tok[off[b]:off[b + 1]], assume_unique=True)) for a, b in zip(ra, rb)], dtype=np.float64)
rJ = rJ / (sizes[ra] + sizes[rb] - rJ)
# Pairs at J >= 0.3 are already in the join's list; keep the random pairs below it.
lowJ = rJ < 0.3
out["random_pairs"] = {"count": int(len(ra)), "mean_J": float(rJ.mean()), "frac_ge_0.3": float((rJ >= 0.3).mean()),
                       "frac_zero": float((rJ == 0).mean())}

# Estimation error by J bin.
A = np.concatenate([pi, ra[lowJ]]); B = np.concatenate([pj, rb[lowJ]]); J = np.concatenate([pJ, rJ[lowJ]])
eq = sig[A] == sig[B]  # (pairs, K)
bins = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0001]
est = {}
for k in (16, 32, 64, 128, 256):
    e = eq[:, :k].mean(1)
    rows = []
    for lo, hi in zip(bins, bins[1:]):
        m = (J >= lo) & (J < hi)
        if m.sum() < 20:
            continue
        rows.append({"lo": lo, "hi": hi, "pairs": int(m.sum()), "rmse": float(np.sqrt(((e[m] - J[m]) ** 2).mean())),
                     "bias": float((e[m] - J[m]).mean()),
                     "theory": float(np.sqrt((J[m] * (1 - J[m]) / k).mean()))})
    est[k] = rows
out["minhash"] = est

# b-bit MinHash: compare the lowest b bits; estimate (P - 2^-b)/(1 - 2^-b).
bb = {}
for b in (1, 2, 4, 8, 16, 64):
    mask = np.uint64((1 << b) - 1) if b < 64 else np.uint64(0xFFFFFFFFFFFFFFFF)
    eqb = (sig[A] & mask) == (sig[B] & mask)
    for k in (32, 64, 128, 256):
        Pm = eqb[:, :k].mean(1)
        c = 2.0 ** -b
        e = (Pm - c) / (1 - c)
        m = J >= 0.3
        bb[f"{b} {k}"] = {"bits": b * k, "rmse_ge03": float(np.sqrt(((e[m] - J[m]) ** 2).mean())),
                         "rmse_random": float(np.sqrt(((e[~m] - J[~m]) ** 2).mean()))}
out["bbit"] = bb

# LSH banding with b bands of r rows (b * r <= K).
CONF = [(128, 2), (64, 4), (32, 8), (16, 16), (8, 32), (50, 5), (20, 10), (25, 10)]
lsh = {}
M1 = np.uint64(0x9E3779B97F4A7C15)
for b, r in CONF:
    # Band keys: a hash of the r values of each band.
    keys = np.zeros((n, b), dtype=np.uint64)
    for t in range(r):
        keys = (keys * M1) ^ sig[:, np.arange(b) * r + t]
    coll_pairs = (keys[A] == keys[B]).any(1)
    # Candidate pairs over all document pairs. Band collisions with
    # duplicates are counted exactly from bucket sizes. The distinct pairs are
    # listed exactly when there are at most 4e7 band collisions; otherwise the
    # count is estimated from the random pairs (J < 0.3) plus the exact
    # collisions among the joined pairs (J >= 0.3).
    total = 0
    grp = []
    for band in range(b):
        o = np.argsort(keys[:, band], kind="stable")
        k_sorted = keys[o, band]
        starts = np.flatnonzero(np.r_[True, k_sorted[1:] != k_sorted[:-1]])
        lens = np.diff(np.r_[starts, n])
        total += int((lens * (lens - 1) // 2).sum())
        grp.append((o, starts[lens > 1], lens[lens > 1]))
    exact = total <= 40_000_000
    if exact:
        cand = []
        for o, st, ln in grp:
            for s0, L in zip(st, ln):
                g = np.sort(o[s0:s0 + L])
                ii, jj = np.triu_indices(L, 1)
                cand.append(g[ii] * n + g[jj])
        cset = np.unique(np.concatenate(cand)) if cand else np.array([], dtype=np.int64)
        distinct = int(len(cset))
        kp = pi * n + pj
        order = np.argsort(kp)
        kp, kj = kp[order], pJ[order]
        pos = np.searchsorted(kp, cset)
        pos[pos >= len(kp)] = 0
        hit = kp[pos] == cset
        cj = np.where(hit, kj[pos], 0.0)
        cand_ge08 = int((cj >= 0.8 - 1e-12).sum())
        cand_lt03 = int((cj < 0.3).sum())
    else:
        nr = int(lowJ.sum())
        rate_low = float(coll_pairs[len(pi):].mean())
        hi_coll = int(coll_pairs[:len(pi)].sum())
        cand_lt03 = int(round(rate_low * (n * (n - 1) // 2 - len(pi))))
        distinct = cand_lt03 + hi_coll
        cand_ge08 = int(coll_pairs[:len(pi)][pJ >= 0.8 - 1e-12].sum())
    del grp
    s_star = (1 / b) ** (1 / r)
    rows = []
    for lo, hi in zip(bins, bins[1:]):
        m = (J >= lo) & (J < hi)
        if m.sum() < 20:
            continue
        rows.append({"lo": lo, "hi": hi, "pairs": int(m.sum()), "measured": float(coll_pairs[m].mean()),
                     "theory": float((1 - (1 - J[m] ** r) ** b).mean())})
    lsh[f"{b}x{r}"] = {"b": b, "r": r, "threshold": s_star, "band_collisions": total, "candidates": distinct, "exact": exact,
                       "cand_ge08": cand_ge08, "cand_lt03": cand_lt03,
                       "recall08": float(coll_pairs[J >= 0.8 - 1e-12].mean()),
                       "recall05": float(coll_pairs[J >= 0.5 - 1e-12].mean()), "bins": rows}
    print(b, r, distinct, flush=True)
out["lsh"] = lsh
out["all_pairs"] = n * (n - 1) // 2
json.dump(out, open(f"{D}/analysis.json", "w"), indent=1)
print(json.dumps({k: out[k] for k in ("docs", "pairs_ge", "clusters08", "random_pairs")}, indent=0))
