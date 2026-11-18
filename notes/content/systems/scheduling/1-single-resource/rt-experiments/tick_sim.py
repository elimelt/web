"""Discrete-time reference simulator for preemptive RM and EDF on one
processor (integer C and T, implicit deadlines D = T, synchronous release,
late jobs run to completion). Used to check the figure's TypeScript model.

  python3 tick_sim.py                 # print the separating example
  python3 tick_sim.py --fixtures ../../../../../quartz-site/plugins/mdx/test/rt-schedule.fixture.json
"""
import argparse, json, math, random
from functools import reduce

def lcm(a, b): return a * b // math.gcd(a, b)

def simulate(tasks, policy, horizon=None):
    """tasks: [(C, T)]. Returns (schedule list of task index or -1, misses).
    misses: list of (task, job index, deadline, finish)."""
    H = horizon or reduce(lcm, [t for _, t in tasks])
    jobs = []  # [task, k, release, deadline, remaining, finish]
    sched, misses = [], []
    for t in range(H):
        for i, (c, p) in enumerate(tasks):
            if t % p == 0:
                jobs.append([i, t // p, t, t + p, c, None])
        ready = [j for j in jobs if j[4] > 0]
        if not ready:
            sched.append(-1); continue
        if policy == "rm":
            key = lambda j: (tasks[j[0]][1], j[0], j[1])
        else:
            key = lambda j: (j[3], j[2], j[0])
        j = min(ready, key=key)
        sched.append(j[0])
        j[4] -= 1
        if j[4] == 0:
            j[5] = t + 1
    for j in jobs:
        fin = j[5]
        if fin is None or fin > j[3]:
            if fin is not None or j[3] <= H:
                misses.append((j[0], j[1], j[3], fin))
    return sched, misses

def rta(tasks):
    """Response-time analysis in RM order. Returns per task (iterates, ok)."""
    order = sorted(range(len(tasks)), key=lambda i: (tasks[i][1], i))
    out = {}
    for pos, i in enumerate(order):
        c, t = tasks[i]
        hp = [tasks[j] for j in order[:pos]]
        r, its = c, [c]
        while True:
            nr = c + sum(math.ceil(r / tj) * cj for cj, tj in hp)
            its.append(nr)
            if nr > t: out[i] = (its, False); break
            if nr == r: out[i] = (its[:-1], True); break
            r = nr
    return [out[i] for i in range(len(tasks))]

def text(s): return "".join("." if x < 0 else str(x + 1) for x in s)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--fixtures"); a = ap.parse_args()
    if not a.fixtures:
        ex = [(2, 5), (4, 7)]
        for pol in ("rm", "edf"):
            s, m = simulate(ex, pol)
            print(pol, text(s), m)
        print(rta(ex))
    else:
        rng = random.Random(7); cases = []
        while len(cases) < 250:
            n = rng.randint(1, 3)
            ts = [(None, rng.randint(2, 12)) for _ in range(n)]
            ts = [(rng.randint(1, t), t) for _, t in ts]
            if reduce(lcm, [t for _, t in ts]) > 120: continue
            row = {"tasks": ts, "rta": [[its, ok] for its, ok in rta(ts)]}
            for pol in ("rm", "edf"):
                s, m = simulate(ts, pol)
                row[pol] = {"schedule": s, "misses": [list(x) for x in m]}
            cases.append(row)
        json.dump(cases, open(a.fixtures, "w"), separators=(",", ":"))
        print(len(cases), "cases")
