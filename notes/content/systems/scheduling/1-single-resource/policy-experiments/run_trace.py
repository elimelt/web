"""Simulate each policy on job sizes from the Azure Functions 2021 trace.

Sizes are the 1,979,313 invocation durations in Zhang et al.'s trace (SOSP
2021). Durations are recorded to the millisecond; zero durations (8.6%) are
set to 0.5 ms so every job has a slowdown.

Two arrival processes:
  poisson  sizes in a random order (one per seed), Poisson arrivals at rate
           rho / E[S]: an M/G/1 queue with the trace's size distribution.
  replay   the trace's own arrival times (end minus duration), stretched so
           the average load over the two weeks is rho. Bursts and the
           correlation between neighbouring jobs are kept.

Usage:
  python3 run_trace.py --trace trace.npy --mode poisson --rho 0.9 --seed 1 \
      --policy srpt --out results/
Writes one JSON file per (mode, rho, seed, policy).
"""
import argparse
import json
import math
import os
import time

import numpy as np

import policies as P

# Size-percentile buckets for the per-size breakdown.
EDGES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 99.9, 100]

POLICIES = {
    "fifo": lambda a, s, rng: P.fifo(a, s),
    "sjf": lambda a, s, rng: P.sjf(a, s),
    "srpt": lambda a, s, rng: P.srpt(a, s),
    "ps": lambda a, s, rng: P.ps(a, s),
    "fb": lambda a, s, rng: P.fb(a, s),
    # OSTEP-style MLFQ: 8 levels, 10 ms at the top doubling to 1.28 s.
    "mlfq": lambda a, s, rng: P.mlfq(a, s, 0.010, 8),
    "mlfq_boost1s": lambda a, s, rng: P.mlfq(a, s, 0.010, 8, boost=1.0),
    # 16 levels: the bottom quantum is 328 s, so long jobs are told apart.
    "mlfq16": lambda a, s, rng: P.mlfq(a, s, 0.010, 16),
    # SRPT on estimates off by a log-normal factor (sigma 1: half the
    # estimates are off by more than 2x).
    "srpt_est1": lambda a, s, rng: P.srpt_estimates(
        a, s, list(np.asarray(s) * np.exp(rng.normal(0, 1.0, len(s))))),
    # The same estimates (same generator seed) under SRPT-Bounce.
    "srpt_bounce1": lambda a, s, rng: P.srpt_bounce(
        a, s, list(np.asarray(s) * np.exp(rng.normal(0, 1.0, len(s))))),
}


def load_sizes(path):
    tr = np.load(path)
    arr, dur = tr[:, 0], np.maximum(tr[:, 1], 0.0005)
    order = np.argsort(arr, kind="stable")
    return arr[order], dur[order]


def summarize(arr, size, done, rho):
    arr = np.asarray(arr)
    size = np.asarray(size)
    T = np.asarray(done) - arr
    sd = T / size
    cuts = np.percentile(size, EDGES)
    # Bucket by rank so ties at the millisecond floor split evenly.
    rank = np.empty(len(size))
    rank[np.argsort(size, kind="stable")] = np.arange(len(size)) / len(size) * 100
    buckets = []
    for lo, hi in zip(EDGES[:-1], EDGES[1:]):
        m = (rank >= lo) & (rank < hi)
        buckets.append({
            "pct": [lo, hi],
            "size_range": [float(size[m].min()), float(size[m].max())],
            "n": int(m.sum()),
            "mean_response": float(T[m].mean()),
            "mean_slowdown": float(sd[m].mean()),
        })
    big = size >= np.percentile(size, 99.9)
    return {
        "jobs": int(len(T)),
        "mean_response": float(T.mean()),
        "p99_response": float(np.percentile(T, 99)),
        "max_response": float(T.max()),
        "mean_slowdown": float(sd.mean()),
        "median_slowdown": float(np.median(sd)),
        "p99_slowdown": float(np.percentile(sd, 99)),
        "frac_slowdown_above_ps_mean": float((sd > 1 / (1 - rho)).mean()),
        "largest_jobs_mean_slowdown": float(sd[big].mean()),
        "buckets": buckets,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trace", required=True)
    ap.add_argument("--mode", choices=["poisson", "replay"], required=True)
    ap.add_argument("--rho", type=float, required=True)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--policy", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    arr0, size = load_sizes(args.trace)
    rng = np.random.default_rng(args.seed)
    if args.mode == "poisson":
        size = size[rng.permutation(len(size))]
        lam = args.rho / size.mean()
        arr = np.cumsum(rng.exponential(1 / lam, len(size)))
    else:
        span = arr0[-1] - arr0[0]
        stretch = size.sum() / span / args.rho
        arr = (arr0 - arr0[0]) * stretch
    prng = np.random.default_rng(1000 + args.seed)
    t0 = time.time()
    done = POLICIES[args.policy](arr.tolist(), size.tolist(), prng)
    res = summarize(arr, size, done, args.rho)
    res.update(mode=args.mode, rho=args.rho, seed=args.seed,
               policy=args.policy, seconds=round(time.time() - t0, 1))
    os.makedirs(args.out, exist_ok=True)
    name = f"{args.mode}_rho{args.rho}_seed{args.seed}_{args.policy}.json"
    with open(os.path.join(args.out, name), "w") as f:
        json.dump(res, f, indent=1)
    print(name, res["seconds"], "s", "mean T", round(res["mean_response"], 3),
          "mean slowdown", round(res["mean_slowdown"], 2))


if __name__ == "__main__":
    main()
