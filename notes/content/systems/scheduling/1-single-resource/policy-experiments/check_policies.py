"""Checks policies.py against independent references.

1. A time-stepped simulator (step dt) that applies each policy's rule
   directly: who runs and at what rate, recomputed every step.
2. Closed forms: M/M/1 mean response 1/(mu - lambda) under FIFO and PS;
   M/G/1-PS mean response of a size-x job x/(1 - rho); M/G/1-FIFO mean from
   the Pollaczek-Khinchine formula.
3. SRPT's optimality: on every instance its total response is the smallest of
   all policies.

Run: python3 check_policies.py   (about a minute)
"""
import random
import statistics
import sys

import policies as P


def stepped(arr, size, rule, dt):
    n = len(arr)
    rem = list(size)
    att = [0.0] * n
    done = [None] * n
    t = 0.0
    while any(d is None for d in done):
        live = [j for j in range(n) if arr[j] <= t + 1e-12 and done[j] is None]
        if live:
            share = rule(live, rem, att, arr)
            for j, r in share.items():
                rem[j] -= r * dt
                att[j] += r * dt
        t += dt
        for j in live:
            if done[j] is None and rem[j] <= 1e-9:
                done[j] = t
    return done


def stepped_mlfq(arr, size, q0, levels, boost, dt):
    """Applies OSTEP's rules every dt with explicit queues, eagerly boosting."""
    from collections import deque
    n = len(arr)
    quanta = [q0 * 2 ** k for k in range(levels)]
    rem = list(size)
    left = [0.0] * n
    qs = [deque() for _ in range(levels)]
    done = [None] * n
    t = 0.0
    i = 0
    nb = boost
    steps = 0
    while any(d is None for d in done):
        while i < n and arr[i] <= t + 1e-9:
            qs[0].append(i)
            left[i] = quanta[0]
            i += 1
        ks = [k for k in range(levels) if qs[k]]
        if ks:
            k = ks[0]
            j = qs[k][0]
            rem[j] -= dt
            left[j] -= dt
            if rem[j] <= 1e-9:
                qs[k].popleft()
                done[j] = t + dt
            elif left[j] <= 1e-9:
                qs[k].popleft()
                nk = min(k + 1, levels - 1)
                left[j] = quanta[nk]
                qs[nk].append(j)
        t += dt
        steps += 1
        if t >= nb - 1e-9:
            order = [x for q in qs for x in q]
            for q in qs:
                q.clear()
            qs[0].extend(order)
            for x in order:
                left[x] = quanta[0]
            nb += boost
    return done


def rule_fifo(live, rem, att, arr):
    return {min(live, key=lambda j: (arr[j], j)): 1.0}


def rule_srpt(live, rem, att, arr):
    return {min(live, key=lambda j: (rem[j], arr[j], j)): 1.0}


def rule_ps(live, rem, att, arr):
    return {j: 1.0 / len(live) for j in live}


def rule_fb(live, rem, att, arr):
    lo = min(att[j] for j in live)
    grp = [j for j in live if att[j] <= lo + 1e-9]
    return {j: 1.0 / len(grp) for j in grp}


def close(a, b, tol):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def main():
    fails = 0
    rng = random.Random(1)
    dt = 1 / 64
    for trial in range(60):
        n = rng.randint(2, 7)
        arr = sorted(rng.randint(0, 12) * 0.5 for _ in range(n))
        size = [rng.randint(1, 16) * 0.25 for _ in range(n)]
        for name, fn, rule in [
            ("fifo", P.fifo, rule_fifo),
            ("srpt", P.srpt, rule_srpt),
            ("ps", P.ps, rule_ps),
            ("fb", P.fb, rule_fb),
        ]:
            got = fn(arr, size)
            ref = stepped(arr, size, rule, dt)
            if not close(got, ref, 2 * n * dt):
                fails += 1
                print("MISMATCH", name, arr, size, got, ref)
        # MLFQ with boosts against the stepped reference.
        got = P.mlfq(arr, size, 0.25, 4, boost=2.0)
        ref = stepped_mlfq(arr, size, 0.25, 4, 2.0, dt)
        if not close(got, ref, 2 * n * dt):
            fails += 1
            print("MISMATCH mlfq", arr, size, got, ref)
        # SRPT has the least total response of every policy here.
        resp = lambda d: sum(c - a for c, a in zip(d, arr))
        best = resp(P.srpt(arr, size))
        for fn in [P.fifo, P.sjf, P.ps, P.fb, lambda a, s: P.rr(a, s, 0.5),
                   lambda a, s: P.mlfq(a, s, 0.25, 4, 3.0),
                   lambda a, s: P.srpt_estimates(a, s, [x * rng.uniform(0.3, 3) for x in s]),
                   lambda a, s: P.srpt_bounce(a, s, [x * rng.uniform(0.3, 3) for x in s])]:
            if resp(fn(arr, size)) < best - 1e-9:
                fails += 1
                print("SRPT beaten", arr, size)
        # RR with a quantum smaller than every size step approaches PS.
        rrd = P.rr(arr, size, 1 / 256)
        if not close(rrd, P.ps(arr, size), 0.05 * n):
            fails += 1
            print("RR far from PS", arr, size)
        # MLFQ with equal tiny quanta, a level per quantum and no boost
        # approaches FB.
        md = P.mlfq(arr, size, 1 / 128, 600, growth=1.0)
        if not close(md, P.fb(arr, size), 0.05 * n):
            fails += 1
            print("MLFQ far from FB", arr, size, md, P.fb(arr, size))
        # Exact estimates make SRPT-Bounce identical to SRPT.
        if not close(P.srpt_bounce(arr, size, size), P.srpt(arr, size), 1e-9):
            fails += 1
            print("bounce != srpt", arr, size)
        # Exact estimates make srpt_estimates identical to SRPT.
        if not close(P.srpt_estimates(arr, size, size), P.srpt(arr, size), 1e-9):
            fails += 1
            print("estimates != srpt", arr, size)

    # Closed forms.
    rng = random.Random(7)
    lam, mu, n = 0.7, 1.0, 400_000
    t = 0.0
    arr, size = [], []
    for _ in range(n):
        t += rng.expovariate(lam)
        arr.append(t)
        size.append(rng.expovariate(mu))
    mm1 = 1 / (mu - lam)
    for name, fn in [("fifo", P.fifo), ("ps", P.ps)]:
        d = fn(arr, size)
        m = statistics.fmean(c - a for c, a in zip(d, arr))
        ok = abs(m / mm1 - 1) < 0.03
        fails += not ok
        print(f"M/M/1 {name}: mean {m:.4f} vs {mm1:.4f} {'ok' if ok else 'FAIL'}")
    # M/G/1 with a two-point size distribution: PS slowdown is flat.
    rng = random.Random(9)
    sizes = [0.5, 10.0]
    probs = [0.95, 0.05]
    es = sum(s * p for s, p in zip(sizes, probs))
    es2 = sum(s * s * p for s, p in zip(sizes, probs))
    rho = 0.6
    lam = rho / es
    t = 0.0
    arr, size = [], []
    for _ in range(n):
        t += rng.expovariate(lam)
        arr.append(t)
        size.append(sizes[0] if rng.random() < probs[0] else sizes[1])
    d = P.ps(arr, size)
    for s in sizes:
        m = statistics.fmean(c - a for c, a, x in zip(d, arr, size) if x == s)
        ok = abs(m / (s / (1 - rho)) - 1) < 0.04
        fails += not ok
        print(f"M/G/1-PS size {s}: {m:.3f} vs {s / (1 - rho):.3f} {'ok' if ok else 'FAIL'}")
    d = P.fifo(arr, size)
    m = statistics.fmean(c - a for c, a in zip(d, arr))
    pk = es + lam * es2 / (2 * (1 - rho))
    ok = abs(m / pk - 1) < 0.04
    fails += not ok
    print(f"M/G/1-FIFO (P-K): {m:.3f} vs {pk:.3f} {'ok' if ok else 'FAIL'}")
    print("failures:", fails)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
