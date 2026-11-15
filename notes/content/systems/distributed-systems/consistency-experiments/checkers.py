"""Consistency checkers for histories of one read/write register.

A history is a list of operations, each a dict with
    p     process (client) index
    kind  "w" or "r"
    v     the value written, or the value the read returned
    call  invocation time
    ret   response time (None, or a negative number, if the write's outcome
          is unknown)
Written values are unique and differ from the initial value `init`.

Three models are checked:

linearizable(ops)  Herlihy and Wing (1990): some total order of all
    operations is a legal register execution and respects real time
    (a before b whenever a.ret < b.call; intervals are closed, as in
    Porcupine). The search is Wing and Gong's (1993): repeatedly linearize
    one of the operations that are minimal in real-time order, backtracking
    on failure, with Lowe's (2017) cache of (linearized set, register value)
    configurations already explored.

sequential(ops)  Lamport (1979): some total order of all operations is a
    legal register execution and respects each process's program order.
    For one register the only state that matters is how far each process
    has advanced and the register's value, so a memoized search over those
    configurations decides it.

causal(ops)  Causal memory, Ahamad, Neiger, Burns, Kohli and Hutto (1995):
    causal order is the transitive closure of program order and the
    writes-into relation (a write precedes every read that returns its
    value). The history is causal if, for every process p, the operations
    of p together with all writes have a legal total order that respects
    causal order.

Each returns (ok, witness): a witness order (list of operation indices) when
ok, else None. For causal the witness is a dict of per-process orders.
"""

from __future__ import annotations

import math


def _ret(op):
    r = op.get("ret")
    return math.inf if r is None or r < 0 else r


def _legal_values(ops, init):
    written = {op["v"] for op in ops if op["kind"] == "w"}
    return all(op["kind"] == "w" or op["v"] == init or op["v"] in written for op in ops)


def linearizable(ops, init=0):
    n = len(ops)
    if not _legal_values(ops, init):
        return False, None
    calls = [op["call"] for op in ops]
    rets = [_ret(op) for op in ops]
    full = (1 << n) - 1
    seen = set()
    order = []

    def search(done, value):
        if done == full:
            return True
        if (done, value) in seen:
            return False
        seen.add((done, value))
        # An operation can be linearized next only if no pending operation
        # returned before it was called.
        earliest = min(rets[i] for i in range(n) if not done >> i & 1)
        for i in range(n):
            if done >> i & 1 or calls[i] > earliest:
                continue
            op = ops[i]
            if op["kind"] == "r" and op["v"] != value:
                continue
            nxt = op["v"] if op["kind"] == "w" else value
            order.append(i)
            if search(done | 1 << i, nxt):
                return True
            order.pop()
        return False

    ok = search(0, init)
    return ok, (list(order) if ok else None)


def program_order(ops):
    """Per process, operation indices in invocation order."""
    by = {}
    for i, op in enumerate(ops):
        by.setdefault(op["p"], []).append(i)
    return [sorted(ix, key=lambda i: ops[i]["call"]) for _, ix in sorted(by.items())]


def sequential(ops, init=0):
    if not _legal_values(ops, init):
        return False, None
    seqs = program_order(ops)
    k = len(seqs)
    end = tuple(len(s) for s in seqs)
    seen = set()
    order = []

    def search(pos, value):
        if pos == end:
            return True
        if (pos, value) in seen:
            return False
        seen.add((pos, value))
        for q in range(k):
            if pos[q] == end[q]:
                continue
            i = seqs[q][pos[q]]
            op = ops[i]
            if op["kind"] == "r" and op["v"] != value:
                continue
            nxt = op["v"] if op["kind"] == "w" else value
            order.append(i)
            if search(pos[:q] + (pos[q] + 1,) + pos[q + 1 :], nxt):
                return True
            order.pop()
        return False

    ok = search(tuple(0 for _ in range(k)), init)
    return ok, (list(order) if ok else None)


def causal_order(ops, init=0):
    """before[i] is the bitmask of operations causally before operation i,
    or None if the causal order has a cycle."""
    n = len(ops)
    direct = [0] * n
    for seq in program_order(ops):
        for a, b in zip(seq, seq[1:]):
            direct[b] |= 1 << a
    writer = {op["v"]: i for i, op in enumerate(ops) if op["kind"] == "w"}
    for i, op in enumerate(ops):
        if op["kind"] == "r" and op["v"] != init:
            direct[i] |= 1 << writer[op["v"]]
    before = list(direct)
    changed = True
    while changed:  # transitive closure by fixed point
        changed = False
        for i in range(n):
            acc = before[i]
            m = before[i]
            while m:
                j = (m & -m).bit_length() - 1
                m &= m - 1
                acc |= before[j]
            if acc != before[i]:
                before[i] = acc
                changed = True
    if any(before[i] >> i & 1 for i in range(n)):
        return None
    return before


def causal(ops, init=0):
    if not _legal_values(ops, init):
        return False, None
    before = causal_order(ops, init)
    if before is None:
        return False, None
    n = len(ops)
    writes = [i for i in range(n) if ops[i]["kind"] == "w"]
    witness = {}
    for p in sorted({op["p"] for op in ops}):
        members = sorted(set(writes) | {i for i in range(n) if ops[i]["p"] == p})
        mask_all = 0
        for i in members:
            mask_all |= 1 << i
        seen = set()
        order = []

        def search(done, value):
            if done == mask_all:
                return True
            if (done, value) in seen:
                return False
            seen.add((done, value))
            for i in members:
                if done >> i & 1:
                    continue
                if before[i] & mask_all & ~done:
                    continue  # a causal predecessor in this view is not placed yet
                op = ops[i]
                if op["kind"] == "r" and op["v"] != value:
                    continue
                order.append(i)
                if search(done | 1 << i, op["v"] if op["kind"] == "w" else value):
                    return True
                order.pop()
            return False

        if not search(0, init):
            return False, None
        witness[p] = list(order)
    return True, witness


def classify(ops, init=0):
    lin = linearizable(ops, init)[0]
    sc = sequential(ops, init)[0]
    cc = causal(ops, init)[0]
    return {"linearizable": lin, "sequential": sc, "causal": cc}
