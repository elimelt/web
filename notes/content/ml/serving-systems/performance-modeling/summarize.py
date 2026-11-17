"""Summarize the raw benchmark output in results/*.jsonl into roofline-summary.json,
which the roofline figure in performance-modeling.mdx draws from.

    python3 summarize.py
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
LEVELS = {32768: "L1", 1048576: "L2", 67108864: "L3", 2147483648: "DRAM"}  # per-thread L1/L2 sizes are scaled by threads


def rows(name):
    return [json.loads(l) for l in (HERE / "results" / name).read_text().splitlines() if l.strip()]


def level(bytes_, threads):
    for size, name in LEVELS.items():
        if bytes_ in (size, size * threads):
            return name
    raise ValueError(bytes_)


def pt(r, **extra):
    return dict(extra, intensity=r["intensity"], median=r["gflops_median"], min=r["gflops_min"], max=r["gflops_max"])


out = {"threads": {}}
for t in (4, 1):
    peaks = {r["isa"]: dict(median=r["gflops_median"], min=r["gflops_min"], max=r["gflops_max"])
             for r in rows("peak.jsonl") if r["threads"] == t}
    sweep = {}
    for r in rows("sweep.jsonl"):
        if r["threads"] == t:
            sweep.setdefault(level(r["bytes"], t), []).append(pt(r, fma=r["fma_per_elem"]))
    # A level's bandwidth ceiling is the highest median rate the sweep reached in it (bytes read + written).
    bw = {lv: round(max(p["median"] / p["intensity"] for p in pts), 2) for lv, pts in sweep.items()}
    read = {level(r["bytes"], t): r["gbs_median"] for r in rows("read.jsonl") if r["threads"] == t}
    gemm = {
        "openblas": [pt(r, M=r["M"]) for r in rows("gemm.jsonl") if r["threads"] == t and r["K"] == 16384],
        "skinny": [pt(r, M=r["M"]) for r in rows("skinny.jsonl") if r["threads"] == t and r["K"] == 16384],
        "openblas_l3": [pt(r, M=r["M"]) for r in rows("gemm.jsonl") if r["threads"] == t and r["K"] == 4096],
        "skinny_l3": [pt(r, M=r["M"]) for r in rows("skinny.jsonl") if r["threads"] == t and r["K"] == 4096],
    }
    out["threads"][str(t)] = dict(peaks=peaks, bandwidth=bw, read=read, sweep=sweep, gemm=gemm)

(HERE / "roofline-summary.json").write_text(json.dumps(out, indent=1) + "\n")
s = out["threads"]["4"]
print("4 threads peaks", {k: v["median"] for k, v in s["peaks"].items()})
print("4 threads bw", s["bandwidth"], "read", s["read"])
print("1 thread bw", out["threads"]["1"]["bandwidth"], "read", out["threads"]["1"]["read"])
