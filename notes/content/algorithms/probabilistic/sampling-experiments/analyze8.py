"""Subset-sum accuracy of the three samplers from samp's output.

Usage: python3 -I analyze8.py subsets_K.txt ...
Prints, for each K and subset, the true sum, and for each method the mean
relative error (bias), the relative RMSE, the share of trials with relative
error above 10%, and for priority sampling the coverage of the interval
estimate +- 2 sqrt(variance estimate).
"""
import json
import sys

import numpy as np

NAMES = ["en.m", "en", "de", "fi", "gl", "pt.n", "an", "hour 0", "hour 12", "1/100 of pages", "1/10,000 of pages", "all"]
out = {}
for path in sys.argv[1:]:
    K = int(path.split("_")[-1].split(".")[0])
    lines = open(path).read().split("\n")
    truth = [tuple(map(float, t.split(":"))) for t in lines[0].split()[1:]]
    est = {"uniform": [], "priority": [], "ppswor": []}
    var = []
    for l in lines[1:]:
        if not l:
            continue
        f = l.split()
        if f[0] == "priority":
            est["priority"].append([float(x.split(":")[0]) for x in f[2:]])
            var.append([float(x.split(":")[1]) for x in f[2:]])
        else:
            est[f[0]].append([float(x) for x in f[2:]])
    T = np.array([t[0] for t in truth])
    res = {}
    for j, name in enumerate(NAMES):
        row = {"sum": T[j], "records": truth[j][1]}
        for m, e in est.items():
            e = np.array(e)[:, j]
            rel = (e - T[j]) / T[j]
            row[m] = {"trials": len(rel), "bias": float(rel.mean()), "rrmse": float(np.sqrt((rel ** 2).mean())),
                      "over10": float((np.abs(rel) > 0.1).mean())}
        e = np.array(est["priority"])[:, j]
        v = np.array(var)[:, j]
        row["priority"]["cover2"] = float((np.abs(e - T[j]) <= 2 * np.sqrt(v)).mean())
        row["priority"]["est_rse"] = float(np.mean(np.sqrt(v)) / T[j])
        res[name] = row
    out[K] = res
    print(f"K = {K} (trials {len(est['priority'])})")
    print(f"{'subset':20s} {'share':>8s} | {'uniform':>8s} {'priority':>8s} {'ppswor':>8s} | bias(pri) cover2 est_rse")
    for name, r in res.items():
        print(f"{name:20s} {r['sum']/T[-1]:8.5f} | {r['uniform']['rrmse']:8.4f} {r['priority']['rrmse']:8.4f} {r['ppswor']['rrmse']:8.4f} | "
              f"{r['priority']['bias']:+.4f} {r['priority']['cover2']:.2f} {r['priority']['est_rse']:.4f}")
json.dump(out, open("analysis.json", "w"), indent=1)
