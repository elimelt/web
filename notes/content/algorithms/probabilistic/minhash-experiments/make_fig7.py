"""Builds the MinHash/LSH figure's data.

Usage: python3 -I make_fig7.py DIR OUTDIR
Pairs come from three sources so that every Jaccard range is represented:
the exact join (J >= 0.3), random pairs (mostly J near 0), and pairs that
share at least one of the first 64 MinHash values (which spreads over all J).
Exact J is computed for every pair. Pairs are taken in random order, at most
PER_BIN per J bin of width 0.05, and no document is used twice, so the pairs
are not dominated by the large clusters of near-identical pages.
Writes OUTDIR/pairs.bin.gz: per pair a little-endian float32 J and the 256
MinHash agreement bits (32 bytes, bit t of byte t>>3 for hash t); and
OUTDIR/pairs-meta.json.
"""
import gzip
import json
import sys

import numpy as np

D, OUT = sys.argv[1], sys.argv[2]
K = 256
PER_BIN = 100
off = np.fromfile(f"{D}/offsets.i64", dtype=np.int64)
n = len(off) - 1
sizes = np.diff(off)
sig = np.fromfile(f"{D}/sig.u64", dtype=np.uint64).reshape(n, K)
tok = np.fromfile(f"{D}/sets.u64", dtype=np.uint64)
rng = np.random.default_rng(20261122)


def jac(a, b):
    i = len(np.intersect1d(tok[off[a]:off[a + 1]], tok[off[b]:off[b + 1]], assume_unique=True))
    return i / (sizes[a] + sizes[b] - i)


P = np.loadtxt(f"{D}/pairs.tsv", dtype=np.float64, ndmin=2)
cand = [(int(a), int(b), float(j)) for a, b, j in zip(P[:, 0], P[:, 1], P[:, 4])]
for _ in range(20000):
    a, b = rng.integers(0, n, 2)
    if a != b:
        cand.append((int(min(a, b)), int(max(a, b)), None))
# Pairs sharing a MinHash value at one of the first 64 positions.
for t in range(64):
    order = np.argsort(sig[:, t], kind="stable")
    v = sig[order, t]
    starts = np.flatnonzero(np.r_[True, v[1:] != v[:-1]])
    lens = np.diff(np.r_[starts, n])
    for s0, L in zip(starts[lens > 1], lens[lens > 1]):
        if rng.random() < 0.05:
            g = order[s0:s0 + L]
            a, b = rng.choice(g, 2, replace=False)
            cand.append((int(min(a, b)), int(max(a, b)), None))
idx = rng.permutation(len(cand))
used = np.zeros(n, bool)
count = np.zeros(20, int)
keep = []
for t in idx:
    a, b, j = cand[t]
    if used[a] or used[b]:
        continue
    if j is None:
        j = jac(a, b)
    bin_ = min(int(j / 0.05), 19)
    if count[bin_] >= PER_BIN:
        continue
    count[bin_] += 1
    used[a] = used[b] = True
    keep.append((a, b, j))
keep.sort(key=lambda x: x[2])
buf = bytearray()
for a, b, j in keep:
    eq = (sig[a] == sig[b])
    buf += np.float32(j).tobytes()
    buf += np.packbits(eq, bitorder="little").tobytes()
open(f"{OUT}/pairs.bin.gz", "wb").write(gzip.compress(bytes(buf), 9, mtime=0))
json.dump({"pairs": len(keep), "perBin": count.tolist(), "docs": int(n)}, open(f"{OUT}/pairs-meta.json", "w"))
print(len(keep), count.tolist())
