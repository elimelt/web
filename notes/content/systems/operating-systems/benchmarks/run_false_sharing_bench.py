#!/usr/bin/env python3
"""Runs false_sharing_bench and writes false_sharing_results.json.

Usage: gcc -O2 -pthread -o false_sharing_bench false_sharing_bench.c
       python3 run_false_sharing_bench.py [runs]
Configurations are interleaved across runs so slow drift in the host
affects every configuration alike.
"""
import itertools, json, platform, random, statistics, subprocess, sys, time

RUNS = int(sys.argv[1]) if len(sys.argv) > 1 else 5
STRIDES = [8, 16, 32, 64, 128, 256]
SWEEP = [  # (kind, threads, iterations per thread)
    ("atomic", 2, 20_000_000), ("atomic", 4, 20_000_000),
    ("volatile", 2, 200_000_000), ("volatile", 4, 200_000_000),
    ("reader", 2, 200_000_000), ("reader", 4, 200_000_000),
    ("plain", 4, 200_000_000),
]
PAIRS = list(itertools.combinations(range(4), 2))
PP_ROUNDS = 1_000_000

def run(*args):
    return subprocess.run(["./false_sharing_bench", *map(str, args)], check=True,
                          capture_output=True, text=True).stdout.split()

def summary(xs):
    return {"median": statistics.median(xs), "min": min(xs), "max": max(xs), "runs": xs}

def main():
    rng = random.Random(1)
    sweep = {f"{k}/{t}/{s}": [] for (k, t, _), s in itertools.product(SWEEP, STRIDES)}
    pp = {f"{a}-{b}": [] for a, b in PAIRS}
    t0 = time.time()
    for r in range(RUNS):
        jobs = [("s", k, t, n, s) for (k, t, n), s in itertools.product(SWEEP, STRIDES)]
        jobs += [("p", a, b) for a, b in PAIRS]
        rng.shuffle(jobs)
        for j in jobs:
            if j[0] == "s":
                _, k, t, n, s = j
                wall, t0ns, others = map(float, run("sweep", t, s, k, n))
                sweep[f"{k}/{t}/{s}"].append({"wall": wall, "thread0": t0ns, "others": others})
            else:
                _, a, b = j
                pp[f"{a}-{b}"].append(float(run("pingpong", a, b, PP_ROUNDS)[0]))
        print(f"run {r + 1}/{RUNS} done at {time.time() - t0:.0f} s", flush=True)
    out = {
        "machine": {
            "cpu": subprocess.run("lscpu | sed -n 's/^Model name: *//p'", shell=True,
                                  capture_output=True, text=True).stdout.strip(),
            "kernel": platform.release(),
            "compiler": subprocess.run(["gcc", "--version"], capture_output=True,
                                       text=True).stdout.splitlines()[0],
        },
        "runs": RUNS,
        "sweep": {key: {f: summary([v[f] for v in vals]) for f in ("wall", "thread0", "others")}
                  for key, vals in sweep.items()},
        "pingpong_ns_one_way": {key: summary(v) for key, v in pp.items()},
        "elapsed_s": round(time.time() - t0, 1),
    }
    json.dump(out, open("false_sharing_results.json", "w"), indent=1)

main()
