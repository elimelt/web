"""Replays the Azure LLM inference traces (Patel et al., Splitwise, ISCA 2024)
through the three KV-cache allocators in kvsim.py.

Run from notes/ (about a minute on one core):

    python3 content/ml/serving-systems/memory-management/measure.py

Downloads the two one-hour traces into work/notebook-data/azure-llm-2023/
(checked against their SHA-256), and writes results.json (every number the
note quotes) and slices.json (the requests the figure replays) next to this
file.
"""

import csv
import hashlib
import json
import platform
import statistics as st
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from kvsim import simulate  # noqa: E402

HERE = Path(__file__).parent
WORK = Path("work/notebook-data/azure-llm-2023")
BASE = "https://raw.githubusercontent.com/Azure/AzurePublicDataset/master/data/"
TRACES = {
    "code": ("AzureLLMInferenceTrace_code.csv", "54e9a6d2a4bd06ba1e060304b900abbc74cbea53de96506e60fe5bb4f2277fb6"),
    "conv": ("AzureLLMInferenceTrace_conv.csv", "2f1e5b666d4e3055fdbba98598ce2ec307767b9064e03e2fa46676dbcc7d0bf8"),
}

# Llama-3-8B (meta-llama/llama-models, models/sku_list.py) in BF16.
MODEL = dict(dim=4096, n_layers=32, n_heads=32, n_kv_heads=8, vocab=128256, ffn_dim_multiplier=1.3, multiple_of=1024, max_len=8192)
KV_BUDGET_GIB = 56
WINDOW_S = 600
SLICE = 1000
BLOCKS = (8, 16, 32)
HEADROOMS = (0.05, 0.1, 0.2)


def params(m):
    head = m["dim"] // m["n_heads"]
    hidden = int(2 * 4 * m["dim"] / 3)
    hidden = int(m["ffn_dim_multiplier"] * hidden)
    hidden = m["multiple_of"] * -(-hidden // m["multiple_of"])
    attn = m["dim"] * m["dim"] * 2 + 2 * m["dim"] * m["n_kv_heads"] * head
    layer = attn + 3 * m["dim"] * hidden + 2 * m["dim"]
    return 2 * m["vocab"] * m["dim"] + m["n_layers"] * layer + m["dim"], hidden


def kv_bytes_per_token(m, dtype_bytes=2):
    return 2 * m["n_kv_heads"] * (m["dim"] // m["n_heads"]) * m["n_layers"] * dtype_bytes


def load(name):
    fname, digest = TRACES[name]
    path = WORK / fname
    if not path.exists():
        WORK.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(BASE + fname, path)
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit(f"{path}: SHA-256 mismatch")
    rows = []
    with open(path) as f:
        for r in csv.DictReader(f):
            t = datetime.strptime(r["TIMESTAMP"][:26], "%Y-%m-%d %H:%M:%S.%f")
            rows.append((t, int(r["ContextTokens"]), int(r["GeneratedTokens"])))
    return rows


def windows(rows, max_len):
    t0 = rows[0][0]
    out = []
    while True:
        lo = len(out) * WINDOW_S
        if (rows[-1][0] - t0).total_seconds() < lo + WINDOW_S:
            break
        w = [(c, g) for t, c, g in rows if lo <= (t - t0).total_seconds() < lo + WINDOW_S]
        out.append(([(c, g) for c, g in w if c + g <= max_len], sum(1 for c, g in w if c + g > max_len)))
    return out


def spread(vals):
    return {"mean": st.mean(vals), "min": min(vals), "max": max(vals), "stdev": st.stdev(vals) if len(vals) > 1 else 0.0}


def main():
    p, hidden = params(MODEL)
    kvb = kv_bytes_per_token(MODEL)
    budget = KV_BUDGET_GIB * 2**30 // kvb
    configs = [("max", {}, "max"), ("double", {}, "double")]
    configs += [("double", {"headroom": h}, f"double_h{round(h * 100)}") for h in HEADROOMS]
    configs += [("paged", {"block": b}, f"paged{b}") for b in BLOCKS]
    res = {
        "env": {"python": platform.python_version(), "machine": platform.machine(), "platform": platform.platform()},
        "model": {**MODEL, "params": p, "ffn_hidden": hidden, "kv_bytes_per_token": kvb, "weights_bytes_bf16": 2 * p},
        "budget": {"gib": KV_BUDGET_GIB, "tokens": budget, "window_s": WINDOW_S},
        "traces": {},
        "slices": {},
    }
    slices = {}
    for name in TRACES:
        rows = load(name)
        ws = windows(rows, MODEL["max_len"])
        per = {}
        for kind, kw, key in configs:
            runs = []
            t = time.perf_counter()
            for w, _ in ws:
                runs.append(simulate(w, kind, budget, max_len=MODEL["max_len"], **kw))
            per[key] = {
                "runtime_s": time.perf_counter() - t,
                "windows": runs,
                **{m: spread([r[m] for r in runs]) for m in ("used", "reserved", "internal", "external", "free", "running")},
                "preempt_per_req": spread([r["preemptions"] / len(w) for r, (w, _) in zip(runs, ws)]),
                "recompute_frac": spread([r["recomputed_tokens"] / r["generated_tokens"] for r in runs]),
                "copy_frac": spread([r["copied_tokens"] / r["generated_tokens"] for r in runs]),
            }
            print(f"{name:5} {key:8} running {per[key]['running']['mean']:7.1f} "
                  f"[{per[key]['running']['min']:.1f}, {per[key]['running']['max']:.1f}]  used {per[key]['used']['mean']:.3f}")
        lens = [c + g for w, _ in ws for c, g in w]
        res["traces"][name] = {
            "requests": len(rows),
            "windows": [{"requests": len(w), "dropped_over_max_len": d} for w, d in ws],
            "prompt_mean": st.mean(c for _, c, _ in rows),
            "output_mean": st.mean(g for _, _, g in rows),
            "output_median": st.median(g for _, _, g in rows),
            "final_len_mean_kept": st.mean(lens),
            "results": per,
        }
        sl = ws[0][0][:SLICE]
        slices[name] = sl
        res["slices"][name] = {
            key: simulate(sl, kind, budget, max_len=MODEL["max_len"], **kw) for kind, kw, key in configs if "_h" not in key
        }
    (HERE / "results.json").write_text(json.dumps(res, indent=1) + "\n")
    (HERE / "slices.json").write_text(json.dumps({"budget": budget, "max_len": MODEL["max_len"], **slices}, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
