"""Summaries of the accuracy and timing runs, as quoted in the note.

Run:  python3 summarize.py accuracy-60x8.json accuracy-200x20.json timing.json
"""
import json, math, sys
import numpy as np

METHODS = ["normal", "qr", "svd", "svd0"]


def med(xs):
    xs = sorted(math.inf if x is None else x for x in xs)
    return xs[len(xs) // 2] if len(xs) % 2 else 0.5 * (xs[len(xs) // 2 - 1] + xs[len(xs) // 2])


def accuracy(path):
    d = json.load(open(path))
    R = d["records"]
    m, n = R[0]["m"], R[0]["n"]
    print(f"\n== {path}: {m} x {n}, {len(R)} problems")
    tans = sorted({r["tan_theta"] for r in R})
    lks = sorted({r["logk"] for r in R})
    out = {}
    for t in tans:
        rows = {}
        for lk in lks:
            rs = [r for r in R if r["tan_theta"] == t and r["logk"] == lk]
            rows[lk] = {meth: dict(median=med([r["err"][meth] for r in rs]),
                                   lo=min((r["err"][meth] for r in rs if r["err"][meth] is not None), default=None),
                                   hi=max((r["err"][meth] for r in rs if r["err"][meth] is not None), default=None),
                                   failed=sum(r["err"][meth] is None for r in rs),
                                   count=len(rs)) for meth in METHODS}
        # Slopes of log10(median error) against log10(kappa) over 10^2..10^7.
        slopes = {}
        for meth in METHODS:
            xs = [lk for lk in lks if 2 <= lk <= 7]
            ys = [math.log10(rows[lk][meth]["median"]) for lk in xs]
            slopes[meth] = float(np.polyfit(xs, ys, 1)[0])
        eta = med([r["eta"] for r in R if r["tan_theta"] == t])
        out[str(t)] = dict(rows=rows, slopes=slopes, eta_median=eta)
        print(f"tan={t:g}  slope(10^2..10^7): " + "  ".join(f"{k} {v:.2f}" for k, v in slopes.items()) + f"  median eta {eta:.2f}")
        for lk in lks:
            if lk in (0, 4, 6, 8, 8.5, 9, 9.5, 10, 12, 14, 16):
                cells = []
                for meth in METHODS:
                    c = rows[lk][meth]
                    cells.append(f"{meth} {c['median']:.1e} f{c['failed']}/{c['count']}")
                print(f"  k=1e{lk:<4} " + " | ".join(cells))
    return dict(m=m, n=n, meta=d["meta"], by_tan=out)


def timing(path):
    d = json.load(open(path))
    print(f"\n== {path}")
    rows = d["rows"]
    ns = sorted({r["n"] for r in rows})
    for n in ns:
        t = {r["method"]: r["median"] for r in rows if r["n"] == n}
        print(f"  n={n:4d} " + "  ".join(f"{k} {v*1e3:8.1f} ms" for k, v in t.items()) +
              f"  qr/normal {t['qr']/t['normal']:.1f}  svd/qr {t['svd']/t['qr']:.2f}  minwork/qr {t['qr_minwork']/t['qr']:.1f}")
    return d


if __name__ == "__main__":
    for p in sys.argv[1:]:
        accuracy(p) if "accuracy" in p else timing(p)
