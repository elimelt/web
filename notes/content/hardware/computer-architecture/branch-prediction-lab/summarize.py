"""Combine predsim's per-trace results into results.json and print the
note's tables.

    python3 summarize.py RESDIR > /dev/null   # writes results.json beside this file

RESDIR holds NAME.RUN.json from `predsim NAME.RUN.bin INSNS`. For each
program the three runs differ only in where ASLR loaded the code; the tables
report their mean, and results.json keeps every run.
"""

import json
import pathlib
import statistics
import sys

PROGRAMS = ["gzip", "bzip2", "xz", "sort", "grep", "python", "cc1"]
here = pathlib.Path(__file__).parent
resdir = pathlib.Path(sys.argv[1])

runs = {p: [json.loads((resdir / f"{p}.{r}.json").read_text()) for r in (1, 2, 3)] for p in PROGRAMS}


def mpki(d, name, entries):
    r = next(x for x in d["results"] if x["predictor"] == name and x["entries"] == entries)
    return 1000 * r["misses"] / d["insns"], 100 * r["misses"] / d["branches"], r["bits"]


def gmean(xs):
    return statistics.geometric_mean([max(x, 1e-9) for x in xs])


out = {"programs": {}, "configs": []}
for p, ds in runs.items():
    d = ds[0]
    out["programs"][p] = {
        "insns": d["insns"],
        "branches_per_kinsn": round(1000 * d["branches"] / d["insns"], 1),
        "taken_pct": round(100 * d["taken"] / d["branches"], 1),
        "backward_pct": round(100 * d["backward"] / d["branches"], 1),
        "backward_taken_pct": round(100 * d["backward_taken"] / max(1, d["backward"]), 1),
        "static_branches": d["static_branches"],
        "static_for_90pct": d["static_for_90pct"],
        "static_for_99pct": d["static_for_99pct"],
    }

configs = sorted({(r["predictor"], r["entries"]) for r in runs["gzip"][0]["results"]}, key=lambda c: (c[0], c[1]))
for name, entries in configs:
    row = {"predictor": name, "entries": entries, "programs": {}}
    for p, ds in runs.items():
        vals = [mpki(d, name, entries) for d in ds]
        row["bits"] = vals[0][2]
        row["programs"][p] = {
            "mpki": [round(v[0], 3) for v in vals],
            "miss_pct": [round(v[1], 3) for v in vals],
        }
    row["gmean_mpki"] = round(gmean([statistics.mean(row["programs"][p]["mpki"]) for p in PROGRAMS]), 3)
    out["configs"].append(row)

(here / "results.json").write_text(json.dumps(out, indent=1) + "\n")

print("| program | cond. branches per 1000 insns | taken | backward | backward taken | static branches | for 90% / 99% |")
for p, s in out["programs"].items():
    print(f"| {p} | {s['branches_per_kinsn']} | {s['taken_pct']}% | {s['backward_pct']}% | {s['backward_taken_pct']}% | {s['static_branches']} | {s['static_for_90pct']} / {s['static_for_99pct']} |")
print()
pick = [("always-taken", 0), ("btfnt", 0), ("onebit", 4096), ("bimodal", 4096), ("gshare", 4096), ("tournament", 1024), ("bimodal", 32768), ("gshare", 32768), ("tage", 0)]
print("| predictor | KB | " + " | ".join(PROGRAMS) + " | geo. mean |")
for name, entries in pick:
    row = next(r for r in out["configs"] if r["predictor"] == name and r["entries"] == entries)
    cells = []
    for p in PROGRAMS:
        v = row["programs"][p]["mpki"]
        cells.append(f"{statistics.mean(v):.2f}")
    print(f"| {name} {entries or ''} | {row['bits'] / 8192:.2f} | " + " | ".join(cells) + f" | {row['gmean_mpki']:.2f} |")
print()
spread = max(
    (max(r["programs"][p]["mpki"]) - min(r["programs"][p]["mpki"])) / max(statistics.mean(r["programs"][p]["mpki"]), 1e-9)
    for r in out["configs"] for p in PROGRAMS if statistics.mean(r["programs"][p]["mpki"]) > 0.5
)
print(f"largest run-to-run spread (max-min)/mean over cells with MPKI > 0.5: {100 * spread:.2f}%")
print()
print("size sweep, geometric-mean MPKI over the seven programs")
for name in ["onebit", "bimodal", "gshare", "tournament"]:
    rows = [r for r in out["configs"] if r["predictor"] == name]
    print(name, " ".join(f"{r['entries']}:{r['gmean_mpki']:.2f}({r['bits'] / 8192:.2f}KB)" for r in rows))
