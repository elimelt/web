---
title: Linear Programming Fundamentals and Applications in Optimization
category: Algorithms
tags:
  - linear systems
  - linear programs
  - optimization
date: 2024-08-04
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Linear systems, the geometry of linear programs, conversion to standard form, and LP formulations of max-flow, min-cost flow, and weighted vertex cover including the rounding 2-approximation.
---

A **linear program** (LP) is the problem of maximizing or minimizing a linear function of real variables subject to a finite set of linear equality and inequality constraints.

The constraints define the feasible region, an intersection of half-spaces, and the objective selects a point of that region. Many combinatorial problems reduce to linear programming, and linear programs are solvable in polynomial time.

## Linear Systems

A system of linear equations, in which every constraint is an equality, can be solved by Gaussian elimination. The solution set of such a system is either empty or an affine subspace (a point, a line, a plane, or a higher-dimensional analogue).

Let $a$ be a column vector in $\mathbb{R}^d$, and $x$ a column vector of $d$ variables. A linear expression can be written as the *inner product* of these two vectors:

$$
\langle a, x \rangle = a^Tx = a_1x_1 + a_2x_2 + \ldots + a_dx_d = \sum_{i=1}^d a_ix_i
$$

A **hyperplane** is the set of points $x$ such that $\langle a, x \rangle = b$ for some $b$. A **half-space** is the set of points on one side of a hyperplane, $\{x : \langle a, x \rangle \geq b\}$ or $\{x : \langle a, x \rangle \leq b\}$.

The intersection of a set of half-spaces is a **polytope**, which is a convex set. A **convex set** is a set that contains the line segment between any two of its points.

## Linear Programs

A linear program optimizes a linear **objective function** subject to linear constraints. For example:

$$
\begin{aligned}
&max  & 3x_1 - 4x_3\\
&s.t. & x_1 + x_2 \le 5\\
&     & x_3 + x_1 = 4\\
&     & x_3 - x_2 \ge -5\\
&     & x_1, x_2, x_3 \ge 0\\
\end{aligned}
$$

In matrix form, stacking the constraint vectors $a_i^T$ as rows of $A$:

$$
A = \begin{bmatrix}
a_1^T \\
a_2^T \\
\vdots \\
a_m^T
\end{bmatrix} \Rightarrow
Ax = \begin{pmatrix}
\langle a_1, x \rangle \\
\langle a_2, x \rangle \\
\vdots \\
\langle a_m, x \rangle
\end{pmatrix}
$$

$$
Ax \le b \Rightarrow \begin{array}{c}
\langle a_1, x \rangle \le b_1 \\
\langle a_2, x \rangle \le b_2 \\
\vdots \\
\langle a_m, x \rangle \le b_m
\end{array}
$$

## Standard Form

Every linear program can be written in the following *standard form*.

$$
\begin{array}{cc}
max & \langle c, x \rangle \\
s.t., & Ax \le b\\
~ & x \ge 0
\end{array}
$$

The transformations negate the objective to turn a min into a max, negate a constraint to flip a $\ge$ into a $\le$, and split an equality into two inequalities. For example,

$$
\begin{array}{cc}
min &   y_1 - 2y_2\\
s.t., & y_1 + 2y_2 = 3\\
~ & y_1 - y_2 \ge 1\\
~ & y_1, y_2 \ge 0\\
\end{array}
$$

becomes

$$
\begin{array}{cc}
max &   -y_1 + 2y_2\\
s.t., & y_1 + 2y_2 \le 3\\
~ & -(y_1 + 2y_2) \le -3\\
~ & -(y_1 - y_2) \le -1\\
~ & y_1, y_2 \ge 0\\
\end{array}
$$

A variable without a non-negativity constraint is replaced by the difference of two non-negative variables. For example, in

$$
\begin{array}{cc}
max &   y_1\\
s.t., & y_1 + y_2 \le 3\\
~ & y_2 \ge 0\\
\end{array}
$$

$y_1$ is replaced by $z_1 - z_1'$, where $z_1, z_1' \ge 0$:

$$
\begin{array}{cc}
max   & z_1 - z_1'\\
s.t., & z_1 - z_1' + y_2 \le 3\\
~     & z_1, z_1', y_2 \ge 0\\
\end{array}
$$

> [!abstract] Standard form in one line
> Maximize $\langle c, x \rangle$ subject to $Ax \le b$ and $x \ge 0$. Four transformations reach it from any LP: negate the objective to turn min into max, negate a constraint to flip $\ge$ into $\le$, split an equality into two inequalities, and write an unconstrained variable as the difference of two non-negative ones.

## Components of a Linear Program

An LP formulation of a problem specifies the following components:

- The set of variables.
- Bounds on the variables, e.g. non-negativity.
- The objective function, and whether it is a minimization or maximization.
- The constraints, which must be linear, each either an equality or an inequality.

Problems with LP formulations include two-person zero-sum games, shortest path, max-flow, matching and multi-commodity flow. Because LPs are solvable in polynomial time, LP relaxations of integer programs provide computable lower bounds in the analysis of [[algorithms/approximation-algorithms|approximation algorithms]].

## Max-Flow

Given a graph $G = (V, E)$ with source $s$ and sink $t$, the LP has a variable $x_e$ for the flow on each edge $e$ (see [[algorithms/network-flows|network flows]]).

The constraints are the following:

- $x_e \ge 0$ for all $e$, since flow is non-negative
- $x_e \le c(e)$ for all $e$, the capacity constraint
- $\sum_{e \text{ out of } v} x_e = \sum_{e \text{ into } v} x_e$ for all $v \ne s, t$, the conservation constraint

The objective maximizes flow out of the source:

$$
\begin{array}{ccc}
max     & \sum_{e \text{ out of } s} x_e & ~\\
s.t.,   & \sum_{e \text{ out of } v} x_e = \sum_{e \text{ into } v} x_e & \forall v \ne s, t\\
~       & x_e \le c(e) & \forall e\\
~       & x_e \ge 0 & \forall e
\end{array}
$$

The optimal LP solution is not necessarily an integer flow, though for max-flow an integer optimum always exists when capacities are integers.

> [!tip] Duality intuition
> Every maximization LP has a dual minimization LP, and when either has a finite optimum, the two optimal values are equal (strong duality). The dual of the max-flow LP is a fractional min-cut, so the [[algorithms/network-flows|max-flow min-cut theorem]] is LP duality specialized to this program.

## Min-Cost Flow

Min-cost flow adds a cost $p(e)$ per unit of flow on each edge and minimizes the total cost subject to sending a required flow value $f$:

$$
\begin{array}{ccc}
min     & \sum_{e \in E} p(e) \cdot x_e & ~\\
s.t.,   & \sum_{e \text{ out of } v} x_e = \sum_{e \text{ into } v} x_e & \forall v \ne s, t\\
~       & \sum_{e \text{ out of } s} x_e = f & ~\\
~       & x_e \le c(e) & \forall e\\
~       & x_e \ge 0 & \forall e
\end{array}
$$

## Weighted Vertex Cover

Given a graph $G = (V, E)$ where each vertex has a cost $c_v$, find a vertex cover $S$ minimizing $\sum_{v \in S} c_v$.

Each vertex has a variable $x_v$, intended to be $1$ if $v \in S$ and $0$ otherwise. A cover contains at least one endpoint of each edge, which is the linear constraint $x_u + x_v \ge 1$:

$$
\begin{array}{ccc}
min     & \sum_{v \in V} c_v \cdot x_v & ~\\
s.t.,   & x_u + x_v \ge 1 & \forall (u, v) \in E\\
~       & 0 \le x_v \le 1 & \forall v
\end{array}
$$

With the extra restriction $x_v \in \{0, 1\}$ this is exactly weighted vertex cover, which is NP-hard, so the integer program is not solvable in polynomial time unless P = NP. Dropping the integrality restriction gives the **LP relaxation** above, which is solvable in polynomial time and whose optimum $LP^*$ satisfies $LP^* \le OPT$, since every vertex cover, written as a 0-1 vector, is a feasible LP solution.

Rounding an optimal LP solution yields a vertex cover. Let $S = \{v : x_v \ge \frac{1}{2}\}$. Every edge constraint $x_u + x_v \ge 1$ forces at least one endpoint to be $\ge \frac{1}{2}$, so $S$ is a vertex cover. Rounding at most doubles each variable, so

$$
\sum_{v \in S} c_v \le 2 \sum_{v \in V} c_v x_v = 2 \cdot LP^* \le 2 \cdot OPT
$$

which makes this a 2-approximation for weighted vertex cover.

> [!warning] The LP optimum can lie strictly below OPT
> On a triangle with unit costs, $x_v = \frac{1}{2}$ everywhere is feasible with value $\frac{3}{2}$, while the smallest vertex cover has two vertices. On $K_n$ the gap between $OPT = n - 1$ and $LP^* = \frac{n}{2}$ approaches a factor of $2$, so any analysis that bounds the output against $LP^*$ cannot prove a ratio better than $2$ for this relaxation.

## Related notes

- [[math/linear-algebra/cheatsheet|matrix theory]]
- [[math/linear-algebra/elementry-linear-algebra|linear algebra glossary]]
- [[algorithms/network-flows|network flows]]
- [[algorithms/approximation-algorithms|approximation algorithms]]
