---
title: Finding Connected Components in Undirected Graphs Using BFS/DFS
category: Algorithms
tags:
  - bfs
  - dfs
  - graph theory
  - connected components
  - breadth-first search
  - depth first search
date: 2024-04-14
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: How to partition an undirected graph into connected components in O(|V| + |E|) with BFS or DFS, producing a labeling that answers path-existence queries in O(1).
sources:
  - https://www.cs.princeton.edu/~wayne/kleinberg-tardos/
---

A **connected component** of an undirected graph $G = (V, E)$ is a maximal set $C \subseteq V$ such that every two vertices of $C$ are joined by a path in $G$. The connected components $C_1, C_2, \ldots$ partition $V$.

[[algorithms/BFS|Breadth-first search (BFS)]] or [[algorithms/DFS|depth-first search (DFS)]] computes this partition in $O(|V| + |E|)$ time. The result is a labeling, built once from $G$, that answers whether a path exists between two vertices $u, v \in V$ in $O(1)$ time and $O(|V|)$ space, since two vertices are connected if and only if they carry the same component label.

## Algorithm

The algorithm scans the vertices in order. Each vertex that has no label when the scan reaches it begins a new component; a BFS (or DFS) from that vertex assigns the current label to every vertex it reaches, and the label is then incremented. Each traversal remains within one component because BFS follows only edges, and it labels the whole component because BFS reaches every vertex connected to its source. The labels are stored in an array (if vertices are numbered) or a hash map.

On the following graph, the scan starts traversals at vertices 0, 3 and 5, and each traversal labels one component.

```mermaid
flowchart LR
    subgraph C0["label 0"]
        n0((0)) --- n1((1))
        n1 --- n2((2))
        n2 --- n0
    end
    subgraph C1["label 1"]
        n3((3)) --- n4((4))
    end
    subgraph C2["label 2"]
        n5((5)) --- n6((6))
    end
```

```python
from collections import deque, defaultdict

def connected_components(graph):
    a = [None] * len(graph)

    def bfs(label, src):
        q = deque([src])
        a[src] = label
        while q:
            curr = q.popleft()
            for v in graph[curr]:
                if a[v] is None:
                    a[v] = label
                    q.append(v)

    curr_label = 0
    for v in range(len(graph)):
        if a[v] is None:
            bfs(curr_label, v)
            curr_label += 1
    return a

def component_sets(G):
    comp = connected_components(G)
    component_dict = defaultdict(set)
    for v, c in enumerate(comp):
        component_dict[c].add(v)
    return list(component_dict.values())
```

The label array also serves as the visited set, so every vertex enters the queue at most once and the total work over all traversals is $O(|V| + |E|)$.

> [!warning] Undirected graphs only
> The labeling argument relies on connectivity being symmetric. In a directed graph reachability is not symmetric, and a scan that follows only outgoing edges produces labels that depend on the scan order. The scan computes weakly connected components when every edge is traversed in both directions. Strongly connected components require Tarjan's or Kosaraju's algorithm.

## Strategy for Unconnected Graphs

When the solution of a graph problem decomposes over connected components, it suffices to solve the problem for connected graphs and to apply that solution separately to each connected component.

## Related notes

- [[algorithms/BFS|breadth-first search]]
- [[algorithms/DFS|depth-first search]]
- [[algorithms/graphs-intro|graph fundamentals]]
- [[reference/cheatsheets/algorithms/graphs|graph theory cheatsheet]]
