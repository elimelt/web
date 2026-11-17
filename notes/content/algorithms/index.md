---
title: Algorithms
category: Algorithms
tags:
  - algorithms
  - graph algorithms
  - dynamic programming
  - problem solving
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Map of the algorithms notes, from graph traversal and proof techniques to reusable problem-solving patterns.
---

The design and analysis of algorithms concerns procedures that solve computational problems, the proofs of their correctness and the bounds on their running time. The notes in this section fall into two groups: core concepts such as [[algorithms/graphs-intro|graph fundamentals]], [[algorithms/tree-intro|trees]] and [[algorithms/induction|induction]], and reusable patterns such as [[algorithms/patterns/BFS|BFS]], [[algorithms/patterns/sliding-window|sliding windows]] and [[algorithms/dynamic-programming|dynamic programming]].

The graph traversals assume [[algorithms/graphs-intro|graph fundamentals]], and [[algorithms/BFS|breadth-first search]], [[algorithms/DFS|depth-first search]] and [[algorithms/connected-components|connected components]] build on one another in that order. [[algorithms/induction|Induction]] and [[algorithms/tree-intro|trees]] supply most of the counting arguments and proof techniques used in the other notes.

## Entry points

- Graphs: [[algorithms/graphs-intro|graph fundamentals]], [[algorithms/BFS|BFS]], [[algorithms/DFS|DFS]], [[algorithms/DAGs|directed acyclic graphs]]
- Core structures: [[algorithms/tree-intro|trees]], [[algorithms/bipartite-graphs|bipartite graphs]], [[algorithms/network-flows|network flows]]
- Techniques: [[algorithms/induction|induction]], [[algorithms/divide-and-conquer|divide and conquer]], [[algorithms/dynamic-programming|dynamic programming]]
- Patterns: [[algorithms/patterns/BFS|BFS pattern]], [[algorithms/patterns/sliding-window|sliding window]], [[algorithms/greedy-algorithms|greedy algorithms]]
- Probabilistic data structures: [[algorithms/probabilistic/index|series index and notation]], [[algorithms/probabilistic/hyperloglog-count-min|HyperLogLog and Count-Min]]
