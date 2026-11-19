# Summarizes the Bloom filter runs (A.txt, B.txt, C.txt, D.txt, speed.txt,
# ldb_probe3.txt) into summary.json and prints the tables the note quotes.
import collections
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from theory import fpr_blocked, fpr_blocked_exact, fpr_std  # noqa: E402

N = 5843219
here = os.path.dirname(os.path.abspath(__file__))


def rows(name):
    with open(os.path.join(here, name)) as f:
        return [line.split() for line in f if not line.startswith("#")]


out = {}

# B: layouts at k = round(b ln 2)
B = collections.defaultdict(list)
for t, v, b, k, m, fill, fp, q in rows("B.txt"):
    B[(v, int(b))].append((int(k), int(m), float(fill), int(fp), int(q)))
out["layouts"] = []
print("bits/key layout k  measured  sd  standard-formula  ratio  layout-formula  rho^k")
for (v, b), xs in sorted(B.items(), key=lambda z: (z[0][1], z[0][0])):
    k, m = xs[0][0], xs[0][1]
    rate = np.array([x[3] / x[4] for x in xs])
    fill = np.array([x[2] for x in xs])
    std = (1 - math.exp(-k * N / m)) ** k
    lay = {"blocked512": fpr_blocked_exact(m / N, k, 512), "blocked64": fpr_blocked_exact(m / N, k, 64)}.get(v, std)
    putze = {"blocked512": fpr_blocked(m / N, k, 512), "blocked64": fpr_blocked(m / N, k, 64)}.get(v)
    rec = {"layout": v, "b": b, "k": k, "trials": len(xs), "fpr": rate.mean(), "sd": rate.std(ddof=1), "std_formula": std,
           "layout_formula": lay, "putze": putze, "fill": fill.mean(), "rho_k": float(np.mean(fill ** k))}
    out["layouts"].append(rec)
    print(f"{b:3d} {v:16s} {k:2d} {rec['fpr']:.3e} {rec['sd']:.1e} {std:.3e} {rec['fpr']/std:6.2f} {lay:.3e} {rec['rho_k']:.3e}"
          + (f" putze {putze:.3e} ({rec['fpr']/putze - 1:+.1%})" if putze else ""))

# A: standard filter, b x k grid
A = collections.defaultdict(list)
for t, b, k, m, fill, fp, q in rows("A.txt"):
    A[(int(b), int(k))].append((int(fp) / int(q), float(fill), int(m)))
out["grid"] = []
for (b, k), xs in sorted(A.items()):
    a = np.array(xs)
    th = (1 - math.exp(-k * N / a[0, 2])) ** k
    out["grid"].append({"b": b, "k": k, "fpr": a[:, 0].mean(), "sd": a[:, 0].std(ddof=1), "formula": th, "fill": a[:, 1].mean()})
print("\nstandard filter, best integer k per bits/key (10M negatives, 5 trials)")
for b in sorted({g["b"] for g in out["grid"]}):
    g = [x for x in out["grid"] if x["b"] == b]
    best = min(g, key=lambda x: x["fpr"])
    rel = max(abs(x["fpr"] / x["formula"] - 1) for x in g)
    print(f"b={b:2d} best k={best['k']:2d} fpr={best['fpr']:.3e} b*ln2={b*math.log(2):.2f}  max |measured/formula - 1| over k=1..14: {rel:.3%}")

# D: k sweep of blocked layouts
D = collections.defaultdict(list)
for t, v, b, k, m, fill, fp, q in rows("D.txt"):
    D[(v, int(b), int(k))].append(int(fp) / int(q))
out["blocked_k"] = []
print("\nk sweep (10M negatives, 3 trials)")
for v in ["standard", "blocked512", "blocked64"]:
    for b in [10, 16]:
        ks = sorted(k for (vv, bb, k) in D if vv == v and bb == b)
        if not ks:
            continue
        vals = {k: float(np.mean(D[(v, b, k)])) for k in ks}
        best = min(vals, key=vals.get)
        B_ = {"blocked512": 512, "blocked64": 64}.get(v)
        th = {k: (fpr_blocked_exact(b, k, B_) if B_ else fpr_std(b, k)) for k in ks}
        tbest = min(th, key=th.get)
        out["blocked_k"].append({"layout": v, "b": b, "measured": vals, "formula": th, "best_k": best, "formula_best_k": tbest})
        print(f"{v:11s} b={b}: measured best k={best} ({vals[best]:.3e}); formula best k={tbest} ({th[tbest]:.3e}); max rel err {max(abs(vals[k]/th[k]-1) for k in ks):.2%}")

# C: counting filter
C = rows("C.txt")
H = np.array([[int(x) for x in r[5:]] for r in C])
m = int(C[0][3])
lam = int(C[0][2]) * N / m
out["counting"] = {"b": int(C[0][1]), "k": int(C[0][2]), "m": m, "trials": len(C), "max": [int(r[4]) for r in C],
                   "mean_hist": H.mean(axis=0).tolist(), "poisson": [m * math.exp(-lam) * lam ** i / math.factorial(i) for i in range(21)],
                   "fan_bound": m * (math.e * math.log(2) / 16) ** 16}
print(f"\ncounting: max counter per trial {out['counting']['max']}, Fan bound on P(max>=16) {out['counting']['fan_bound']:.2e}")

# speed
S = collections.defaultdict(list)
for lg, name, by, ins, qa, qp, fpr, hits in rows("speed.txt"):
    S[(int(lg), name)].append((float(ins), float(qa), float(qp), int(by)))
out["speed"] = []
print("\nns per operation, median of reps: insert / absent / present")
for lg in sorted({k[0] for k in S}):
    for v in ["standard", "double", "blocked512", "blocked64"]:
        a = np.array(S[(lg, v)])
        rec = {"log2n": lg, "layout": v, "bytes": int(a[0, 3]), "reps": len(a), "insert": float(np.median(a[:, 0])), "absent": float(np.median(a[:, 1])),
               "present": float(np.median(a[:, 2])), "absent_range": [float(a[:, 1].min()), float(a[:, 1].max())]}
        out["speed"].append(rec)
    if lg in (17, 20, 24, 28):
        print(lg, f"{out['speed'][-1]['bytes'] / 2**20:.2f} MiB", " | ".join(f"{r['layout']} {r['insert']:.0f}/{r['absent']:.0f}/{r['present']:.0f}" for r in out["speed"][-4:]))

with open(os.path.join(here, "ldb_probe3.txt")) as f:
    out["leveldb_probe_distinct"] = [int(line.split()[2]) for line in f]

with open(os.path.join(here, "summary.json"), "w") as f:
    json.dump(out, f, indent=1)
