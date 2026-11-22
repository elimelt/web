"""Independent reference for the MinHash and LSH figure (components/minhash-lsh).

Usage: python3 -I figure_ref.py DIR ANALYSIS_JSON
Reads DIR/pairs.bin.gz; writes DIR/figure-check.json (candidates, matches and
per-bin counts for several band settings), DIR/initial.json (the default view
rendered at build time) and DIR/meta.json (the figure's pair count and the
full-crawl LSH measurements from ANALYSIS_JSON for the settings measured there).
"""
import gzip
import json
import sys

import numpy as np

D = sys.argv[1]
K = 256
raw = np.frombuffer(gzip.decompress(open(f"{D}/pairs.bin.gz", "rb").read()), dtype=np.uint8).reshape(-1, 4 + K // 8)
J = raw[:, :4].copy().view("<f4").ravel().astype(np.float64)
EQ = np.unpackbits(raw[:, 4:], axis=1, bitorder="little").astype(bool)  # (n, K)
n = len(J)
BINS = 20


def evaluate(b, r):
    bands = EQ[:, :b * r].reshape(n, b, r).all(axis=2)
    cand = bands.any(axis=1)
    m = EQ[:, :b * r].sum(axis=1)
    idx = np.minimum((J * BINS).astype(int), BINS - 1)
    s = 1 - (1 - J ** r) ** b
    bins = []
    for j in range(BINS):
        sel = idx == j
        bins.append({"pairs": int(sel.sum()), "candidates": int(cand[sel].sum()),
                     "theory": float(s[sel].mean()) if sel.any() else 0.0})
    return cand, m, bins


cases = []
for b, r in [(32, 8), (20, 10), (64, 4), (1, 1), (128, 2), (5, 50), (16, 16), (3, 7)]:
    cand, m, bins = evaluate(b, r)
    cases.append({"b": b, "r": r, "candidates": np.flatnonzero(cand).tolist(), "matches": m.tolist(), "bins": bins})
json.dump({"n": n, "J": J.tolist(), "cases": cases}, open(f"{D}/figure-check.json", "w"))
B0, R0 = 32, 8
cand, m, bins = evaluate(B0, R0)
json.dump({"b": B0, "r": R0, "J": np.round(J * 1e4).astype(int).tolist(), "matches": m.tolist(),
           "candidate": cand.astype(int).tolist(), "bins": bins}, open(f"{D}/initial.json", "w"), separators=(",", ":"))
a = json.load(open(sys.argv[2]))
full = {}
for key, v in a["lsh"].items():
    if v.get("exact"):
        full[key] = {"candidates": v["candidates"], "recall08": v["recall08"], "recall05": v["recall05"],
                     "candGe08": v["cand_ge08"], "candLt03": v["cand_lt03"]}
meta = {"pairs": n, "docs": a["docs"], "allPairs": a["all_pairs"], "pairsGe08": a["pairs_ge"]["0.8"], "full": full}
json.dump(meta, open(f"{D}/meta.json", "w"), indent=1)
print(n, sorted(full))
