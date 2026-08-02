#!/usr/bin/env python3
"""Concurrency sweep benchmark for Ollama.

Fires N simultaneous streaming /api/chat requests and measures aggregate
throughput, per-request TTFT (includes queue wait), and errors.

Usage: python3 bench_ollama_concurrency.py [host] [model] [levels]
  host:   Ollama base URL (default http://localhost:11434)
  model:  model name (default llama3.2:3b)
  levels: comma-separated concurrency levels (default 1,2,4,8)
"""
import json
import statistics
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HOST = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:11434"
MODEL = sys.argv[2] if len(sys.argv) > 2 else "llama3.2:3b"
LEVELS = [int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else "1,2,4,8").split(",")]
PROMPT = "Explain what a hash table is in about one paragraph."
NUM_PREDICT = 100


def one_request(i):
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": f"(req {i}) {PROMPT}"}],
        "stream": True,
        "options": {"num_predict": NUM_PREDICT, "temperature": 0},
    }).encode()
    req = urllib.request.Request(
        f"{HOST}/api/chat", data=body, headers={"Content-Type": "application/json"}
    )
    start = time.perf_counter()
    ttft = None
    tokens = 0
    try:
        with urllib.request.urlopen(req, timeout=1800) as r:
            for line in r:
                chunk = json.loads(line)
                if ttft is None and chunk.get("message", {}).get("content"):
                    ttft = time.perf_counter() - start
                if chunk.get("done"):
                    tokens = chunk["eval_count"]
        return {"ok": True, "ttft": ttft, "tokens": tokens,
                "total": time.perf_counter() - start}
    except Exception as e:
        return {"ok": False, "error": str(e), "total": time.perf_counter() - start}


def run_level(n):
    wall_start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=n) as pool:
        results = list(pool.map(one_request, range(n)))
    wall = time.perf_counter() - wall_start

    oks = [r for r in results if r["ok"]]
    errs = [r for r in results if not r["ok"]]
    total_tokens = sum(r["tokens"] for r in oks)
    agg = total_tokens / wall if wall > 0 else 0

    print(f"\n--- concurrency {n} ---")
    if oks:
        ttfts = sorted(r["ttft"] for r in oks)
        per_req = statistics.median(r["tokens"] / (r["total"] - r["ttft"]) for r in oks)
        print(f"  ok={len(oks)} err={len(errs)}  wall={wall:.1f}s  "
              f"aggregate={agg:.1f} tok/s  per-req decode={per_req:.1f} tok/s")
        print(f"  TTFT min/med/max = {ttfts[0]*1000:.0f} / "
              f"{statistics.median(ttfts)*1000:.0f} / {ttfts[-1]*1000:.0f} ms")
    else:
        print(f"  ALL {len(errs)} FAILED  wall={wall:.1f}s")
    for e in {r["error"] for r in errs}:
        cnt = sum(1 for r in errs if r["error"] == e)
        print(f"  error x{cnt}: {e}")
    return {"n": n, "ok": len(oks), "err": len(errs), "wall": wall, "agg": agg}


def main():
    print(f"Ollama @ {HOST} | model={MODEL} | levels={LEVELS}")
    one_request(0)  # warm-up / model load
    rows = [run_level(n) for n in LEVELS]
    print(f"\n{'Conc':>5} {'OK':>4} {'Err':>4} {'Wall':>8} {'Aggregate':>12}")
    print("-" * 38)
    for r in rows:
        print(f"{r['n']:>5} {r['ok']:>4} {r['err']:>4} {r['wall']:>7.1f}s "
              f"{r['agg']:>8.1f} t/s")


if __name__ == "__main__":
    main()
