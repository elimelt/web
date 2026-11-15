---
title: Breadth First Search Algorithm Implementation and Analysis
category: Algorithms
tags:
  - bfs
  - graph traversal
  - shortest paths
  - graph theory
  - complexity analysis
  - bipartite graphs
date: 2024-04-03
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: BFS pseudocode and Python implementations, the O(|V| + |E|) runtime analysis, and proofs that BFS levels differ by at most one across any edge and equal shortest path distances.
sources:
  - https://www.cs.princeton.edu/~wayne/kleinberg-tardos/
---

**Breadth-first search** (BFS) from a source vertex $s$ of a graph $G = (V, E)$ visits every vertex reachable from $s$ in nondecreasing order of its distance from $s$, where the distance of $v$ is the number of edges on a shortest path from $s$ to $v$.

The search proceeds in levels. Level 0 contains $s$, level 1 contains the neighbors of $s$, and level $i + 1$ contains the vertices first discovered from vertices of level $i$. Two structural facts follow from this order: the levels of adjacent vertices differ by at most one, and the level of a vertex equals its shortest path distance from $s$.

## Core idea

A vertex is in one of three states during BFS:

- **Undiscovered**: the vertex has not been seen yet.
- **Discovered**: the vertex has been seen, but its neighbors have not been explored yet.
- **Explored**: the vertex has been seen and its neighbors have been explored.

BFS holds discovered vertices in a queue, so vertices leave the queue in the order in which they were discovered. Discovery order is nondecreasing in distance from the start, as [[#Levels are shortest path distances]] proves.

```text
BFS(G, s):
  mark all vertices as undiscovered

  mark s as discovered
  q = queue({s})
  while q is not empty:
    u = poll(q)
    for each edge (u, v) in G:
      if v is undiscovered:
        mark v as discovered
        add v to q
    mark u as explored
```

## Analysis

The outer while loop runs once for each vertex in the graph, and the inner for loop runs once for each edge of the current vertex. The sum of all vertex degrees is twice the number of edges, so the total work is

$$
O(|V|) + O\left(\sum_{v \in V} deg(v)\right) = O(|V| + |E|)
$$

## Structure of the BFS tree

1. $BFS(s)$ visits a vertex $v$ if and only if there is a path from $s$ to $v$.
2. Edges into then-undiscovered vertices form a tree rooted at $s$ (the **BFS spanning tree**).
3. Level $i$ of the tree contains exactly the vertices $v$ such that the shortest path from $s$ to $v$ has $i$ edges.
4. All non-tree edges of $G$ connect vertices in the same level or adjacent levels.

The following BFS from $s$ on a small graph exhibits all four facts. Solid edges are tree edges and dashed edges are the non-tree edges of $G$; each dashed edge joins two vertices of the same level or of adjacent levels.

```mermaid
flowchart TD
    subgraph L0["Level 0"]
        s((s))
    end
    subgraph L1["Level 1"]
        a((a))
        b((b))
    end
    subgraph L2["Level 2"]
        c((c))
        d((d))
        e((e))
    end
    s --- a
    s --- b
    a --- c
    a --- d
    b --- e
    a -.- b
    c -.- d
    b -.- d

    style s fill:#e3f2fd,stroke:#1565c0
```

> [!tip] Non-tree edges never skip a level
> Fact 4 is a consequence of processing vertices in queue order. If an edge spanned two or more levels, its deeper endpoint would have a shorter path than its level allows, contradicting [[#Levels are shortest path distances]]. The same-level case is exactly what the [[algorithms/bipartite-graphs|bipartiteness test]] looks for, since a same-level edge closes an odd cycle.

### Difference in levels

Let $L(v)$ be the level of vertex $v$ in the BFS tree.

**Claim**:

$$
\forall (x, y) \in E, |L(x) - L(y)| \le 1
$$

**Proof**: Suppose $L(x) = i$ and $L(y) = j$. Without loss of generality, assume $x$ is explored before $y$. Consider the iteration where we process $x$.

Case 1: $y$ is still undiscovered. Since there is an edge between $x$ and $y$, we discover $y$ while processing $x$, so $L(y) = i + 1$.

Case 2: $y$ is already discovered. Then $y$ is in the queue somewhere behind $x$, and levels in the queue are non-decreasing, so $L(y) \ge i$. Every vertex still in the queue was discovered by a vertex of level at most $i$, so $L(y) \le i + 1$.

In both cases $|L(x) - L(y)| \le 1$. $\blacksquare$

### Levels are shortest path distances

**Claim**: for every vertex $v$ reachable from $s$, $L(v)$ equals the length of the shortest path from $s$ to $v$.

**Proof**: Let $l(v)$ be the length of the shortest path from $s$ to $v$.

$L(v) \ge l(v)$: the tree path from $s$ to $v$ is a real path in $G$ with $L(v)$ edges, and the shortest path is at least as short.

$L(v) \le l(v)$: let $s = v_0, v_1, \ldots, v_k = v$ be a shortest path, so $k = l(v)$. Each consecutive pair $(v_i, v_{i+1})$ is an edge, so the previous claim gives $L(v_{i+1}) \le L(v_i) + 1$. Starting from $L(v_0) = 0$ and applying this along the path, $L(v_k) \le k$.

Together, $L(v) = l(v)$. $\blacksquare$

## Implementation

```python
from collections import deque

def bfs(graph, start):
    visited = set()
    queue = deque([start])
    visited.add(start)
    while queue:
        vertex = queue.popleft()
        print(vertex)
        for neighbor in graph[vertex]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
```

A generator that also yields the level of each vertex follows. Without the visited set, the traversal does not terminate when a cycle is reachable from the start vertex.

```python
from collections import deque

def level_order_traversal(graph, start):
    visited = {start}
    queue = deque([(start, 0)])
    while queue:
        vertex, level = queue.popleft()
        yield vertex, level
        for neighbor in graph[vertex]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, level + 1))
```

## Related notes

- [[algorithms/patterns/BFS|BFS pattern]]
- [[algorithms/graphs-intro|Graph fundamentals]]
- [[algorithms/DFS|depth-first search]]
- [[algorithms/connected-components|connected components]]
- [[algorithms/bipartite-graphs|bipartite graphs]]
