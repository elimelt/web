#!/usr/bin/env python3
"""Summarize prefetch_bench-results.txt into tables and prefetch_bench-summary.json.

For every page size and configuration, prints the median, minimum and maximum
over all runs (4 processes x 3 blocks by default), and the per-process medians
for the baselines. Standard library only.

    python3 analyze_prefetch_bench.py [results.txt]

With no argument it reads prefetch_bench-results.txt and also writes
prefetch_bench-summary.json, which the figure's tests compare against. With a
file argument (for example the first pass) it only prints.
"""

import json
import os
import statistics
import sys
from collections import defaultdict

here = os.path.dirname(os.path.abspath(__file__))
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "prefetch_bench-results.txt")

meta = {}
samples = defaultdict(list)  # (pages, config) -> [ns]
per_proc = defaultdict(list)  # (pages, config, process) -> [ns]
pages = process = None
with open(path) as f:
    for line in f:
        line = line.strip()
        if line.startswith("process="):
            parts = dict(kv.split("=") for kv in line.split())
            process, pages = parts["process"], parts["pages"]
        elif "=" in line and "," not in line and not line.startswith(("array_mib", "loadavg", "top_process", "checksum")):
            k, v = line.split("=", 1)
            meta.setdefault(k, v)
        elif line and line[0].isdigit() and line.count(",") == 3:
            _, config, _, ns = line.split(",")
            samples[(pages, config)].append(float(ns))
            per_proc[(pages, config, process)].append(float(ns))


def stat(xs):
    return {"median": round(statistics.median(xs), 3), "min": round(min(xs), 3), "max": round(max(xs), 3), "n": len(xs)}


summary = {"meta": meta, "pages": {}}
for (pg, config), xs in sorted(samples.items()):
    summary["pages"].setdefault(pg, {})[config] = stat(xs)

DISTANCES = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 4096]
WORKS = [0, 4, 16, 64]
SEQ = [0, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]


def fmt(s):
    if s is None:
        return "n/a"
    return f"{s['median']:.2f} ({s['min']:.2f}-{s['max']:.2f})"


for pg in ("2m", "4k"):
    table = summary["pages"].get(pg)
    if not table:
        continue
    print(f"\n== {pg} pages: gather, ns per element, median (min-max) ==")
    print("D".rjust(6) + "".join(f"W={w}".rjust(24) for w in WORKS))
    for d in DISTANCES:
        print(str(d).rjust(6) + "".join(fmt(table.get(f"g:{w}:{d}:3")).rjust(24) for w in WORKS))
    print("hot".rjust(6) + "".join(fmt(table.get(f"hot:{w}")).rjust(24) for w in WORKS))
    print("\nspeedup of the best distance over no prefetch (medians):")
    for w in WORKS:
        base = table.get(f"g:{w}:0:3")["median"]
        best_d = min(DISTANCES[1:], key=lambda d: table.get(f"g:{w}:{d}:3")["median"])
        best = table.get(f"g:{w}:{best_d}:3")["median"]
        hot = table.get(f"hot:{w}")["median"]
        print(f"  W={w}: {base:.2f} -> {best:.2f} ns at D={best_d} ({base / best:.2f}x); hot {hot:.2f} ns")
    print("\nW=0 gather by hint (locality 0 = nta, 1 = t2, 2 = t1, 3 = t0):")
    print("D".rjust(6) + "".join(f"h{h}".rjust(24) for h in (0, 1, 2, 3)))
    for d in [4, 8, 16, 32, 64, 128, 256, 512, 1024]:
        print(str(d).rjust(6) + "".join(fmt(table.get(f"g:0:{d}:{h}")).rjust(24) for h in (0, 1, 2, 3)))
    print("\nhints at D=64:")
    for w in (16, 64):
        print(f"  W={w}: " + "  ".join(f"h{h} {fmt(table.get(f'g:{w}:64:{h}'))}" for h in (0, 1, 2, 3)))
    print("\nsequential sum over 1 GiB, ns per element: t0 | t1 | nta")
    for b in SEQ:
        if b == 0:
            print(f"  {'hw only':>8}: {fmt(table.get('s:0:3'))}")
        else:
            print(f"  {b:>8}: {fmt(table.get(f's:{b}:3'))} | {fmt(table.get(f's:{b}:2'))} | {fmt(table.get(f's:{b}:0'))}")
    for cfg in ("g:0:0:3", "g:64:0:3", "s:0:3"):
        meds = [round(statistics.median(v), 2) for (p2, c, _), v in sorted(per_proc.items()) if p2 == pg and c == cfg]
        print(f"  per-process medians {cfg}: {meds}")

if len(sys.argv) > 1:
    sys.exit(0)  # only the default results file writes the summary the figure uses
out = os.path.join(here, "prefetch_bench-summary.json")
with open(out, "w") as f:
    json.dump(summary, f, indent=1, sort_keys=True)
    f.write("\n")
print(f"\nwrote {out}")
