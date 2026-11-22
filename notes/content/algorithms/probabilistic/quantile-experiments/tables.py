"""Tables for the note from quant.json: for each summary and size, the largest
rank and relative error over trials and both orders at each quantile."""
import json
import sys
from collections import defaultdict

import numpy as np

d = json.load(open(sys.argv[1]))
QS = d["qs"]
g = defaultdict(list)
for r in d["runs"]:
    key = (r["sketch"], r["param"], "merged" if r["order"] == "merged" else "single")
    g[key].append(r)
print("n", d["n"], "distinct", d["distinct"], "at_cap", d["at_cap"], "sites", d["sites"])
print("truth", d["truth"])
print("summary param kind bytes(min-max) | rank% at", QS, "| rel% at", QS)
for (s, p, kind), rs in g.items():
    b = [r["bytes"] for r in rs]
    rk = np.max([[x["rank_err"] for x in r["res"]] for r in rs], 0)
    rl = np.max([[x["rel_err"] for x in r["res"]] for r in rs], 0)
    mrk = np.mean([[x["rank_err"] for x in r["res"]] for r in rs], 0)
    print(f"{s} {p} {kind} {min(b)}-{max(b)} n={len(rs)} | " + " ".join(f"{100*v:.3f}" for v in rk) + " | " + " ".join(f"{100*v:.1f}" for v in rl) + " | mean " + " ".join(f"{100*v:.3f}" for v in mrk))
