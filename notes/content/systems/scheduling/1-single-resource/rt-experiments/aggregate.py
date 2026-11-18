"""Summarize a sweep.py results file: per utilization level, the fraction of
task sets with at least one missed deadline under each policy (mean over
repetitions, with the min and max across repetitions), the fraction of jobs
missed, and agreement between measured RM misses and response-time analysis.

  python3 aggregate.py results.json > summary.json
"""
import json, sys
from collections import defaultdict

d = json.load(open(sys.argv[1]))
reps = min(len(s["runs"][p]) for s in d["sets"] for p in ("rm", "edf"))
by_u = defaultdict(list)
for s in d["sets"]:
    by_u[s["target_u"]].append(s)
rows = []
for u in sorted(by_u):
    ss = by_u[u]
    row = {"target_u": u, "sets": len(ss), "mean_u": sum(s["u"] for s in ss) / len(ss),
           "rta_schedulable": sum(s["rm_rta_schedulable"] for s in ss) / len(ss),
           "ll_bound_ok": sum(s["ll_bound_ok"] for s in ss) / len(ss)}
    for pol in ("rm", "edf"):
        fr, jobs, miss, errs, mt, ov, nmiss = [], 0, 0, 0, 0, 0, 0
        for r in range(reps):
            runs = [s["runs"][pol][r] for s in ss]
            ok = [x for x in runs if "error" not in x]
            errs += len(runs) - len(ok)
            fr.append(sum(1 for x in ok if x["misses"]) / max(1, len(ok)))
            jobs += sum(x["jobs"] for x in ok); miss += sum(x["misses"] for x in ok)
            # How many of the set's tasks missed at least once, among runs with a miss.
            mt += sum(x["missed_tasks"] for x in ok if x["misses"]); nmiss += sum(1 for x in ok if x["misses"])
            ov += sum(1 for x in ok if x.get("overruns"))
        row[pol] = {"sets_with_miss_mean": sum(fr) / len(fr), "sets_with_miss_min": min(fr),
                    "sets_with_miss_max": max(fr), "job_miss_ratio": miss / max(1, jobs), "errors": errs,
                    "tasks_missing_per_missed_run": mt / max(1, nmiss), "runs_with_overrun": ov}
    # RM against the exact test, counted over all runs.
    a = defaultdict(int)
    for s in ss:
        for x in s["runs"]["rm"][:reps]:
            if "error" in x: continue
            a[(s["rm_rta_schedulable"], bool(x["misses"]))] += 1
    row["rm_vs_rta"] = {"sched_no_miss": a[(True, False)], "sched_missed": a[(True, True)],
                        "unsched_missed": a[(False, True)], "unsched_no_miss": a[(False, False)]}
    rows.append(row)
json.dump({"params": d["params"], "reps_aggregated": reps, "levels": rows}, sys.stdout, indent=1)
