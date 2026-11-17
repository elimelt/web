"""Writes figure-check.json: the reference implementation's timeouts and QoS
metrics on the first 1,600 heartbeats of each run (window 100, judged from
heartbeat 100), which the figure's tests compare with the TypeScript model.
Usage: python3 figure_check.py TRACEDIR"""
import csv, json, os, sys
import reference as ref

out = {"window": 100, "start": 100, "cases": []}
for seed in (1, 2, 3):
    rows = list(csv.DictReader(open(os.path.join(sys.argv[1], f"run{seed}.csv"))))
    # take a slice that straddles the start of the workload in run 1 at 180 s
    lo = 1700 if seed == 1 else 0
    arr = [int(r["recv_ns"]) / 1e6 for r in rows[lo:lo + 1600]]
    arr = [a - arr[0] for a in arr]
    for kind, thr in [("phiNormal", 1), ("phiNormal", 3), ("phiNormal", 8), ("phiNormal", 16), ("phiExp", 1), ("phiExp", 8), ("timeout", 150), ("timeout", 400)]:
        q = ref.quality(kind, thr, arr, 100, 100)
        out["cases"].append({"seed": seed, "kind": kind, "threshold": thr, "arrivals": arr if kind == "phiNormal" and thr == 1 else None,
                             "detection": q["detection"], "mistakes": q["mistakes"], "accuracy": q["accuracy"], "taus": q["taus"][::50]})
json.dump(out, open(os.path.join(os.path.dirname(__file__), "figure-check.json"), "w"))
