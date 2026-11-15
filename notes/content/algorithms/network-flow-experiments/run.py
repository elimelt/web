"""Times maxflow.cpp on every instance from instances.py and summarizes the runs.

    g++ -O2 -std=c++17 -o maxflow maxflow.cpp
    python3 instances.py /tmp/flows
    python3 run.py ./maxflow /tmp/flows > results.json

Every process is pinned to one core (taskset -c CORE). Within a family the
sizes run in increasing order; once an algorithm exceeds its time limit on an
instance it is skipped for the larger sizes of that family.
"""

from __future__ import annotations

import json
import os
import platform
import statistics
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

CORE = "2"
LIMIT = {"ek": 30.0, "dinic": 60.0, "pr": 60.0}
REPS = {"seg": 5}  # other families: 3 instances (seeds) x 3 repetitions
DEFAULT_REPS = 3
COUNTERS = ["augmentations", "phases", "arc_scans", "pushes", "relabels", "global_relabels", "gap_nodes"]


def run_one(binary: str, path: Path, algos: list[str], reps: int) -> list[dict]:
    cmd = ["taskset", "-c", CORE, binary, str(path), "--algos", ",".join(algos), "--reps", str(reps)]
    for a in algos:
        cmd += [f"--limit-{a}", str(LIMIT[a])]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    rows = [json.loads(line) for line in out.splitlines()]
    return rows


def size_key(size):
    return (0, size) if isinstance(size, int) else (1, str(size))


def main(binary: str, instdir: str) -> None:
    inst = Path(instdir)
    manifest = json.loads((inst / "manifest.json").read_text())
    by_family = defaultdict(list)
    for m in manifest:
        by_family[m["family"]].append(m)
    rows = []
    with open("results-raw.jsonl", "w") as raw:
        for family in sorted(by_family, key=lambda f: f != "seg"):
            dead: set[str] = set()
            for m in sorted(by_family[family], key=lambda m: (size_key(m["size"]), m["seed"])):
                algos = [a for a in ("ek", "dinic", "pr") if a not in dead]
                if not algos:
                    break
                got = run_one(binary, inst / m["file"], algos, REPS.get(family, DEFAULT_REPS))
                for r in got:
                    r.update(family=family, size=m["size"], seed=m["seed"], file=m["file"])
                    raw.write(json.dumps(r) + "\n")
                    if r["timeout"] and family != "seg":
                        dead.add(r["algo"])
                raw.flush()
                rows += got
                print(m["file"], {a: round(statistics.median([r["seconds"] for r in got if r["algo"] == a]), 4) for a in algos}, file=sys.stderr, flush=True)

    # every completed run must be verified, and all algorithms must agree on each instance
    values = defaultdict(set)
    for r in rows:
        if not r["timeout"]:
            assert r["ok"], r
            values[r["file"]].add(r["value"])
    assert all(len(v) == 1 for v in values.values()), "algorithms disagree"

    groups = defaultdict(list)
    for r in rows:
        groups[(r["family"], r["size"], r["algo"])].append(r)
    summary = []
    for (family, size, algo), rs in sorted(groups.items(), key=lambda kv: (kv[0][0], size_key(kv[0][1]), kv[0][2])):
        done = [r for r in rs if not r["timeout"]]
        entry = {"family": family, "size": size, "algo": algo, "runs": len(rs), "completed": len(done),
                 "n": rs[0]["n"], "m": rs[0]["m"]}
        if done and len(done) == len(rs):
            secs = sorted(r["seconds"] for r in done)
            entry.update(median_s=statistics.median(secs), min_s=secs[0], max_s=secs[-1],
                         q1_s=statistics.quantiles(secs, n=4)[0] if len(secs) > 1 else secs[0],
                         q3_s=statistics.quantiles(secs, n=4)[2] if len(secs) > 1 else secs[0])
            for c in COUNTERS:  # counts are deterministic per instance; average over seeds
                entry[c] = statistics.mean(r[c] for r in done)
            entry["value"] = statistics.mean(r["value"] for r in done)
            if algo == "pr":
                entry["median_phase1_s"] = statistics.median(r["phase1_seconds"] for r in done)
        summary.append(entry)

    env = {
        "compiler": subprocess.run(["g++", "--version"], capture_output=True, text=True).stdout.splitlines()[0],
        "flags": "-O2 -std=c++17",
        "cpu": next(l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name")),
        "cores": os.cpu_count(),
        "kernel": platform.release(),
        "python": platform.python_version(),
        "pinned_core": CORE,
        "limits_s": LIMIT,
        "loadavg_at_end": open("/proc/loadavg").read().split()[:3],
    }
    print(json.dumps({"environment": env, "instances_verified": len(values), "summary": summary}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
