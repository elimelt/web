"""Independent implementation of the quantile figure's sketches.

Reads stream.u16.gz (the sample of response-start timings in recorded order,
as little-endian uint16) and writes figure-check.json, which the figure's
tests compare against the TypeScript model, and initial.json, the view the
page renders before its script loads.

KLL: levels of items; level h of H has capacity max(2, ceil(k (2/3)^(H-1-h))).
After each insertion, while the sketch holds more items than the sum of its
capacities, the lowest level at or over capacity is sorted, its largest item
is held back if the count is odd, and a coin from Mulberry32 (seeded as in
the figure) keeps the even or the odd positions, which move up a level.
DDSketch: key ceil(log_gamma x), gamma = (1 + alpha)/(1 - alpha), estimate
2 gamma^key / (gamma + 1) for the bucket that holds rank ceil(q n).
"""
import bisect
import gzip
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
C = 2 / 3
MIN_CAP = 2


def mulberry32(seed):
    a = seed & 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & 0xFFFFFFFF

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return nxt


def capacity(k, h, H):
    return max(MIN_CAP, math.ceil(k * C ** (H - 1 - h)))


def kll(values, upto, k, seed):
    rnd = mulberry32(seed)
    levels = [[]]
    size = 0
    comp = 0
    last = None

    def total():
        return sum(capacity(k, h, len(levels)) for h in range(len(levels)))
    cap = total()
    for t in range(upto):
        levels[0].append(values[t])
        size += 1
        while size > cap:
            H = len(levels)
            h = next((h for h in range(H) if len(levels[h]) >= capacity(k, h, H)), None)
            if h is None:
                break
            if h == H - 1:
                levels.append([])
                cap = total()
            lv = sorted(levels[h])
            keep = [lv.pop()] if len(lv) % 2 else []
            off = 0 if rnd() < 0.5 else 1
            before = len(lv) + len(keep)
            levels[h + 1].extend(lv[off::2])
            size -= len(lv) // 2
            levels[h] = keep
            comp += 1
            last = {"at": t + 1, "level": h, "size": before, "offset": off}
    return levels, comp, last


def kll_quantile(levels, n, q):
    items = sorted((v, 2 ** h) for h, lv in enumerate(levels) for v in lv)
    r = max(1, math.ceil(q * n))
    c = 0
    for v, w in items:
        c += w
        if c >= r:
            return v
    return items[-1][0]


def dd(values, upto, alpha):
    g = (1 + alpha) / (1 - alpha)
    counts = {}
    lg = math.log(g)
    for t in range(upto):
        key = math.ceil(math.log(values[t]) / lg)
        counts[key] = counts.get(key, 0) + 1
    return g, counts


def dd_quantile(g, counts, n, q):
    r = max(1, math.ceil(q * n))
    c = 0
    for key in range(min(counts), max(counts) + 1):
        c += counts.get(key, 0)
        if c >= r:
            return 2 * g ** key / (g + 1)
    return 2 * g ** max(counts) / (g + 1)


def exact(values, upto):
    return sorted(values[:upto])


def exact_quantile(s, q):
    return s[max(1, math.ceil(q * len(s))) - 1]


def rank_error(s, q, est):
    n = len(s)
    lo = bisect.bisect_left(s, est) / n
    hi = bisect.bisect_right(s, est) / n
    return max(0.0, lo - q, q - hi)


def grid(points):
    return [float("%.12g" % (1 - 10 ** -(0.3 + 2.7 * i / (points - 1)))) for i in range(points)]


def main():
    raw = gzip.decompress(open(os.path.join(HERE, "stream.u16.gz"), "rb").read())
    values = [raw[2 * i] | (raw[2 * i + 1] << 8) for i in range(len(raw) // 2)]
    T = len(values)
    qs = grid(12)
    out = {"T": T, "max": max(values), "qs": qs, "seq7": [], "cases": []}
    g = mulberry32(7)
    out["seq7"] = [g() for _ in range(5)]
    for k in (8, 32, 128, 256):
        for upto in (1, 7, 100, 1000, T // 3, T):
            for seed in (1, 2):
                levels, comp, last = kll(values, upto, k, seed)
                s = exact(values, upto)
                est = [kll_quantile(levels, upto, q) for q in qs]
                out["cases"].append({"kind": "kll", "k": k, "upto": upto, "seed": seed,
                                     "levels": [sorted(lv) for lv in levels], "compactions": comp, "last": last,
                                     "est": est, "truth": [exact_quantile(s, q) for q in qs],
                                     "rank": [rank_error(s, q, e) for q, e in zip(qs, est)]})
    for alpha in (0.05, 0.01, 0.002):
        for upto in (1, 100, T):
            gm, counts = dd(values, upto, alpha)
            s = exact(values, upto)
            est = [dd_quantile(gm, counts, upto, q) for q in qs]
            out["cases"].append({"kind": "dd", "alpha": alpha, "upto": upto,
                                 "bins": max(counts) - min(counts) + 1, "keys": sorted([k, c] for k, c in counts.items()),
                                 "est": est, "truth": [exact_quantile(s, q) for q in qs],
                                 "rank": [rank_error(s, q, e) for q, e in zip(qs, est)]})
    json.dump(out, open(os.path.join(HERE, "figure-check.json"), "w"), separators=(",", ":"))
    # The default view: k = 64, alpha = 0.01, all records, seed 1.
    qs60 = grid(60)
    levels, comp, _ = kll(values, T, 64, 1)
    s = exact(values, T)
    gm, counts = dd(values, T, 0.01)
    init = {"k": 64, "alpha": 0.01, "qs": qs60,
            "truth": [exact_quantile(s, q) for q in qs60],
            "kll": [kll_quantile(levels, T, q) for q in qs60],
            "dd": [dd_quantile(gm, counts, T, q) for q in qs60],
            "kllRank": [rank_error(s, q, kll_quantile(levels, T, q)) for q in qs60],
            "ddRank": [rank_error(s, q, dd_quantile(gm, counts, T, q)) for q in qs60],
            "levels": [len(lv) for lv in levels], "compactions": comp,
            "bins": max(counts) - min(counts) + 1}
    json.dump(init, open(os.path.join(HERE, "initial.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
