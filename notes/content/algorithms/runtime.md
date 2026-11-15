---
title: Measuring Algorithm Efficiency with Asymptotic Notation
category: Algorithms
tags:
  - time complexity
  - asymptotic notation
  - efficiency
date: 2024-03-29
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Definitions of O, Omega, and Theta notation, growth-rate facts for common function families, and the definition of an efficient algorithm as one with polynomial running time.
sources:
  - https://www.cs.princeton.edu/~wayne/kleinberg-tardos/
---

Asymptotic notation classifies functions of the input size $n$ by their growth rate, disregarding constant factors and the values of the function below some threshold $n_0$. $O$, $\Omega$ and $\Theta$ express upper, lower and tight bounds.

Running time is roughly proportional to the number of simple operations performed, so expressing the operation count as a function of input size in this notation allows algorithms to be compared without benchmarking them.

## O-Notation

Given two functions $f(n)$ and $g(n)$, we say that $f(n)$ is $O(g(n))$ if there exist constants $c$ and $n_0$ such that $0 \leq f(n) \leq c \cdot g(n)$ for all $n \geq n_0$.

## Omega-Notation

Given two functions $f(n)$ and $g(n)$, we say that $f(n)$ is $\Omega(g(n))$ if there exist constants $c$ and $n_0$ such that $0 \leq c \cdot g(n) \leq f(n)$ for all $n \geq n_0$.

## Theta-Notation

Given two functions $f(n)$ and $g(n)$, we say that $f(n)$ is $\Theta(g(n))$ if there exist constants $c_1$, $c_2$, and $n_0$ such that $0 \leq c_1 \cdot g(n) \leq f(n) \leq c_2 \cdot g(n)$ for all $n \geq n_0$.

> [!abstract] The three bounds
>
> | Notation | Role | Guarantee for all $n \ge n_0$ |
> | --- | --- | --- |
> | $O(g)$ | upper bound | $f(n) \le c \cdot g(n)$ |
> | $\Omega(g)$ | lower bound | $f(n) \ge c \cdot g(n)$ |
> | $\Theta(g)$ | tight bound | both, with separate constants |

## Common Bounds

Logarithms grow slower than every polynomial $n^\epsilon$ with $\epsilon > 0$, and every polynomial grows slower than every exponential $b^n$ with $b > 1$.

### Polynomial

$$
a_0 + a_1n + a_2n^2 + \ldots + a_kn^k \in O(n^k)
$$

### Logarithmic

$$
\log_a n \in O(\log_b n) \text{ for all } a, b > 1
$$

A change of base alters a logarithm only by a constant factor, since $\log_a n = \frac{\log_b n}{\log_b a}$.

### Exponential

$$
a^n \in O(b^n) \text{ for all } 1 < a \le b
$$

### Factorial

$$
n! \in O(n^n)
$$

## "Efficient" Algorithms

A single CPU core executes on the order of $10^9$ simple operations per second. At that rate an exponential algorithm is impractical on all but small inputs. $2^{60}$ operations take decades, and $n!$ exceeds that count at $n = 20$.

Kleinberg and Tardos define an efficient algorithm as one whose running time is polynomial in the input size. Under this definition, if the input size grows by a constant factor, the running time of a polynomial time algorithm also grows by a constant factor.

## Related notes

- [[algorithms/divide-and-conquer|divide and conquer]]
- [[algorithms/dynamic-programming|dynamic programming]]
- [[reference/cheatsheets/algorithms/intervals|interval scheduling]]
