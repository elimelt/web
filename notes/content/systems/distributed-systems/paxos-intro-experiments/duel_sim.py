"""Discrete-event simulation (not a real network) of Paxos proposers competing
for one slot. Proposer 0 starts at t=0, proposer 1 at a uniform time in [0, 2).
Acceptors follow the Phase 1b/2b rules and answer a rejected 1a or 2a with a
NACK carrying the ballot they have promised. A proposer that receives a NACK
for its current ballot abandons the round and, after a backoff, retries with
the smallest ballot of its own above every ballot it has seen. One-way message
delay = 0.5 + Exp(mean 0.5): mean 1 time unit.
Policies:
  leader  only proposer 0 proposes (a distinguished proposer)
  fixed   retry immediately (backoff 0)
  random  retry after a backoff uniform in [0, BACKOFF) time units
A run that has chosen nothing by t=HORIZON counts as undecided.

usage: python3 duel_sim.py BATCHES RUNS_PER_BATCH [BACKOFF]
"""
import heapq, random, statistics, sys

HORIZON = 1000.0

def run(seed, policy, backoff=4.0):
    rng = random.Random(seed)
    delay = lambda: 0.5 + rng.expovariate(2.0)
    acc = [{"promised": -1, "vb": -1, "v": None} for _ in range(3)]
    votes = {}
    q, seq = [], 0
    def push(t, ev):
        nonlocal seq; seq += 1; heapq.heappush(q, (t, seq, ev))
    props = {}
    rounds = 0
    def start(p, t, seen):
        nonlocal rounds
        rounds += 1
        b = (seen // 2 + 1) * 2 + p if seen >= 0 else p
        while b <= seen: b += 2
        props[p] = {"b": b, "promises": {}, "sent2a": False, "seen": max(seen, b)}
        for a in range(3):
            push(t + delay(), ("1a", a, p, b))
    def retry(p, t, seen):
        wait = 0.0 if policy == "fixed" else rng.uniform(0, backoff)
        push(t + wait, ("start", p, seen))
    push(0.0, ("start", 0, -1))
    if policy != "leader":
        push(rng.uniform(0, 2), ("start", 1, -1))
    while q:
        t, _, ev = heapq.heappop(q)
        if t > HORIZON:
            return None, rounds
        k = ev[0]
        if k == "start":
            start(ev[1], t, ev[2])
        elif k == "1a":
            _, a, p, b = ev
            if b > acc[a]["promised"]:
                acc[a]["promised"] = b
                push(t + delay(), ("1b", p, b, a, acc[a]["vb"], acc[a]["v"]))
            else:
                push(t + delay(), ("nack", p, b, acc[a]["promised"]))
        elif k == "1b":
            _, p, b, a, vb, v = ev
            st = props[p]
            if st["b"] != b or st["sent2a"]:
                continue
            st["promises"][a] = (vb, v)
            if len(st["promises"]) >= 2:
                st["sent2a"] = True
                prev = [x for x in st["promises"].values() if x[0] >= 0]
                val = max(prev)[1] if prev else f"v{p}"
                for a2 in range(3):
                    push(t + delay(), ("2a", a2, p, b, val))
        elif k == "2a":
            _, a, p, b, val = ev
            if b >= acc[a]["promised"]:
                acc[a].update(promised=b, vb=b, v=val)
                votes.setdefault(b, set()).add(a)
                if len(votes[b]) >= 2:
                    return t, rounds
            else:
                push(t + delay(), ("nack", p, b, acc[a]["promised"]))
        elif k == "nack":
            _, p, b, seen = ev
            st = props[p]
            if st["b"] == b and seen > b:
                st["b"] = None  # abandon this round
                retry(p, t, max(st["seen"], seen))
    return None, rounds

def batch(policy, lo, hi, backoff):
    ts, rs, undecided = [], [], 0
    for seed in range(lo, hi):
        t, r = run(seed, policy, backoff)
        rs.append(r)
        if t is None: undecided += 1
        else: ts.append(t)
    ts.sort(); rs.sort()
    q = lambda xs, p: xs[min(len(xs) - 1, int(p * len(xs)))]
    return {"p50": q(ts, .5), "p99": q(ts, .99), "max": ts[-1], "rounds_mean": statistics.mean(rs),
            "rounds_p99": q(rs, .99), "rounds_max": rs[-1], "undecided": undecided}

if __name__ == "__main__":
    batches, n = int(sys.argv[1]), int(sys.argv[2])
    backoff = float(sys.argv[3]) if len(sys.argv) > 3 else 4.0
    print(f"{batches} batches x {n} runs, backoff U[0,{backoff}); ranges are min-max over batches")
    for policy in ("leader", "fixed", "random"):
        bs = [batch(policy, k * n, (k + 1) * n, backoff) for k in range(batches)]
        f = lambda key: f"{min(b[key] for b in bs):.2f}-{max(b[key] for b in bs):.2f}"
        print(f"{policy:6s} time p50 {f('p50')}  p99 {f('p99')}  max {f('max')} | rounds mean {f('rounds_mean')}"
              f"  p99 {f('rounds_p99')}  max {f('rounds_max')} | undecided {sum(b['undecided'] for b in bs)}")
