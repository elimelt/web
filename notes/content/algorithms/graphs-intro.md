---
title: Introduction to Undirected Graphs and Their Properties
category: Algorithms
tags:
  - graphs
  - graph fundamentals
  - graph representation
  - graph properties
  - data structures
  - acyclic graphs
date: 2024-04-03
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Definitions and basic facts about undirected graphs, with proofs of the degree sum formula, the parity of odd-degree vertices, and the edge count bound, plus a comparison of adjacency matrix and adjacency list storage.
sources:
  - https://www.cs.princeton.edu/~wayne/kleinberg-tardos/
---

An **undirected graph** $G = (V, E)$ consists of a set $V$ of vertices and a set $E$ of edges, each of which is an unordered pair of distinct vertices, its endpoints.

The degree sum formula, the parity of the number of odd-degree vertices and the bounds on the number of edges enter the running-time analysis of graph algorithms such as [[algorithms/BFS|breadth-first search]], as does the choice between the adjacency-matrix and adjacency-list representations.

## Undirected Graphs

An undirected graph is a set of vertices and a set of edges.

$$
G = (V, E)
$$

### Terminology

- **Connected**: a graph is connected if there is a path between every pair of vertices.
- **Isolated vertex**: a vertex with no edges.
- **Planar graph**: a graph that can be drawn in the plane such that no two edges cross.
- **Degree of a vertex**: $deg(v) =$ the number of edges incident to $v$.
- **Connected components**: the maximal connected subsets of vertices. They partition $V$.
- **Path**: a sequence of distinct vertices where each vertex is connected to the next by an edge. The length of a path is its number of edges.
- **Cycle**: a path of length at least 3 that starts and ends at the same vertex.
- **Tree**: a connected graph with no cycles.

### Degree Sum

**Claim**: in any undirected graph, the number of edges is half the sum of all vertex degrees.

$$
|E| = \frac{1}{2} \sum_{v \in V} deg(v)
$$

**Proof**: the sum counts each edge exactly twice, once from each endpoint. $\blacksquare$

### Odd Degree Vertices

**Claim**: in any undirected graph, the number of odd-degree vertices is even.

**Proof**: the sum of all degrees is even (it equals $2|E|$). The even-degree vertices contribute an even amount to the sum, so the odd-degree vertices must also contribute an even amount. A sum of an odd number of odd numbers is odd, so the count of odd-degree vertices is even. $\blacksquare$

### Degree 1 Vertices

**Claim**: if $G$ is acyclic, then $G$ has a vertex of degree at most 1.

$$
G = (V, E) \text{ is acyclic} \to \exists v \in V, deg(v) \le 1
$$

**Proof**: by contradiction. Assume $\forall v \in V, deg(v) \ge 2$. Consider a walk that starts at any vertex and, at each vertex $v_i$, leaves along an edge other than the one on which it arrived, which exists since $deg(v_i) \ge 2$. The graph has finitely many vertices, so some vertex eventually repeats, and the walk between the two visits forms a cycle. This contradicts $G$ being acyclic. $\blacksquare$

### Number of Edges

Let $G = (V, E)$ be a graph with $n = |V|$ vertices and $m = |E|$ edges.

**Claim**: $m \le \binom{n}{2} = \frac{n(n - 1)}{2} = O(n^2)$

**Proof**: each vertex can be connected to at most $n - 1$ other vertices, and each edge is shared by two vertices, so the total number of edges is at most $\frac{n(n-1)}{2}$. $\blacksquare$

### Too Many Edges Force a Cycle

**Claim**: if an undirected graph on $n$ vertices has at least $n$ edges, then it contains a cycle.

**Proof**: an acyclic undirected graph is a forest, so each connected component is a tree. If the components have vertex counts $n_1, \ldots, n_k$, then the total number of edges is

$$
\sum_{i=1}^{k}(n_i - 1) = \left(\sum_{i=1}^{k} n_i\right) - k = n - k \le n - 1.
$$

So every acyclic graph on $n$ vertices has at most $n - 1$ edges. The contrapositive says any graph with at least $n$ edges must contain a cycle. $\blacksquare$

### Sparsity

A graph is called sparse if $|E| \ll |V|^2$, and dense otherwise. Social networks, the web graph and planar graphs are sparse. When $m = O(n)$, as in planar graphs, an $O(n + m)$ algorithm runs in $O(n)$ time, although $O(n + m) = O(n^2)$ in the worst case.

## Storing Graphs

### Adjacency Matrix

The adjacency matrix of $G$ is the $n \times n$ matrix $A$ with $A_{ij} = 1$ if there is an edge between $v_i$ and $v_j$, and $0$ otherwise.

- Checking whether an edge exists between two vertices takes $O(1)$ time.
- The matrix occupies $O(n^2)$ space regardless of the number of edges.
- Enumerating the neighbors of a vertex takes $O(n)$ time.

The adjacency matrix suits dense graphs, in which $m = \Theta(n^2)$ and its space is within a constant factor of that of an adjacency list.

### Adjacency List

The adjacency list of $G$ stores, for each vertex, a list of its neighbors.

- Enumerating the neighbors of $v$ takes $O(deg(v))$ time.
- The lists occupy $O(n + m)$ space.
- Checking whether edge $(u, v)$ exists takes $O(deg(u))$ time.

The adjacency list suits sparse graphs, for which $O(n + m)$ space is much smaller than $O(n^2)$.

```python
from typing import List, Tuple

def build_adjacency_list(n: int, edges: List[Tuple[int, int]]) -> List[List[int]]:
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
        adj[v].append(u)
    return adj

def build_adjacency_matrix(n: int, edges: List[Tuple[int, int]]) -> List[List[int]]:
    adj = [[0] * n for _ in range(n)]
    for u, v in edges:
        adj[u][v] = 1
        adj[v][u] = 1
    return adj
```

## Related notes

- [[algorithms/BFS|breadth-first search]]
- [[algorithms/DFS|depth-first search]]
- [[algorithms/tree-intro|trees]]
- [[algorithms/connected-components|connected components]]
