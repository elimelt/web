---
title: Mathematical Induction and Pigeonhole Principle Proofs
category: Algorithms
tags:
  - induction
  - pigeonhole principle
  - proof techniques
date: 2024-03-29
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The structure of a proof by induction (base case, inductive hypothesis, inductive step), worked on the closed form for the sum of the first n natural numbers and on the pigeonhole principle.
---

**Mathematical induction** proves a statement of the form $\forall n \ge n_0,\ P(n)$ by proving $P(n_0)$ and proving that $P(n - 1)$ implies $P(n)$ for every $n > n_0$.

Induction is the principal technique for proving the correctness of recursive algorithms, which solve an instance from solutions to smaller instances. The proofs of the closed form for $\sum_{i=1}^{n} i$ and of the pigeonhole principle follow the same skeleton of base case, inductive hypothesis and inductive step.

> [!abstract] Proof skeleton
>
> 1. Define the predicate $P(n)$ so the claim is exactly $\forall n \ge n_0,\ P(n)$.
> 2. **Base case**: prove $P(n_0)$ directly.
> 3. **Inductive hypothesis**: assume $P(n - 1)$ for an arbitrary $n > n_0$.
> 4. **Inductive step**: derive $P(n)$ from the hypothesis.

## Sum of the First n Naturals

**Claim**:

$$
\forall n \in \mathbb{N}, \sum^{n}_{i = 1} i = \frac{n(n + 1)}{2}
$$

Let $P(n)$ denote the statement $\sum^{n}_{i = 1} i = \frac{n(n + 1)}{2}$.

**Base case** $P(1)$:

$$
1 = \frac{1(1 + 1)}{2}
$$

**Inductive hypothesis**: assume $P(n - 1)$ for some $n \ge 2$.

**Inductive step**: applying $P(n - 1)$ to the first $n - 1$ terms,

$$
1 + \ldots + (n - 1) + n = \frac{(n - 1)n}{2} + n = \frac{n(n + 1)}{2}
$$

so $P(n)$ holds. $\blacksquare$

## Pigeonhole Principle

**Claim**: if $n + 1$ balls are placed into $n$ bins, some bin holds at least 2 balls.

$P(n) :=$ *for any way to put $n + 1$ balls into $n$ bins, there exists a bin with $\ge 2$ balls.*

**Base case** $P(1)$: both balls land in the single bin, which then holds 2 balls.

**Inductive hypothesis**: assume $P(n - 1)$ holds for some $n \ge 2$.

**Inductive step**: suppose $n + 1$ balls are placed arbitrarily into bins $b_1, \ldots, b_n$. Consider $b_1$.

- If $b_1$ holds 2 or more balls, we are done.
- If $b_1$ holds exactly 1 ball, discard $b_1$ and its ball. That leaves $n$ balls in the $n - 1$ bins $b_2, \ldots, b_n$, so $P(n - 1)$ gives a bin with $\ge 2$ balls.
- If $b_1$ is empty, discard $b_1$ and one arbitrary ball. Again $n$ balls are in $n - 1$ bins, and $P(n - 1)$ applies. $\blacksquare$

> [!warning] The build-up error
> The inductive step must start from an arbitrary instance of size $n$ and shrink it. The pigeonhole proof takes any placement of $n + 1$ balls and discards a bin. An argument in the other direction, which extends a size $n - 1$ instance, covers only the instances reachable in that way and leaves the remaining instances unproved.

## The General Pattern

Both proofs reduce $P(n)$ to $P(n - 1)$ by removing one element from the instance. In the design of recursive algorithms the same reduction appears as the solution of a problem of size $n$ from a solution of size $n - 1$. [[algorithms/divide-and-conquer|Divide and conquer]] differs only in the reduction, which shrinks the instance to a constant fraction of its size instead of by one element.

## Related notes

- [[algorithms/problems/graphs-and-trees|graphs and trees problems]]
- [[reference/cheatsheets/algorithms/divide-and-conquer|divide and conquer cheatsheet]]
- [[algorithms/divide-and-conquer|divide and conquer]]
- [[algorithms/tree-intro|trees]]
- [[algorithms/dynamic-programming|dynamic programming]]
