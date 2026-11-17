#!/usr/bin/env python3
"""Fits Amdahl's law and the USL to raw.jsonl and to the two published datasets; writes scaling-results.json."""
import json, sys, statistics as st
import numpy as np
from scipy.optimize import least_squares

raw = []
# xz: N = 1 comes from the multithreaded encoder run with one thread (-T+1), so every N runs the same
# program. The -T1 runs (xz's single-threaded encoder) form workload xz_t1 with the same N >= 2 runs.
for r in (json.loads(l) for l in open(sys.argv[1])):
    if r["workload"] == "xz":
        raw.append(dict(r, workload="xz_t1"))
        if r["n"] > 1: raw.append(r)
    elif r["workload"] == "xz_mt1":
        raw.append(dict(r, workload="xz"))
    else:
        raw.append(r)
out = {}

def amdahl_fit(ns, ts):
    # T(N) = a + b/N  (a: serial seconds, b: parallelizable seconds); least squares on all runs
    X = np.column_stack([np.ones(len(ns)), 1 / np.asarray(ns, float)])
    (a, b), *_ = np.linalg.lstsq(X, np.asarray(ts, float), rcond=None)
    return a / (a + b)

def usl_fit(ns, xs, with_kappa=True):
    """Least squares on throughput X(N) = gamma N / (1 + sigma (N-1) + kappa N (N-1)); kappa = 0 is Amdahl."""
    ns, xs = np.asarray(ns, float), np.asarray(xs, float)
    best = None
    for s0 in (0.0, 0.02, 0.1, 0.3):
        for k0 in ((0.0, 1e-5, 1e-3, 0.1, 1.0) if with_kappa else (0.0,)):
            if with_kappa:
                f = lambda q: q[0] * ns / (1 + q[1] * (ns - 1) + q[2] * ns * (ns - 1)) - xs
                lb, ub, q0, sc = [0, -0.5, 0], [np.inf, 1, np.inf], [max(xs / ns), s0, k0], [max(xs / ns), 0.01, 1e-4]
            else:
                f = lambda q: q[0] * ns / (1 + q[1] * (ns - 1)) - xs
                lb, ub, q0, sc = [0, -0.5], [np.inf, 1], [max(xs / ns), s0], [max(xs / ns), 0.01]
            r = least_squares(f, q0, bounds=(lb, ub), x_scale=sc, xtol=1e-15, ftol=1e-15, gtol=1e-15)
            if best is None or r.cost < best.cost: best = r
    q = list(best.x) + ([] if with_kappa else [0.0])
    return dict(gamma=q[0], sigma=q[1], kappa=q[2], sse=2 * best.cost)

rng = np.random.default_rng(1)
for w in sorted({r["workload"] for r in raw}):
    rows = [r for r in raw if r["workload"] == w]
    by = {n: [r["seconds"] for r in rows if r["n"] == n] for n in (1, 2, 3, 4) if any(r["n"] == n for r in rows)}
    med = {n: st.median(v) for n, v in by.items()}
    S = {n: med[1] / med[n] for n in by}
    kf = {n: (1 / S[n] - 1 / n) / (1 - 1 / n) for n in (2, 3, 4)}
    ns = [n for n in by for _ in by[n]]; ts = [t for n in by for t in by[n]]
    f = amdahl_fit(ns, ts)
    # bootstrap: resample runs within each N
    boots = []
    for _ in range(2000):
        bn, bt = [], []
        for n, v in by.items():
            s = rng.choice(v, len(v)); bn += [n] * len(v); bt += list(s)
        boots.append(amdahl_fit(bn, bt))
    lo, hi = np.percentile(boots, [2.5, 97.5])
    thr = [1 / t for t in ts]  # runs per second
    u = usl_fit(ns, thr)
    am = usl_fit(ns, thr, False)
    bs = []
    for _ in range(300):
        bn, bx = [], []
        for n, v in by.items():
            s = rng.choice(v, len(v)); bn += [n] * len(v); bx += [1 / t for t in s]
        bs.append((usl_fit(bn, bx, False)["sigma"], *[usl_fit(bn, bx)[k] for k in ("sigma", "kappa")]))
    bs = np.array(bs)
    ci = {k: list(np.percentile(bs[:, i], [2.5, 97.5])) for i, k in enumerate(("amdahl_sigma", "usl_sigma", "usl_kappa"))}
    out[w] = dict(n=list(by), seconds={n: sorted(v) for n, v in by.items()}, median=med, speedup=S,
                  speedup_range={n: [min(by[1]) / max(by[n]), max(by[1]) / min(by[n])] for n in by},
                  karp_flatt=kf, time_fit_f=f, time_fit_f_ci=[lo, hi], usl=u, amdahl=am, ci=ci,
                  max_load1=max(r["load1"] for r in rows))
    print(f"{w:8s} med={ {n: round(m,3) for n,m in med.items()} } S={ {n: round(s,3) for n,s in S.items()} }")
    print(f"         KF={ {n: round(e,4) for n,e in kf.items()} } timefit f={f:.4f} [{lo:.4f},{hi:.4f}] amdahl={am['sigma']:.4f} usl={ {k: float(f'{v:.4g}') for k,v in u.items()} }")

out["kernel"] = out["amdahl"]  # the figure's name for the 5% serial kernel

# published datasets (CRAN usl package; Gunther 2007)
pub = {"specsdm91": ([1, 18, 36, 72, 108, 144, 216], [64.9, 995.9, 1652.4, 1853.2, 1828.9, 1775.0, 1702.2]),
       "raytracer": ([1, 4, 8, 12, 16, 20, 24, 28, 32, 48, 64], [20, 78, 130, 170, 190, 200, 210, 230, 260, 280, 310])}
for k, (ns, xs) in pub.items():
    u = usl_fit(ns, xs); am = usl_fit(ns, xs, False)
    npk = np.sqrt((1 - u["sigma"]) / u["kappa"]) if u["kappa"] > 0 else None
    out[k] = dict(n=ns, throughput=xs, usl=u, amdahl=am, n_peak=npk)
    for m in (2, 3, 4, 5):  # fits to the first m points only
        out[k][f"usl_first{m}"] = usl_fit(ns[:m], xs[:m]); out[k][f"amdahl_first{m}"] = usl_fit(ns[:m], xs[:m], False)
    print(k, {a: float(f"{b:.6g}") for a, b in u.items()}, "Npeak", npk)
json.dump(out, open(sys.argv[2], "w"), indent=1, default=float)
