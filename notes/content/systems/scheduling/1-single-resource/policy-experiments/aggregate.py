"""Collects run_trace.py's JSON files into summary.json (the note's tables and
the slowdown figure read it) and prints the tables.

Run: python3 aggregate.py results_dir
"""
import glob
import json
import os
import statistics
import sys

ORDER = ["fifo", "sjf", "srpt", "ps", "fb", "mlfq", "mlfq16", "mlfq_boost1s",
         "srpt_est1", "srpt_bounce1"]


def spread(xs):
    return {"mean": statistics.fmean(xs), "min": min(xs), "max": max(xs),
            "sd": statistics.stdev(xs) if len(xs) > 1 else 0.0}


def main():
    runs = [json.load(open(p)) for p in glob.glob(os.path.join(sys.argv[1], "*.json"))]
    out = {"poisson": {}, "replay": {}}
    for mode in out:
        for rho in sorted({r["rho"] for r in runs if r["mode"] == mode}):
            key = f"{rho}"
            out[mode][key] = {}
            for pol in ORDER:
                rs = [r for r in runs if r["mode"] == mode and r["rho"] == rho and r["policy"] == pol]
                if not rs:
                    continue
                nb = len(rs[0]["buckets"])
                out[mode][key][pol] = {
                    "seeds": len(rs),
                    **{m: spread([r[m] for r in rs]) for m in
                       ["mean_response", "p99_response", "max_response", "mean_slowdown",
                        "median_slowdown", "p99_slowdown", "frac_slowdown_above_ps_mean",
                        "largest_jobs_mean_slowdown"]},
                    "buckets": [{
                        "pct": rs[0]["buckets"][b]["pct"],
                        "size_range": rs[0]["buckets"][b]["size_range"],
                        "mean_slowdown": spread([r["buckets"][b]["mean_slowdown"] for r in rs]),
                        "mean_response": spread([r["buckets"][b]["mean_response"] for r in rs]),
                    } for b in range(nb)],
                }
    json.dump(out, open("summary.json", "w"), indent=1)
    # The slowdown figure's data: per-bucket mean slowdown (mean, min and max
    # over seeds) under Poisson arrivals, to 3 significant figures.
    g = lambda x: float(f"{x:.3g}")
    first = next(iter(next(iter(out["poisson"].values())).values()))
    fig = {
        "buckets": [{"pct": b["pct"], "size": [g(v) for v in b["size_range"]]} for b in first["buckets"]],
        "loads": {
            rho: {pol: [[g(b["mean_slowdown"][k]) for k in ("mean", "min", "max")] for b in v["buckets"]]
                  for pol, v in pols.items()}
            for rho, pols in out["poisson"].items()
        },
    }
    json.dump(fig, open("slowdown_by_size.json", "w"), separators=(",", ":"))
    for mode in out:
        for rho, pols in out[mode].items():
            print(f"\n== {mode} rho={rho}")
            print(f"{'policy':14} {'meanT':>16} {'p99T':>10} {'meanSD':>12} {'medSD':>7} {'p99SD':>9} {'>PS':>6} {'top0.1%SD':>10}")
            for pol, v in pols.items():
                print(f"{pol:14} {v['mean_response']['mean']:8.2f}±{v['mean_response']['sd']:<6.2f} "
                      f"{v['p99_response']['mean']:10.1f} {v['mean_slowdown']['mean']:12.2f} "
                      f"{v['median_slowdown']['mean']:7.2f} {v['p99_slowdown']['mean']:9.1f} "
                      f"{v['frac_slowdown_above_ps_mean']['mean']*100:5.2f}% {v['largest_jobs_mean_slowdown']['mean']:10.2f}")
            print("bucket slowdowns (mean over seeds):")
            pcts = [f"{b['pct'][0]}-{b['pct'][1]}" for b in next(iter(pols.values()))["buckets"]]
            print(f"{'':14}" + "".join(f"{p:>9}" for p in pcts))
            for pol, v in pols.items():
                print(f"{pol:14}" + "".join(f"{b['mean_slowdown']['mean']:9.3g}" for b in v["buckets"]))


if __name__ == "__main__":
    main()
