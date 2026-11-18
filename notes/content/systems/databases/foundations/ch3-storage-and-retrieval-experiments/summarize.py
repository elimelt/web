#!/usr/bin/env python3
"""Summarize the harness's JSON results into the tables quoted in the note.

Usage: summarize.py RESULTS_DIR   (expects batch/, scale/ and reads/ under it)
Mean and standard deviation are over seeds (or repetitions for reads)."""
import glob, json, math, os, statistics as st, sys

root = sys.argv[1]

def load(pattern):
    out = []
    for f in sorted(glob.glob(os.path.join(root, pattern))):
        if os.path.getsize(f) == 0:
            continue  # a run still in progress
        with open(f) as fh:
            out.append(json.load(fh))
    return out

def ms(xs, fmt="{:.2f}"):
    if not xs:
        return "-"
    if len(xs) == 1:
        return fmt.format(xs[0])
    return (fmt + " ± " + fmt).format(st.mean(xs), st.stdev(xs))

def group(rows, key):
    g = {}
    for r in rows:
        g.setdefault(key(r), []).append(r)
    return dict(sorted(g.items()))

print("## Write and space amplification by database size (random order, 1000 writes per commit)\n")
print("| engine | N | load WA | update WA | space amp after update | runs | levels (files) after update |")
print("|---|---:|---:|---:|---:|---:|---|")
for (eng, n), rs in group(load("scale/*.json"), lambda r: (r["engine"], r["n"])).items():
    lv = ""
    e = rs[0]["update"]["engine"]
    if "files_per_level" in e:
        lv = " ".join(f"L{i}:{c}" for i, c in enumerate(e["files_per_level"]) if c)
    elif "page_count" in e:
        lv = f"{e['page_count']:,} pages"  # levels per tree_shape.py
    print(f"| {eng} {rs[0]['version']} | {n:,} | {ms([r['load']['write_amp'] for r in rs])} | "
          f"{ms([r['update']['write_amp'] for r in rs])} | {ms([r['update']['space_amp'] for r in rs], '{:.3f}')} | {len(rs)} | {lv} |")

print("\n## Update write amplification by writes per commit (N = 1,000,000, 200,000 updates)\n")
# SQLite's predicted update write amplification. Each commit of B random writes
# logs one 4120-byte WAL frame (24-byte header + 4096-byte page) per distinct
# leaf it dirties; a checkpoint runs after the commit that brings the WAL to
# 1000 frames and writes each distinct page among them once. LEAVES is the leaf
# count of the 1M-record table (tree_shape.py); updates leave it unchanged.
LEAVES, FRAME, PAGE, REC = 33012, 4120, 4096, 116

def sqlite_model(b):
    dirtied = LEAVES * (1 - math.exp(-b / LEAVES))
    k = math.ceil(1000 / dirtied)  # commits per checkpoint
    ckpt = LEAVES * (1 - math.exp(-k * b / LEAVES))
    return (k * dirtied * FRAME + ckpt * PAGE) / (k * b * REC)

print("| engine | writes per commit | update WA (wchar) | update WA (write_bytes) | model | runs |")
print("|---|---:|---:|---:|---:|---:|")
for (eng, b), rs in group(load("batch/*.json"), lambda r: (r["engine"], r["batch"])).items():
    model = f"{sqlite_model(b):.2f}" if eng == "sqlite" else "-"
    print(f"| {eng} | {b:,} | {ms([r['update']['write_amp'] for r in rs])} | "
          f"{ms([r['update']['dev_write_amp'] for r in rs])} | {model} | {len(rs)} |")

rows = load("reads/*.json")
if rows:
    print("\n## Point reads (reopened database, 32 MiB cache, page cache warm)\n")
    print("| engine | N | keys | bytes read per get | blocks per get | mean µs | p50 µs | p99 µs | runs |")
    print("|---|---:|---|---:|---:|---:|---:|---:|---:|")
    for (eng, n, cold), rs in group(rows, lambda r: (r["engine"], r["n"], r.get("cold", 0))).items():
        for ph in ("get_present", "get_absent"):
            p = [r[ph] for r in rs]
            tag = ("present" if ph == "get_present" else "absent") + (" (cold)" if cold else "")
            print(f"| {eng} | {n:,} | {tag} | {ms([x['rchar_per_get'] for x in p], '{:.0f}')} | "
                  f"{ms([x['blocks_per_get'] for x in p], '{:.3f}')} | {ms([x['lat']['mean_ns'] / 1e3 for x in p], '{:.2f}')} | "
                  f"{ms([x['lat']['p50_ns'] / 1e3 for x in p], '{:.2f}')} | {ms([x['lat']['p99_ns'] / 1e3 for x in p], '{:.1f}')} | {len(rs)} |")

rows = load("seq/*.json")
if rows:
    print("\n## Ascending-order load (1000 writes per commit)\n")
    print("| engine | N | load WA | space amp |")
    print("|---|---:|---:|---:|")
    for r in rows:
        print(f"| {r['engine']} | {r['n']:,} | {r['load']['write_amp']:.2f} | {r['load']['space_amp']:.3f} |")
