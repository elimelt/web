#!/usr/bin/env python3
"""Runs every (workload, N) pair in a shuffled order, REPS times, and writes raw timings as JSON lines."""
import json, random, subprocess, sys, time, os
OUT = sys.argv[1]
REPS = {"xz": 5, "amdahl": 7, "weak": 7, "counter": 7, "padded": 7, "triad": 7}
CORPUS = os.path.join(os.path.dirname(__file__), "../data/silesia.tar.raw")
jobs = [(w, n, r) for w, k in REPS.items() for n in (1, 2, 3, 4) for r in range(k)]
random.Random(20261117).shuffle(jobs)
subprocess.run(["xz", "-T1", "-3", "-c", CORPUS], stdout=subprocess.DEVNULL, check=True)  # warm page cache
with open(OUT, "a") as f:
    for i, (w, n, r) in enumerate(jobs):
        load = os.getloadavg()[0]
        if w == "xz":
            t0 = time.perf_counter()
            subprocess.run(["xz", f"-T{n}", "-3", "-c", CORPUS], stdout=subprocess.DEVNULL, check=True)
            secs = time.perf_counter() - t0
        else:
            out = subprocess.run(["./scaling_bench", w, str(n)], capture_output=True, text=True, check=True).stdout.split()
            secs = float(out[2])
        f.write(json.dumps({"workload": w, "n": n, "rep": r, "seconds": secs, "load1": load}) + "\n"); f.flush()
        print(i, len(jobs), w, n, round(secs, 3), flush=True)
