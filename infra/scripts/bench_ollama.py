#!/usr/bin/env python3
"""Benchmark TTFT and tok/sec for all models on an Ollama server.

Usage: python3 bench_ollama.py [host] [runs]
  host: Ollama base URL (default http://localhost:11434)
  runs: measured runs per model after 1 warm-up (default 3)

Stdlib only. Streams /api/chat to measure wall-clock TTFT; decode tok/s
comes from Ollama's own eval_count/eval_duration stats.
"""
import json
import statistics
import sys
import time
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:11434"
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 3
PROMPT = "Explain what a hash table is in about one paragraph."
NUM_PREDICT = 100


def list_models():
    with urllib.request.urlopen(f"{HOST}/api/tags", timeout=30) as r:
        return [m["name"] for m in json.load(r)["models"]]


def bench_once(model, think=None):
    """One streamed request.

    Returns dict with:
      first_tok_s:     time to first streamed token (thinking or content)
      first_content_s: time to first content token (None if none arrived)
      think_tokens:    approx thinking tokens emitted (chunk count)
      decode_tok_s, prompt_tok_s, eval_count: from Ollama's stats
    """
    # Thinking modes need a larger budget so content tokens actually arrive
    budget = NUM_PREDICT if not think else 600
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": PROMPT}],
        "stream": True,
        "options": {"num_predict": budget, "temperature": 0},
    }
    if think is not None:
        payload["think"] = think
    req = urllib.request.Request(
        f"{HOST}/api/chat", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    start = time.perf_counter()
    first_tok = first_content = None
    think_tokens = 0
    final = None
    with urllib.request.urlopen(req, timeout=1800) as r:
        for line in r:
            chunk = json.loads(line)
            msg = chunk.get("message", {})
            if msg.get("thinking"):
                think_tokens += 1
                if first_tok is None:
                    first_tok = time.perf_counter() - start
            if msg.get("content"):
                now = time.perf_counter() - start
                if first_tok is None:
                    first_tok = now
                if first_content is None:
                    first_content = now
            if chunk.get("done"):
                final = chunk
    return {
        "first_tok_s": first_tok,
        "first_content_s": first_content,
        "think_tokens": think_tokens,
        "decode_tok_s": final["eval_count"] / (final["eval_duration"] / 1e9),
        "prompt_tok_s": final["prompt_eval_count"]
                        / max(final["prompt_eval_duration"] / 1e9, 1e-9),
        "eval_count": final["eval_count"],
    }


def fmt_ms(seconds):
    return f"{seconds*1000:.0f}ms" if seconds is not None else "n/a"


def bench_model(model, think=None):
    label = f"{model}" + (f" (think={think})" if think is not None else "")
    print(f"\n=== {label} ===")
    # Warm-up: loads model into memory (cold first-token reported separately)
    try:
        cold = bench_once(model, think)
    except Exception as e:
        print(f"  FAILED to load/run: {e}")
        return None
    print(f"  cold first token (incl. model load): {fmt_ms(cold['first_tok_s'])}")

    runs = []
    for i in range(RUNS):
        r = bench_once(model, think)
        runs.append(r)
        extra = (f"  thinking={r['think_tokens']} tok" if r["think_tokens"] else "")
        print(f"  run {i+1}: first_tok={fmt_ms(r['first_tok_s'])}  "
              f"first_content={fmt_ms(r['first_content_s'])}  "
              f"decode={r['decode_tok_s']:.1f} tok/s  "
              f"prompt={r['prompt_tok_s']:.1f} tok/s  "
              f"({r['eval_count']} tokens){extra}")

    def med(key):
        vals = [r[key] for r in runs if r[key] is not None]
        return statistics.median(vals) if vals else None

    return {
        "label": label,
        "cold_first_tok_s": cold["first_tok_s"],
        "first_tok_ms": med("first_tok_s") * 1000 if med("first_tok_s") else None,
        "first_content_ms": (med("first_content_s") * 1000
                             if med("first_content_s") else None),
        "decode_tok_s": med("decode_tok_s"),
        "prompt_tok_s": med("prompt_tok_s"),
    }


# Thinking-capable models get benchmarked in both modes; gpt-oss cannot
# fully disable thinking, only lower effort.
THINK_MODES = {
    "gemma4": [False, True],
    "gpt-oss": ["low", "high"],
}


def think_modes_for(model):
    for prefix, modes in THINK_MODES.items():
        if model.startswith(prefix):
            return modes
    return [None]


def main():
    models = list_models()
    print(f"Ollama @ {HOST} | models: {', '.join(models)} | {RUNS} runs each")
    results = [r for m in models for t in think_modes_for(m)
               if (r := bench_model(m, t))]

    def cell(val, fmt):
        return format(val, fmt) if val is not None else "   n/a"

    print(f"\n{'Model':<28} {'Cold 1st tok':>12} {'1st tok':>9} "
          f"{'1st content':>12} {'Decode':>10} {'Prompt':>10}")
    print("-" * 86)
    for r in results:
        print(f"{r['label']:<28} {cell(r['cold_first_tok_s'], '>11.2f')}s "
              f"{cell(r['first_tok_ms'], '>7.0f')}ms "
              f"{cell(r['first_content_ms'], '>10.0f')}ms "
              f"{cell(r['decode_tok_s'], '>6.1f')} t/s "
              f"{cell(r['prompt_tok_s'], '>6.1f')} t/s")


if __name__ == "__main__":
    main()
