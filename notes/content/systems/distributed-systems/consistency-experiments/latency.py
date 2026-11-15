"""Median operation latency per configuration, from the recorded histories.

    python3 latency.py data/*.jsonl.gz >> results.txt
"""

import re
import statistics
import sys
from collections import defaultdict

import classify


def main():
    lat = defaultdict(lambda: {"w": [], "r": []})
    for h in classify.load(sys.argv[1:]):
        m = re.match(r"(\w+)-(\w+)-d(\d+)-s(\d+)", h["run"])
        cfg = (m.group(1), m.group(2), int(m.group(3)))
        for o in h["ops"]:
            if o["ret"] is not None:
                lat[cfg][o["kind"]].append((o["ret"] - o["call"]) / 1e6)
    print("latency, ms: median [10th to 90th percentile]")
    for cfg in sorted(lat):
        parts = []
        for k, name in (("w", "write"), ("r", "read")):
            xs = sorted(lat[cfg][k])
            q = statistics.quantiles(xs, n=10)
            parts.append(f"{name} {statistics.median(xs):.2f} [{q[0]:.2f} to {q[-1]:.2f}] (n={len(xs)})")
        print(f"  reads={cfg[0]} clients={cfg[1]} delay={cfg[2]}ms  " + "  ".join(parts))


if __name__ == "__main__":
    main()
