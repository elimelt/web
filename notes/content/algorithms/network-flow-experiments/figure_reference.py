"""Reference results for the AugmentingPaths figure in network-flows.mdx.

An Edmonds-Karp implementation written separately from the figure's
TypeScript model, using the same residual-arc order (edges in index order; at
vertex u, the forward arc of each edge leaving u and the backward arc of each
edge entering u), so the two must find the same augmenting paths. NetworkX
supplies an independent max flow value and minimum cut capacity, and the
source side of the cut is recomputed from NetworkX's flow as the set of
vertices reachable from s in its residual graph, which is the same for every
maximum flow.

    python3 figure_reference.py > figure_fixtures.json
"""

from __future__ import annotations

import json
import random
from collections import deque

import networkx as nx
from networkx.algorithms.flow import preflow_push

INF = 10**9


def residual(edges, undirected, flow, e, d):
    c = edges[e][2]
    if d == 1:
        return c - flow[e]
    return c + flow[e] if undirected[e] else flow[e]


def edmonds_karp(n, edges, undirected, s, t):
    adj = [[] for _ in range(n)]
    for e, (u, v, _) in enumerate(edges):
        adj[u].append((e, 1, v))
        adj[v].append((e, -1, u))
    flow = [0] * len(edges)
    paths = []
    while True:
        parent = [None] * n
        seen = [False] * n
        seen[s] = True
        q = deque([s])
        while q and not seen[t]:
            u = q.popleft()
            for e, d, w in adj[u]:
                if not seen[w] and residual(edges, undirected, flow, e, d) > 0:
                    seen[w] = True
                    parent[w] = (e, d, u)
                    q.append(w)
        if not seen[t]:
            break
        path, v = [], t
        while v != s:
            e, d, u = parent[v]
            path.append((e, d))
            v = u
        path.reverse()
        b = min(residual(edges, undirected, flow, e, d) for e, d in path)
        for e, d in path:
            flow[e] += b * d
        paths.append({"arcs": [[e, d] for e, d in path], "bottleneck": b})
    value = sum(flow[e] * (1 if u == s else -1) for e, (u, v, _) in enumerate(edges) if s in (u, v))
    return flow, value, paths


def networkx_cut(n, edges, undirected, s, t):
    g = nx.DiGraph()
    g.add_nodes_from(range(n))

    def add(u, v, c):
        if g.has_edge(u, v):
            g[u][v]["capacity"] += c
        else:
            g.add_edge(u, v, capacity=c)

    for e, (u, v, c) in enumerate(edges):
        add(u, v, c)
        if undirected[e]:
            add(v, u, c)
    value, fd = nx.maximum_flow(g, s, t, flow_func=preflow_push)
    cut_value, _ = nx.minimum_cut(g, s, t)
    # residual reachability from s under NetworkX's flow
    seen, q = {s}, deque([s])
    while q:
        u = q.popleft()
        for w in g.successors(u):
            if w not in seen and g[u][w]["capacity"] - fd[u][w] > 0:
                seen.add(w)
                q.append(w)
        for w in g.predecessors(u):
            if w not in seen and fd[w][u] > 0:
                seen.add(w)
                q.append(w)
    return value, cut_value, sorted(seen)


def random_case(rng):
    n = rng.randint(2, 12)
    m = rng.randint(1, 3 * n)
    edges, und = [], []
    for _ in range(m):
        u, v = rng.sample(range(n), 2)
        edges.append([u, v, rng.choice([1, 1, 2, 3, 5, 8, INF]) if rng.random() < 0.15 else rng.randint(0, 9)])
        und.append(rng.random() < 0.2)
    return {"n": n, "edges": edges, "undirected": und, "s": 0, "t": n - 1}


def main():
    rng = random.Random(7)
    cases = []
    for _ in range(400):
        c = random_case(rng)
        flow, value, paths = edmonds_karp(c["n"], c["edges"], c["undirected"], c["s"], c["t"])
        nx_value, nx_cut, reach = networkx_cut(c["n"], c["edges"], c["undirected"], c["s"], c["t"])
        assert nx_value == value == nx_cut, (c, value, nx_value)
        c.update(value=value, cut_capacity=nx_cut, source_side=reach, paths=paths)
        cases.append(c)
    print(json.dumps({"networkx": nx.__version__, "inf": INF, "cases": cases}, separators=(",", ":")))


if __name__ == "__main__":
    main()
