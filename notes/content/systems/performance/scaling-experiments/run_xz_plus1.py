#!/usr/bin/env python3
"""Five runs of xz -T+1 (the multithreaded encoder with one thread), appended to raw.jsonl as workload xz_mt1."""
import json, os, subprocess, sys, time
CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../data/silesia.tar.raw")
with open(sys.argv[1], "a") as f:
    for r in range(5):
        load = os.getloadavg()[0]
        t0 = time.perf_counter()
        subprocess.run(["xz", "-T+1", "-3", "-c", CORPUS], stdout=subprocess.DEVNULL, check=True)
        f.write(json.dumps({"workload": "xz_mt1", "n": 1, "rep": r, "seconds": time.perf_counter() - t0, "load1": load}) + "\n"); f.flush()
