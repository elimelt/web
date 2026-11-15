"""Summarizes results/sweep.txt: issue rate (instructions per cycle) of the
toy partition against resident warps, and checks the conflict-free chain runs
against a closed form.

    python3 -I analyze_sweep.py results/sweep.txt > results/sweep_summary.txt

For a dependent chain (pattern 0) on a conflict-free register file, warp w
issues its k-th instruction at cycle k*max(L, W) + w, where L = EXEC_DEPTH + 4
is the issue-to-issue latency of dependent instructions (issue, issue latch,
operand read, operand register, EXEC_DEPTH execute stages) and W the number of
warps. The run ends one cycle after the last writeback, so
cycles = (N - 1) * max(L, W) + (W - 1) + L + 1.
"""
import re
import statistics
import sys
from collections import defaultdict

PATTERNS = {0: "chain", 1: "conflict chain", 2: "4 chains per warp", 3: "random"}


def main(path):
    runs = defaultdict(list)
    closed = []
    fails = 0
    for line in open(path):
        f = dict(re.findall(r"(\w+)=(\S+)", line))
        if f.get("check") != "PASS":
            fails += 1
        key = (int(f["banks"]), int(f["ports"]), int(f["depth"]), int(f["pattern"]), int(f["warps"]))
        n = int(f["instr"]) // int(f["warps"])
        runs[key].append(int(f["instr"]) / int(f["cycles"]))
        if key[3] == 0 and int(f["conflict_cycles"]) == 0:
            L, W = key[2] + 4, key[4]
            closed.append(int(f["cycles"]) == (n - 1) * max(L, W) + (W - 1) + L + 1)
    print(f"runs: {sum(len(v) for v in runs.values())}, register check failures: {fails}")
    print(f"conflict-free chain runs matching the closed form: {sum(closed)}/{len(closed)}")
    configs = sorted({k[:3] for k in runs})
    for banks, ports, depth in configs:
        print(f"\nbanks={banks} ports={ports} exec_depth={depth} (L = {depth + 4} cycles)")
        warps = sorted({k[4] for k in runs if k[:3] == (banks, ports, depth)})
        print("pattern".ljust(20) + "".join(f"W={w:<8}" for w in warps))
        for p, name in PATTERNS.items():
            cells = []
            for w in warps:
                v = runs.get((banks, ports, depth, p, w))
                if not v:
                    cells.append("-".ljust(10))
                elif len(v) == 1:
                    cells.append(f"{v[0]:.3f}".ljust(10))
                else:
                    cells.append(f"{statistics.mean(v):.3f}".ljust(10))
            print(name.ljust(20) + "".join(cells))
            spread = [runs[(banks, ports, depth, p, w)] for w in warps if len(runs.get((banks, ports, depth, p, w), [])) > 1]
            if spread:
                print("  random, min-max".ljust(20) + "".join(
                    f"{min(v):.2f}-{max(v):.2f}".ljust(10) for v in spread))
    return fails


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1]) else 0)
