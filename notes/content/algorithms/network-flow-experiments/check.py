"""Cross-checks maxflow.cpp against NetworkX on random networks.

For each random network, every algorithm in maxflow.cpp must return the max
flow value that NetworkX's preflow_push and edmonds_karp return, and its own
verifier (flow constraints, residual-reachability cut of equal capacity) must
pass. Also checks the min-cut capacity on the DIMACS-family generators at
small sizes.

    g++ -O2 -std=c++17 -o maxflow maxflow.cpp
    python3 check.py ./maxflow
"""

from __future__ import annotations

import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

import networkx as nx
from networkx.algorithms.flow import edmonds_karp, preflow_push

import instances


def run(binary: str, path: Path) -> list[dict]:
    out = subprocess.run([binary, str(path), "--reps", "1"], capture_output=True, text=True, check=True).stdout
    return [json.loads(line) for line in out.splitlines()]


def nx_value(n, s, t, arcs) -> tuple[int, int]:
    g = nx.DiGraph()
    g.add_nodes_from(range(1, n + 1))
    for u, v, c in arcs:  # merge parallel arcs, which DiGraph cannot hold
        if c <= 0 or u == v:
            continue
        if g.has_edge(u, v):
            g[u][v]["capacity"] += c
        else:
            g.add_edge(u, v, capacity=c)
    a = nx.maximum_flow_value(g, s, t, flow_func=preflow_push)
    b = nx.maximum_flow_value(g, s, t, flow_func=edmonds_karp)
    cut, _ = nx.minimum_cut(g, s, t)
    assert a == b == cut
    return a, b


def random_network(rng: random.Random):
    n = rng.randint(2, 40)
    m = rng.randint(1, 6 * n)
    cmax = rng.choice([1, 3, 10, 1000])
    arcs = [(rng.randint(1, n), rng.randint(1, n), rng.randint(0, cmax)) for _ in range(m)]
    return n, 1, n, arcs


def main(binary: str) -> None:
    rng = random.Random(2026)
    checked = 0
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "g.max"
        cases = [random_network(rng) for _ in range(600)]
        cases += [instances.genrmf(3, 4, 1, 100, s) for s in range(5)]
        cases += [instances.rlg(8, 6, 100, s) for s in range(5)]
        cases += [instances.ak(k) for k in (2, 3, 10, 40)]
        for n, s, t, arcs in cases:
            arcs = [(u, v, c) for (u, v, c) in arcs if c > 0 and u != v]
            if not arcs:
                continue
            instances.write(path, n, s, t, arcs, "check")
            want, _ = nx_value(n, s, t, arcs)
            for r in run(binary, path):
                assert r["ok"], r
                assert r["value"] == want, (r, want)
            checked += 1
    print(json.dumps({"networks_checked": checked, "networkx": nx.__version__, "all_agree": True}))


if __name__ == "__main__":
    main(sys.argv[1])
