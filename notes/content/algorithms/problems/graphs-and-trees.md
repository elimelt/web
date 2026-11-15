---
title: Graphs and Trees Problem Notes
category: Algorithms
tags:
  - graphs
  - trees
  - induction
  - contradiction
  - cycle detection
date: 2024-04-14
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
archive: true
description: Two graph theory proof exercises, a complete inductive bound on the number of leaves of a tree and a proof by contradiction, reconstructed from partial notes, that a graph with n vertices and at least n edges has a cycle.
sources:
  - https://www.cs.princeton.edu/~wayne/kleinberg-tardos/
---

The first exercise is an [[algorithms/induction|inductive proof]] that a tree has at least as many leaves as vertices of degree at least $3$. The second is a proof by contradiction that a graph with $n$ vertices and at least $n$ edges contains a cycle.

## Problem 1
Let $G$ be a tree. Use induction to prove that the number of leaves of $G$ is at least the number of vertices of degree at least $3$ in $G$.

#### Solution

$P(n)$: The number of leaves of any tree $G$ with $n$ vertices is at least the number of vertices of degree at least $3$ in $G$.

#### Base Case: $P(1)$

A tree with one vertex has no leaves or vertices of degree at least $3$, so the base case holds.

#### IH: Assume $P(k)$ holds for some $k \ge 1$.

#### IS: We want to show that $P(k + 1)$ holds.

Let $G = (V, E)$ be a tree with $|V| = k + 1$.

Choose some arbitrary leaf $l \in V$, and $(l, p) \in E$. Removing $l$ (and its corresponding edge) from $G$ results in a tree $G' = (V', E')$ with $|V'| = k$. By the IH, $G'$ satisfies $P(k)$.

**Case 1**: $p$ has degree $1$ in $G'$.

Then $p$ is a leaf in $G'$, and $G'$ has the same number of leaves and vertices of degree at least 3 as $G$ (since no vertex of degree at least 3 was removed). Thus, $G$ has at least as many leaves as vertices of degree at least 3.

**Case 2**: $p$ has degree $2$ in $G'$.

Then $p$ is not a leaf in $G'$, and $G'$ has one fewer leaf than $G$ (since we removed a leaf). The vertex $p$ has degree 3 in $G$ and degree 2 in $G'$, so $G'$ also has one fewer vertex of degree at least 3. Both counts increase by 1 from $G'$ to $G$, so the number of leaves in $G$ is still at least the number of vertices of degree at least 3 in $G$.

**Case 3**: $p$ has degree at least $3$ in $G'$.

Then $p$ is a vertex of degree at least $3$ in $G$, and $G$ has the same number of vertices of degree greater than or equal to $3$ as $G'$. Since we only add a leaf to $G'$ to get $G$, the number of leaves in $G$ is at least the number of leaves in $G'$, which is at least the number of vertices of degree at least $3$ in $G'$.

In all cases, $G$ has at least as many leaves as vertices of degree at least $3$, so $P(k + 1)$ holds.

## Problem 2

Let $G$ be a [[algorithms/graphs-intro|graph]] with $n$ vertices and at least $n$ edges. Show that $G$ has a cycle.

#### Solution

Let $G$ be a graph with $n$ vertices and at least $n$ edges. Suppose for the sake of contradiction that $G$ has no cycles.

Since $G$ has no cycles, it is a forest.

Claim: The sum of the degrees of all vertices in a graph is equal to twice the number of edges.

Proof: Each edge contributes $1$ to the degree of two vertices, so the sum of the degrees of all vertices is twice the number of edges.

Every forest on $n$ vertices has at most $n - 1$ edges, which follows from summing the edge counts of its tree components. If the components have $n_1, \ldots, n_k$ vertices, then the total number of edges is

$$
\sum_{i=1}^{k}(n_i - 1) = \left(\sum_{i=1}^{k} n_i\right) - k = n - k \le n - 1.
$$

But $G$ is assumed to have at least $n$ edges, which contradicts the bound above. Therefore $G$ must contain a cycle.

## Related notes

- [[algorithms/graphs-intro|Graph Fundamentals]]
- [[reference/cheatsheets/algorithms/graphs|Graph Theory]]
- [[algorithms/induction|Mathematical Induction]]
- [[algorithms/DFS|Depth First Search]]
- [[algorithms/index|Algorithms]]
