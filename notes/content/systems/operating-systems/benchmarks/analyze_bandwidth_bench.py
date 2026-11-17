#!/usr/bin/env python3
"""Summarize bandwidth_bench.c output.

Usage: analyze_bandwidth_bench.py OUT.json RUN.jsonl [RUN.jsonl ...]

  python3 analyze_bandwidth_bench.py bandwidth_bench-summary.json bandwidth_bench-results.jsonl

For every (kernel, threads, working-set size) cell, each process reports the
median of its 7 samples. This script takes the median of those per-process
medians, with their minimum and maximum, prints the tables the note quotes and
writes OUT.json, which the figure's test compares against the points it draws.
Standard library only.
"""

import json
import statistics
import sys
from collections import defaultdict

KERNELS = ["read", "copy", "triad", "copy-nt", "triad-nt"]
# Bytes moved per element per array, counted as STREAM counts them, and as the
# memory bus moves them when a normal store first reads its line
# (write-allocate). The -nt kernels bypass that read.
BUS_FACTOR = {"read": 1.0, "copy": 1.5, "triad": 4 / 3, "copy-nt": 1.0, "triad-nt": 1.0}
KiB, MiB, GiB = 1 << 10, 1 << 20, 1 << 30
DRAM_MIN = 1 * GiB  # at least 4 times the 260 MB L3, STREAM's rule for each array


def level(threads, ws):
    """The cache level a working set sits in, or None in a transition.

    L1 and L2 are private (48 KiB and 2 MiB per core), so with t threads the
    team holds t times as much; L3 (260 MiB) is shared. The bounds keep well
    inside each level so the plateau excludes the cliffs between them.
    """
    if ws <= threads * 32 * KiB:
        return "L1"
    if threads * 128 * KiB <= ws <= threads * 1 * MiB:
        return "L2"
    if threads * 4 * MiB <= ws <= 130 * MiB:
        return "L3"
    if ws >= DRAM_MIN:
        return "DRAM"
    return None


def load(paths):
    cells = defaultdict(list)
    for path in paths:
        with open(path) as f:
            for line in f:
                r = json.loads(line)
                r["median_gbs"] = statistics.median(r["samples_gbs"])
                cells[(r["kernel"], r["threads"], r["ws_bytes"])].append(r)
    return cells


def summarize(cells):
    out = []
    for (kernel, threads, ws), rows in sorted(cells.items(), key=lambda kv: (KERNELS.index(kv[0][0]), kv[0][1], kv[0][2])):
        meds = [r["median_gbs"] for r in rows]
        out.append({
            "kernel": kernel,
            "threads": threads,
            "ws_bytes": ws,
            "median_gbs": round(statistics.median(meds), 2),
            "min_gbs": round(min(meds), 2),
            "max_gbs": round(max(meds), 2),
            "runs": len(meds),
        })
    return out


def nominal(ws):
    """The sweep's nominal size (a power of two or 1.5 times one) for a cell
    whose array length was rounded down to a whole number of lines per thread."""
    best = None
    p = 1 << 14
    while p <= 1 << 32:
        for cand in (p, p * 3 // 2):
            if best is None or abs(cand - ws) < abs(best - ws):
                best = cand
        p *= 2
    return best


def dram(summary, kernel, threads):
    """The cells of one kernel and thread count whose working set is in DRAM."""
    return [c for c in summary if c["kernel"] == kernel and c["threads"] == threads and c["nominal_bytes"] >= DRAM_MIN]


def plateaus(summary):
    """Median of the per-size medians within each cache level."""
    out = {}
    for k in KERNELS:
        for t in range(1, 5):
            for lv in ("L1", "L2", "L3", "DRAM"):
                meds = [c["median_gbs"] for c in summary if c["kernel"] == k and c["threads"] == t and level(t, c["nominal_bytes"]) == lv]
                if meds:
                    out[f"{k}/{t}/{lv}"] = {"median_gbs": round(statistics.median(meds), 2), "sizes": len(meds)}
    return out


def fmt_size(b):
    for unit, s in (("GiB", 1 << 30), ("MiB", 1 << 20), ("KiB", 1 << 10)):
        if b >= s:
            v = b / s
            return f"{v:.3g} {unit}"
    return f"{b} B"


def main():
    out_path, paths = sys.argv[1], sys.argv[2:]
    cells = load(paths)
    summary = summarize(cells)
    for c in summary:
        c["nominal_bytes"] = nominal(c["ws_bytes"])

    print("DRAM-resident (working set >= 1 GiB): median GB/s of per-process medians (min-max)")
    print("kernel     " + "".join(f"{t:>22}" for t in range(1, 5)))
    dram_table = {}
    for k in KERNELS:
        row = []
        for t in range(1, 5):
            vals = dram(summary, k, t)
            if not vals:
                row.append(f"{'-':>22}")
                continue
            # Pool every process median at the three sizes.
            pooled = []
            for c in vals:
                pooled += [r["median_gbs"] for r in cells[(k, t, c["ws_bytes"])]]
            med = statistics.median(pooled)
            dram_table[f"{k}/{t}"] = {"median_gbs": round(med, 2), "min_gbs": round(min(pooled), 2), "max_gbs": round(max(pooled), 2), "n": len(pooled), "bus_gbs": round(med * BUS_FACTOR[k], 2)}
            row.append(f"{med:7.1f} ({min(pooled):5.1f}-{max(pooled):5.1f})")
        print(f"{k:<11}" + "".join(f"{x:>22}" for x in row))

    print("\nBus traffic including write-allocate reads, DRAM-resident, GB/s")
    for k in KERNELS:
        print(f"{k:<11}" + "".join(f"{dram_table[f'{k}/{t}']['bus_gbs']:>10.1f}" for t in range(1, 5)))

    plat = plateaus(summary)
    print("\nPlateaus: median of per-size medians inside each level, GB/s (threads 1-4)")
    for k in KERNELS:
        for lv in ("L1", "L2", "L3", "DRAM"):
            print(f"{k:<9}{lv:<5}" + "".join(f"{plat[f'{k}/{t}/{lv}']['median_gbs']:>9.1f}" if f"{k}/{t}/{lv}" in plat else f"{'-':>9}" for t in range(1, 5)))

    print("\nPer-size medians, GB/s (rows: size; columns: threads 1-4)")
    for k in KERNELS:
        print(f"\n{k}")
        sizes = sorted({c["nominal_bytes"] for c in summary if c["kernel"] == k})
        for s in sizes:
            vals = []
            for t in range(1, 5):
                m = [c["median_gbs"] for c in summary if c["kernel"] == k and c["threads"] == t and c["nominal_bytes"] == s]
                vals.append(f"{m[0]:8.1f}" if m else f"{'-':>8}")
            print(f"{fmt_size(s):>10}" + "".join(vals))

    with open(out_path, "w") as f:
        json.dump({"bus_factor": BUS_FACTOR, "dram": dram_table, "plateaus": plat, "cells": summary}, f, indent=None, separators=(",", ":"))
        f.write("\n")


if __name__ == "__main__":
    main()
