# Independent NumPy implementation of the Bloom figure's simulation
# (quartz-site/plugins/mdx/src/components/bloom-lab/model.ts). Writes
# figure-check.json: probe positions, set-bit counts and false-positive counts
# that the figure's tests must reproduce exactly, and closed-form values from
# theory.py that its formulas must match.
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from theory import fpr_blocked, fpr_blocked_exact, fpr_std  # noqa: E402

U32 = np.uint32
KMAX = 16


def fmix32(h):
    h = h.astype(np.uint64) & 0xFFFFFFFF
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & 0xFFFFFFFF
    h ^= h >> 16
    return h


def seeds(seed):
    a = seed & 0xFFFFFFFF
    out = []
    for _ in range(KMAX + 2):
        a = (a + 0x9E3779B9) & 0xFFFFFFFF
        out.append(int(fmix32(np.array([a]))[0]))
    return out[0], out[1:]


def rng(h, r):
    return (h * np.uint64(r)) >> np.uint64(32)


def probes(layout, m, k, seed, xs):
    s, t = seeds(seed)
    base = fmix32((xs.astype(np.uint64) + s) & 0xFFFFFFFF)
    h = lambda i: fmix32(base ^ np.uint64(t[i]))  # noqa: E731
    P = np.zeros((k, len(xs)), dtype=np.int64)
    if layout == "standard":
        for i in range(k):
            P[i] = rng(h(i), m)
    elif layout == "partitioned":
        w = m // k
        for i in range(k):
            P[i] = i * w + rng(h(i), w)
    elif layout == "double":
        a = rng(h(0), m).astype(np.int64)
        b = rng(h(1), m).astype(np.int64)
        for i in range(k):
            P[i] = (a + i * b) % m
    elif layout == "blocked512":
        blk = rng(h(0), m // 512).astype(np.int64) * 512
        for i in range(k):
            P[i] = blk + (h(i + 1) >> np.uint64(23)).astype(np.int64)
    elif layout == "blocked64":
        blk = rng(h(0), m // 64).astype(np.int64) * 64
        for i in range(k):
            P[i] = blk + (h(i + 1) >> np.uint64(26)).astype(np.int64)
    elif layout == "leveldb":
        g = h(0)
        delta = ((g >> np.uint64(17)) | (g << np.uint64(15))) & 0xFFFFFFFF
        for i in range(k):
            P[i] = (g % np.uint64(m)).astype(np.int64)
            g = (g + delta) & 0xFFFFFFFF
    return P


def measure(layout, m, n, k, seed, q):
    bits = np.zeros(m, dtype=bool)
    P = probes(layout, m, k, seed, np.arange(n, dtype=np.uint64))
    bits[P.ravel()] = True
    Q = probes(layout, m, k, seed, np.arange(n, n + q, dtype=np.uint64))
    fp = int(np.all(bits[Q], axis=0).sum())
    return int(bits.sum()), fp


def main():
    cases = []
    layouts = ["standard", "partitioned", "double", "blocked512", "blocked64", "leveldb"]
    for layout in layouts:
        for m, b, k, seed in [(1 << 16, 10, 7, 1), (1 << 16, 4, 3, 2), (1 << 18, 16, 11, 3), (2048, 10, 7, 4), (1 << 20, 10, 7, 5)]:
            n = round(m / b)
            q = 1 << 16
            ones, fp = measure(layout, m, n, k, seed, q)
            P = probes(layout, m, k, seed, np.arange(5, dtype=np.uint64))
            cases.append({"layout": layout, "m": m, "n": n, "k": k, "seed": seed, "q": q, "ones": ones, "fp": fp, "probes": P.T.tolist()})
    formulas = []
    for b in [4, 6, 10, 16, 20]:
        for k in [1, 3, 7, 11, 16]:
            formulas.append({"b": b, "k": k, "std": fpr_std(b, k), "putze512": fpr_blocked(b, k, 512), "exact512": fpr_blocked_exact(b, k, 512),
                             "putze64": fpr_blocked(b, k, 64), "exact64": fpr_blocked_exact(b, k, 64)})
    mix = [{"x": int(x), "fmix32": int(fmix32(np.array([x]))[0])} for x in [0, 1, 2, 0xDEADBEEF, 0xFFFFFFFF, 123456789]]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "figure-check.json")
    with open(out, "w") as f:
        json.dump({"cases": cases, "formulas": formulas, "mix": mix, "seeds": {str(s): list(seeds(s)) for s in [1, 7]}}, f)
    print(f"wrote {len(cases)} cases and {len(formulas)} formula points")


if __name__ == "__main__":
    main()
