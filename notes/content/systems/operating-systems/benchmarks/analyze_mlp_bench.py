"""Summarize mlp_bench-results.txt. Requires only the Python standard library.

Run beside the note: python3 analyze_mlp_bench.py
Prints a Markdown table per page size and writes mlp_bench-summary.json, which
the MlpTimeline figure's test compares with the numbers the figure overlays.

For k chains the program reports t_k, elapsed ns per completed access. With one
chain every access is a full miss, so L = t_1 is the unloaded latency. Achieved
concurrency is L / t_k, the number of misses that would have to overlap at the
unloaded latency to give t_k (Little's law: outstanding = throughput x latency).
While k is below the fill-buffer count each chain has exactly one miss in
flight, so the loaded latency per miss is k * t_k.
"""

import json
import math
from pathlib import Path
from statistics import median

HERE = Path(__file__).resolve().parent
text = (HERE / "mlp_bench-results.txt").read_text()

samples: dict[str, dict[int, list[float]]] = {"2m": {}, "4k": {}}
by_process: dict[tuple[int, str], dict[int, list[float]]] = {}
loads: list[str] = []
pages = None
process = 0
for line in text.splitlines():
    if line.startswith("process="):
        process = int(line.split()[0].split("=")[1])
    elif line.startswith("pages="):
        pages = line.split("=", 1)[1]
    elif line.startswith("loadavg"):
        loads.append(line)
    elif pages and line[:1].isdigit() and line.count(",") == 3:
        _, config, _, ns = line.split(",")
        samples[pages].setdefault(int(config), []).append(float(ns))
        by_process.setdefault((process, pages), {}).setdefault(int(config), []).append(float(ns))


def fit_cap(points: dict[int, float], latency: float) -> tuple[float, float]:
    """Least squares in log time for t_k = latency / min(k, C); grid over C."""
    best = (math.inf, 0.0)
    for step in range(100, 3201):
        c = step / 100
        err = sum((math.log(t) - math.log(latency / min(k, c))) ** 2 for k, t in points.items())
        best = min(best, (err, c))
    rms = math.sqrt(best[0] / len(points))
    return best[1], rms


summary = {}
for mode in ("2m", "4k"):
    data = samples[mode]
    if not data:
        continue
    med = {k: median(v) for k, v in data.items()}
    latency = med[1]
    chains = {k: med[k] for k in sorted(data) if k > 0}
    cap, rms = fit_cap(chains, latency)
    plateau = [latency / med[k] for k in chains if k >= 18]
    plateau_t = median(med[k] for k in chains if k >= 18)
    # Per-miss latency with 2 to 8 chains, where every chain holds one buffer.
    light = median(k * med[k] for k in chains if 2 <= k <= 8)
    rows = []
    print(f"\n### {mode} pages: unloaded latency {latency:.1f} ns, fitted cap C = {cap:.2f} (rms log error {rms:.3f})")
    print("| config | n | median ns | min | max | concurrency L/t | k*t (ns) |")
    print("|---|---|---|---|---|---|---|")
    for k in sorted(data):
        v = data[k]
        name = "independent" if k == 0 else str(k)
        conc = latency / med[k]
        loaded = k * med[k] if k else None
        print(f"| {name} | {len(v)} | {med[k]:.1f} | {min(v):.1f} | {max(v):.1f} | {conc:.2f} | {'' if loaded is None else f'{loaded:.0f}'} |")
        rows.append({
            "chains": k,
            "n": len(v),
            "median": round(med[k], 3),
            "min": round(min(v), 3),
            "max": round(max(v), 3),
            "concurrency": round(conc, 3),
        })
    summary[mode] = {
        "latency_ns": round(latency, 3),
        "fitted_cap": cap,
        "fit_rms_log_error": round(rms, 4),
        "plateau_concurrency_k18_to_32": [round(min(plateau), 2), round(max(plateau), 2)],
        "plateau_ns": round(plateau_t, 3),
        "light_load_latency_ns": round(light, 3),
        "rows": rows,
    }
    print(f"plateau concurrency (k >= 18): {min(plateau):.2f} to {max(plateau):.2f}")
    print(f"plateau time per access (median over k >= 18): {plateau_t:.2f} ns")
    print(f"per-miss latency at 2-8 chains (median k*t): {light:.1f} ns -> concurrency at plateau {light / plateau_t:.2f}")

print("\n### Per process: median of 1 chain, 16 chains and the independent loop (ns)")
per_process = []
for (proc, mode), d in sorted(by_process.items()):
    row = {"process": proc, "pages": mode, "chain1": round(median(d[1]), 1), "chain16": round(median(d[16]), 2), "independent": round(median(d[0]), 2)}
    per_process.append(row)
    print(f"process {proc} {mode}: {row['chain1']}  {row['chain16']}  {row['independent']}")
summary["per_process"] = per_process

print("\n" + "\n".join(loads))
(HERE / "mlp_bench-summary.json").write_text(json.dumps(summary, indent=1) + "\n")
