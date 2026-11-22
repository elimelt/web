"""Exact expected search costs that bench.cc's counters measure.

Skip list (levels 1 + Geometric, P[height > i] = p^i), searching for the m-th
smallest of n keys and counting, as bench.cc does, every key comparison: one
per horizontal move, one that ends each level whose next pointer exists, and a
final equality test. Element j < m is moved to on level i (0-based) exactly when
its height is i + 1 and no element in (j, m) is taller than i + 1, and level i
ends with a comparison when some element in [m, n] is taller than i, so

  E[C_m] = 1 + sum_i [ ((1 - p)/p) (1 - (1 - p^(i+1))^(m-1)) + 1 - (1 - p^i)^(n-m+1) ].

Treap (a random binary search tree): the m-th key's depth, root at depth 1, has
expectation H_m + H_(n-m+1) - 1, and the mean over keys is 2(1 + 1/n) H_n - 3.

Usage: python3 -I theory9.py   (prints the means over all keys)
"""
import math

MAXL = 40


def skip_mean(n, p):
    tot = 1.0 * n
    for i in range(MAXL):
        # With x = p^(i+1): sum over m of 1 - (1 - x)^(m-1) = n - (1 - (1 - x)^n) / x.
        x = p ** (i + 1)
        a = n + math.expm1(n * math.log1p(-x)) / x
        # With y = p^i: sum over m of 1 - (1 - y)^(n-m+1) = n - (1 - y)(1 - (1 - y)^n) / y.
        y = p ** i
        b = n if y == 1 else n + (1 - y) * math.expm1(n * math.log1p(-y)) / y
        tot += (1 - p) / p * a + b
    return tot / n


def harmonic(n):
    if n < 10 ** 6:
        return sum(1 / k for k in range(1, n + 1))
    return math.log(n) + 0.5772156649015329 + 1 / (2 * n) - 1 / (12 * n * n)


def treap_mean(n):
    return 2 * (1 + 1 / n) * harmonic(n) - 3


if __name__ == "__main__":
    for n in (10 ** 5, 10 ** 6, 10 ** 7):
        print(n, "skip p=1/2 %.3f" % skip_mean(n, 0.5), "p=1/4 %.3f" % skip_mean(n, 0.25),
              "pugh bound p=1/2 %.3f p=1/4 %.3f" % (math.log(n, 2) / 0.5 + 2 + 1, math.log(n, 4) / 0.25 + 4 / 3 + 1),
              "treap depth %.3f" % treap_mean(n))
