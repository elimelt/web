"""Brute-force reference for checkers.py: enumerate every permutation and
test the definitions literally. Only for histories of about eight
operations or fewer.
"""

from itertools import permutations


def _legal(seq, ops, init):
    value = init
    for i in seq:
        op = ops[i]
        if op["kind"] == "w":
            value = op["v"]
        elif op["v"] != value:
            return False
    return True


def _respects(seq, pairs):
    pos = {i: k for k, i in enumerate(seq)}
    return all(pos[a] < pos[b] for a, b in pairs if a in pos and b in pos)


def _program_pairs(ops):
    return [
        (a, b)
        for a in range(len(ops))
        for b in range(len(ops))
        if a != b and ops[a]["p"] == ops[b]["p"] and ops[a]["call"] < ops[b]["call"]
    ]


def linearizable(ops, init=0):
    rt = [
        (a, b)
        for a in range(len(ops))
        for b in range(len(ops))
        if a != b and ops[a]["ret"] is not None and ops[a]["ret"] >= 0 and ops[a]["ret"] < ops[b]["call"]
    ]
    return any(_legal(s, ops, init) and _respects(s, rt) for s in permutations(range(len(ops))))


def sequential(ops, init=0):
    po = _program_pairs(ops)
    return any(_legal(s, ops, init) and _respects(s, po) for s in permutations(range(len(ops))))


def causal(ops, init=0):
    n = len(ops)
    rel = set(_program_pairs(ops))
    for b, rd in enumerate(ops):
        if rd["kind"] != "r" or rd["v"] == init:
            continue
        ws = [a for a, w in enumerate(ops) if w["kind"] == "w" and w["v"] == rd["v"]]
        if not ws:
            return False
        rel.add((ws[0], b))
    # Transitive closure, Floyd-Warshall style.
    reach = [[(a, b) in rel for b in range(n)] for a in range(n)]
    for k in range(n):
        for a in range(n):
            if reach[a][k]:
                for b in range(n):
                    if reach[k][b]:
                        reach[a][b] = True
    pairs = [(a, b) for a in range(n) for b in range(n) if reach[a][b]]
    if any(reach[a][a] for a in range(n)):
        return False
    for p in {op["p"] for op in ops}:
        view = [i for i in range(n) if ops[i]["kind"] == "w" or ops[i]["p"] == p]
        if not any(_legal(s, ops, init) and _respects(s, pairs) for s in permutations(view)):
            return False
    return True
