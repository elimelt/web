"""Independent reference for the skip list and treap figure (components/skiplist-treap).

Usage: python3 -I figure_ref.py DIR
Reads DIR/titles.json and writes DIR/figure-check.json: for several seeds and
values of p, the drawn skip list's levels and the search steps for every drawn
key, the drawn treap's depths, and the comparisons for all 2,000 titles in
both structures, computed here by building the structures with explicit nodes
and pointers. Also records the exact expectations for a few positions.
"""
import json
import sys

M32 = 0xFFFFFFFF
MAXL = 40
SMALL = 16


def mulberry32(seed):
    a = seed & M32

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & M32
        t = ((a ^ (a >> 15)) * (1 | a)) & M32
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & M32)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296.0
    return nxt


def part_seed(base, part):
    return ((base * 0x9E3779B1) + part) & M32


class Node:
    def __init__(self, key, level):
        self.key, self.next = key, [None] * level


def skip_list(order, p, rnd):
    """Inserts the keys in order into a pointer-based skip list, as in Pugh (1990)."""
    head = Node(-1, MAXL)
    level = 1
    levels = {}
    for k in order:
        lv = 1
        while lv < MAXL and rnd() < p:
            lv += 1
        levels[k] = lv
        upd, x = [head] * MAXL, head
        for i in range(level - 1, -1, -1):
            while x.next[i] is not None and x.next[i].key < k:
                x = x.next[i]
            upd[i] = x
        level = max(level, lv)
        n = Node(k, lv)
        for i in range(lv):
            n.next[i], upd[i].next[i] = upd[i].next[i], n
    return head, level, levels


def skip_search(head, level, k):
    x, cmps, steps = head, 0, []
    for i in range(level - 1, -1, -1):
        while x.next[i] is not None:
            cmps += 1
            y = x.next[i]
            if y.key < k:
                steps.append([i, y.key, 1])
                x = y
            else:
                steps.append([i, y.key, 0])
                break
    return cmps + 1, steps


def treap(order, rnd):
    """Inserts the keys in order into a treap by descent and rotations (Seidel and Aragon 1996)."""
    root = None

    def ins(t, k, pr):
        if t is None:
            return {"k": k, "p": pr, "l": None, "r": None}
        if k < t["k"]:
            t["l"] = ins(t["l"], k, pr)
            if t["l"]["p"] > t["p"]:
                c = t["l"]; t["l"] = c["r"]; c["r"] = t; return c
        else:
            t["r"] = ins(t["r"], k, pr)
            if t["r"]["p"] > t["p"]:
                c = t["r"]; t["r"] = c["l"]; c["l"] = t; return c
        return t
    sys.setrecursionlimit(100000)
    for k in order:
        root = ins(root, k, rnd())
    depth = {}
    todo = [(root, 1)]
    while todo:
        t, d = todo.pop()
        if t is None:
            continue
        depth[t["k"]] = d
        todo += [(t["l"], d + 1), (t["r"], d + 1)]
    return depth


def skip_expected(n, p, m):
    return 1 + sum((1 - p) / p * (1 - (1 - p ** (i + 1)) ** (m - 1)) + 1 - (1 - p ** i) ** (n - m + 1) for i in range(MAXL))


def treap_expected(n, m):
    h = lambda x: sum(1 / j for j in range(1, x + 1))
    return h(m) + h(n - m + 1) - 1


D = sys.argv[1]
order = json.load(open(f"{D}/titles.json"))["order"]
n = len(order)
cases = []
for base, p in [(1, 0.5), (2, 0.5), (7, 0.25), (12345, 0.5), (99, 0.25)]:
    first = order[:SMALL]
    small_keys = sorted(first)
    small_order = [small_keys.index(k) for k in first]
    head, level, levels = skip_list(small_order, p, mulberry32(part_seed(base, 0)))
    small = [skip_search(head, level, m) for m in range(SMALL)]
    sdepth = treap(small_order, mulberry32(part_seed(base, 1)))
    head, level, _ = skip_list(order, p, mulberry32(part_seed(base, 2)))
    cost = [skip_search(head, level, m)[0] for m in range(n)]
    depth = treap(order, mulberry32(part_seed(base, 3)))
    cases.append({"base": base, "p": p, "smallKeys": small_keys,
                  "smallLevels": [levels[k] for k in range(SMALL)],
                  "smallCost": [c for c, _ in small], "smallSteps": [s for _, s in small],
                  "smallDepth": [sdepth[k] for k in range(SMALL)],
                  "skipCost": cost, "treapDepth": [depth[k] for k in range(n)]})
expected = [{"n": nn, "p": p, "m": m, "skip": skip_expected(nn, p, m), "treap": treap_expected(nn, m)}
            for nn in (16, 2000) for p in (0.5, 0.25) for m in (1, 2, nn // 2, nn)]
json.dump({"n": n, "cases": cases, "expected": expected}, open(f"{D}/figure-check.json", "w"), separators=(",", ":"))
print(n, len(cases))
