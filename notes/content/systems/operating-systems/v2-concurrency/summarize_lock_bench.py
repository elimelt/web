#!/usr/bin/env python3
"""Summarizes lock_bench-results.csv into lock_bench-summary.json for the
note's charts: per lock and thread count, the median, minimum and maximum
throughput over the repetitions, the slowest thread's share of a fair split,
and for the racy counter the fraction of increments lost.

Usage: python3 summarize_lock_bench.py lock_bench-results.csv > lock_bench-summary.json
"""
import csv
import json
import statistics
import sys


def main(path):
    rows = [r for r in csv.DictReader(line for line in open(path) if not line.startswith("#"))]
    out = {}
    for r in rows:
        lock, t = r["lock"], int(r["threads"])
        total = int(r["total_ops"])
        e = out.setdefault(lock, {}).setdefault(t, {"ops": [], "share": [], "lost": []})
        e["ops"].append(float(r["ops_per_sec"]))
        e["share"].append(int(r["min_thread_ops"]) / (total / t))
        e["lost"].append(1 - int(r["final_counter"]) / total)
    summary = {}
    for lock, by_t in out.items():
        summary[lock] = []
        for t in sorted(by_t):
            e = by_t[t]
            summary[lock].append({
                "threads": t,
                "runs": len(e["ops"]),
                "median": round(statistics.median(e["ops"])),
                "min": round(min(e["ops"])),
                "max": round(max(e["ops"])),
                "share": round(statistics.median(e["share"]), 4),
                "lost": round(statistics.median(e["lost"]), 4),
            })
    json.dump(summary, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
