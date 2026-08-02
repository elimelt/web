#!/usr/bin/env python3
"""Prefill latency vs prompt size benchmark for Ollama.

Sends prompts of increasing size and measures prompt processing (prefill)
latency and throughput from Ollama's prompt_eval_* stats. Each prompt gets
a unique random prefix so Ollama's prefix cache can't skip the prefill.

Usage: python3 bench_ollama_prefill.py [host] [model] [sizes] [num_thread]
  host:       Ollama base URL (default http://localhost:11434)
  model:      model name (default llama3.2:3b)
  sizes:      comma-separated approx token counts (default 128,256,512,1024,2048,4096)
  num_thread: optional thread override (default: model default)
"""
import json
import random
import string
import sys
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:11434"
MODEL = sys.argv[2] if len(sys.argv) > 2 else "llama3.2:3b"
SIZES = [int(x) for x in (sys.argv[3] if len(sys.argv) > 3
                          else "128,256,512,1024,2048,4096").split(",")]
NUM_THREAD = int(sys.argv[4]) if len(sys.argv) > 4 else None

FILLER = ("The quick brown fox jumps over the lazy dog while considering "
          "the computational complexity of various sorting algorithms. ")


def make_prompt(approx_tokens):
    """Build a prompt of roughly approx_tokens tokens (~1.3 tokens/word)."""
    prefix = "".join(random.choices(string.ascii_lowercase, k=12))
    words_needed = int(approx_tokens / 1.3)
    filler_words = FILLER.split()
    body = " ".join(filler_words[i % len(filler_words)]
                    for i in range(words_needed))
    return (f"[session {prefix}] Summarize the following text in one "
            f"sentence:\n\n{body}")


def bench(model, approx_tokens):
    options = {"num_predict": 1, "temperature": 0}
    if NUM_THREAD:
        options["num_thread"] = NUM_THREAD
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": make_prompt(approx_tokens)}],
        "stream": False,
        "options": options,
    }).encode()
    req = urllib.request.Request(
        f"{HOST}/api/chat", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=3600) as r:
        d = json.load(r)
    n = d["prompt_eval_count"]
    secs = d["prompt_eval_duration"] / 1e9
    return n, secs


def main():
    thread_note = f" num_thread={NUM_THREAD}" if NUM_THREAD else ""
    print(f"Ollama @ {HOST} | model={MODEL}{thread_note}")
    bench(MODEL, 32)  # warm-up / model load
    print(f"{'Target':>8} {'Actual tok':>11} {'Prefill':>10} {'tok/s':>9}")
    print("-" * 42)
    for size in SIZES:
        n, secs = bench(MODEL, size)
        print(f"{size:>8} {n:>11} {secs:>9.2f}s {n/secs:>9.1f}")


if __name__ == "__main__":
    main()
