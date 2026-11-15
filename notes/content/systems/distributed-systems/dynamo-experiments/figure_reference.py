"""Reference values for the figure's tests, from the Python simulator.

    python3 figure_reference.py > figure-reference.json

The figure (quartz-site/plugins/mdx/src/components/stale-reads/model.ts) is an
independent TypeScript implementation of the same model. Its test runs it with
its own random generator and checks every value here within the combined
sampling error of the two simulations.
"""

from __future__ import annotations

import json

import numpy as np

import dynsim as d

N_TRIALS = 2_000_000
CASES = [
    # profile, N, R, W, f, t (ms after commit)
    ("LNKD-SSD", 3, 1, 1, 0.0, 0.0),
    ("LNKD-SSD", 3, 1, 1, 0.0, 1.0),
    ("LNKD-DISK", 3, 1, 1, 0.0, 0.0),
    ("LNKD-DISK", 3, 1, 1, 0.0, 10.0),
    ("LNKD-DISK", 3, 2, 1, 0.0, 5.0),
    ("LNKD-DISK", 5, 1, 2, 0.0, 5.0),
    ("YMMR", 3, 1, 1, 0.0, 0.0),
    ("YMMR", 3, 1, 1, 0.0, 500.0),
    ("WAN", 3, 1, 1, 0.0, 0.0),
    ("WAN", 3, 2, 1, 0.0, 20.0),
    ("LNKD-DISK", 3, 1, 1, 0.05, 10000.0),
    ("LNKD-DISK", 3, 2, 2, 0.05, 2000.0),
    ("LNKD-DISK", 3, 2, 2, 0.05, 20000.0),
    ("LNKD-DISK", 3, 2, 2, 0.1, 100000.0),
    ("YMMR", 3, 1, 2, 0.05, 1000.0),
]

out = []
for i, (prof, N, R, W, f, t) in enumerate(CASES):
    fl = d.Failures(f, 10_000.0, 1000.0)
    res = d.simulate(np.random.default_rng([30, i]), prof, N, R, W, t, N_TRIALS, fl)
    ok = res["write_ok"] & res["read_ok"]
    k, n = int(res["stale"][ok].sum()), int(ok.sum())
    out.append({"profile": prof, "N": N, "R": R, "W": W, "f": f, "t_ms": t, "stale": k, "trials": n, "p": k / n})
print(json.dumps({"outage_ms": 10_000.0, "hint_delay_ms": 1000.0, "cases": out}, indent=1))
