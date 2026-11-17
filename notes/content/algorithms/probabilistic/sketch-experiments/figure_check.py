"""Independent reference values for the two figures' tests.

HyperLogLog: estimators written directly from the formulas in Flajolet et al.
(2007, Fig. 3) and Ertl (2017, eqs. 32-34), applied to register histograms of
sketches built here with Python's own random generator.

Count-Min: the figure's sketch recomputed in NumPy on the same hourly counts,
with the same hash (MurmurHash3 fmix32) and the same per-row seeds (a port of
mulberry32), so the summary statistics must match exactly.

Run: python3 figure_check.py  (writes figure-check.json beside this file)
"""
import json, math, random, re
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
DATA_TS = HERE / "../../../../quartz-site/plugins/mdx/src/components/count-min-lab/data.ts"

def alpha(m):
    return {16: 0.673, 32: 0.697, 64: 0.709}.get(m, 0.7213 / (1 + 1.079 / m))

def sigma(x, terms=80):
    if x == 1.0: return math.inf
    return x + sum(x ** (2 ** k) * 2 ** (k - 1) for k in range(1, terms) if x ** (2 ** k) > 0)

def tau(x, terms=80):
    if x in (0.0, 1.0): return 0.0
    return (1 - x - sum((1 - x ** (2.0 ** -k)) ** 2 * 2.0 ** -k for k in range(1, terms))) / 3

def estimates(C, p):
    m = 2 ** p; q = 64 - p
    raw = alpha(m) * m * m / sum(C[k] * 2.0 ** -k for k in range(q + 2))
    V = C[0]
    orig = m * math.log(m / V) if raw <= 2.5 * m and V > 0 else raw
    denom = m * sigma(V / m) + sum(C[k] * 2.0 ** -k for k in range(1, q + 1)) + m * tau(1 - C[q + 1] / m) * 2.0 ** -q
    ertl = m * m / (2 * math.log(2)) / denom
    return dict(raw=raw, orig=orig, ertl=ertl)

def hll_fixtures():
    rnd = random.Random(12345); out = []
    for p in (4, 6, 8, 10, 12):
        m = 2 ** p
        for n in (0, 1, m // 4, m, 3 * m, 30 * m):
            reg = [0] * m
            for _ in range(n):
                h = rnd.getrandbits(64); j = h >> (64 - p); w = (h << p) & (2 ** 64 - 1)
                r = (64 - w.bit_length() + 1) if w else 64 - p + 1
                reg[j] = max(reg[j], r)
            C = [0] * (66 - p); 
            for v in reg: C[v] += 1
            out.append(dict(p=p, n=n, C=C, est=estimates(C, p)))
    return out

M32 = 0xFFFFFFFF
def mulberry32(seed):
    a = seed & M32
    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & M32
        t = ((a ^ (a >> 15)) * (1 | a)) & M32
        t = (t + (((t ^ (t >> 7)) * (61 | t)) & M32)) & M32 ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296
    return nxt

def fmix32(h):
    h = h.astype(np.uint64)
    h ^= h >> np.uint64(16); h = (h * np.uint64(0x85EBCA6B)) & np.uint64(M32)
    h ^= h >> np.uint64(13); h = (h * np.uint64(0xC2B2AE35)) & np.uint64(M32)
    h ^= h >> np.uint64(16); return h

def cms_fixtures():
    nums = [int(x) for x in re.findall(r"\d+", DATA_TS.read_text().split("COUNT_PAIRS")[1])]
    vals, mult = nums[0::2], nums[1::2]
    counts = np.repeat(np.array(vals[::-1], dtype=np.int64), np.array(mult[::-1]))  # descending
    n = len(counts); N = int(counts.sum()); idx = np.arange(n, dtype=np.uint64)
    out = dict(pages=n, views=N, cases=[])
    for logw, d, seed in ((8, 3, 1), (10, 4, 1), (12, 1, 5), (14, 6, 2)):
        rnd = mulberry32(seed); seeds = [int(rnd() * 4294967296) & M32 for _ in range(d)]
        est = np.full(n, np.inf)
        for s in seeds:
            b = fmix32(((idx * np.uint64(0x9E3779B1)) + np.uint64(s)) & np.uint64(M32)) >> np.uint64(32 - logw)
            row = np.bincount(b.astype(np.int64), weights=counts, minlength=2 ** logw)
            est = np.minimum(est, row[b.astype(np.int64)])
        err = est - counts; epsN = math.e / 2 ** logw * N
        singles = np.sort(est[counts == 1])
        out["cases"].append(dict(logw=logw, d=d, seed=seed, exceed=float((err > epsN).mean()), exact=float((err == 0).mean()),
            meanErr=float(err.mean()), medianSingle=float(singles[(len(singles) - 1) // 2]),
            top100Rel=float((err[:100] / counts[:100]).mean()), minErr=float(err.min())))
    return out

if __name__ == "__main__":
    res = dict(hll=hll_fixtures(), cms=cms_fixtures())
    (HERE / "figure-check.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res["cms"], indent=1))
