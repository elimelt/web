"""Exhaustive breadth-first check of single-decree Paxos, transcribing the
actions of Lamport's TLA+ spec (tlaplus/Examples, specifications/Paxos/Paxos.tla):
messages are a set that only grows, so a message can be lost (never acted on),
delayed, reordered or duplicated. Mutants weaken one rule each.

usage: python3 paxos_check.py MAXBALLOT [mutant]
mutants: none | ignore_votes | accept_below_promise | minority_quorum | no_persist
"""
import sys, time
from collections import deque
from itertools import combinations

A = (0, 1, 2)
VALS = (1, 2)

def quorums(mutant):
    if mutant == "minority_quorum":   # {a0,a1} and {a2}: two quorums that don't intersect
        return [frozenset({0, 1}), frozenset({2})]
    return [frozenset(q) for q in combinations(A, 2)]

def check(maxb, mutant="none"):
    Q = quorums(mutant)
    B = range(maxb + 1)
    # state: (maxBal tuple, maxVBal tuple, maxVal tuple, msgs frozenset)
    init = ((-1,) * 3, (-1,) * 3, (None,) * 3, frozenset())
    parent = {init: None}
    frontier = deque([init])
    depth = {init: 0}

    def chosen(msgs):
        out = set()
        for b in B:
            for v in VALS:
                voters = {m[1] for m in msgs if m[0] == "2b" and m[2] == b and m[3] == v}
                if any(q <= voters for q in Q):
                    out.add(v)
        return out

    def succ(s):
        mb, mvb, mv, msgs = s
        out = []
        for b in B:  # Phase1a
            m = ("1a", b)
            if m not in msgs:
                out.append((f"1a b={b}", (mb, mvb, mv, msgs | {m})))
        for m in msgs:
            if m[0] == "1a":
                b = m[1]
                for a in A:  # Phase1b
                    if b > mb[a]:
                        nb = list(mb); nb[a] = b
                        rep_b, rep_v = (mvb[a], mv[a])
                        nm = ("1b", a, b, rep_b, rep_v)
                        # a crash-restart that loses the promise: maxBal not persisted
                        keep = mb if mutant == "no_persist" else tuple(nb)
                        out.append((f"1b a{a} b={b}", (keep, mvb, mv, msgs | {nm})))
        for b in B:  # Phase2a
            if any(m[0] == "2a" and m[1] == b for m in msgs):
                continue
            ok_vals = set()
            for q in Q:
                ones = {m[1]: m for m in msgs if m[0] == "1b" and m[2] == b and m[1] in q}
                if set(ones) != set(q):
                    continue
                voted = [m for m in ones.values() if m[3] >= 0]
                if not voted or mutant == "ignore_votes":
                    ok_vals.update(VALS)
                else:
                    top = max(m[3] for m in voted)
                    ok_vals.update(m[4] for m in voted if m[3] == top)
            for v in ok_vals:
                out.append((f"2a b={b} v={v}", (mb, mvb, mv, msgs | {("2a", b, v)})))
        for m in msgs:  # Phase2b
            if m[0] == "2a":
                _, b, v = m
                for a in A:
                    if b >= mb[a] or mutant == "accept_below_promise":
                        nb = list(mb); nb[a] = max(b, mb[a]) if mutant == "accept_below_promise" else b
                        nvb = list(mvb); nvb[a] = b
                        nv = list(mv); nv[a] = v
                        out.append((f"2b a{a} b={b} v={v}", (tuple(nb), tuple(nvb), tuple(nv), msgs | {("2b", a, b, v)})))
        return out

    t0 = time.time()
    while frontier:
        s = frontier.popleft()
        if len(chosen(s[3])) > 1:
            trace = []
            while s is not None:
                trace.append(s)
                s = parent[s][0] if parent[s] else None
            return {"states": len(parent), "violation": True, "trace": violation_trace(parent, trace[0]), "secs": time.time() - t0}
        for label, t in succ(s):
            if t not in parent:
                parent[t] = (s, label)
                frontier.append(t)
    return {"states": len(parent), "violation": False, "secs": time.time() - t0}

def violation_trace(parent, s):
    steps = []
    while parent[s] is not None:
        prev, label = parent[s]
        steps.append(label)
        s = prev
    return steps[::-1]

if __name__ == "__main__":
    maxb = int(sys.argv[1]); mutant = sys.argv[2] if len(sys.argv) > 2 else "none"
    r = check(maxb, mutant)
    print(f"maxBallot={maxb} mutant={mutant} distinct_states={r['states']} violation={r['violation']} secs={r['secs']:.1f}")
    if r["violation"]:
        print(f"shortest counterexample: {len(r['trace'])} steps")
        for x in r["trace"]:
            print("  ", x)
