#!/usr/bin/env python3
"""Queueing experiments for the note "Queueing Models and Tail Latency".

Each experiment simulates queues job by job and compares the measured mean and
tail of response time with closed forms where they exist. Every configuration
runs with several seeds; the JSON output records the per-seed values so the
spread can be recomputed.

Run from notes/:

    python3 content/systems/scheduling/0-foundations/queueing-lab/queue_experiments.py

Time is in units of the mean service time (E[S] = 1). Response time is the
time from a job's arrival to its completion. The first 10% of jobs in every
run are dropped as warm-up, since each run starts with empty queues.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import os
import platform
import sys
import time
from collections import deque
from concurrent.futures import ProcessPoolExecutor

import numpy as np

WARMUP = 0.10
T_95_4 = 2.776  # two-sided 95% t quantile, 4 degrees of freedom (5 seeds)

# --- service-time distributions (mean 1) ------------------------------------

BIMODAL_P = 0.005  # one job in 200 is long
BIMODAL_RATIO = 50.0  # and takes 50 times as long as a short one
BIMODAL_SHORT = 1.0 / (1.0 - BIMODAL_P + BIMODAL_P * BIMODAL_RATIO)
BIMODAL_LONG = BIMODAL_SHORT * BIMODAL_RATIO


def service_moments(dist: str) -> tuple[float, float]:
    """E[S], E[S^2]."""
    if dist == "exp":
        return 1.0, 2.0
    if dist == "det":
        return 1.0, 1.0
    if dist == "bimodal":
        return 1.0, (1 - BIMODAL_P) * BIMODAL_SHORT**2 + BIMODAL_P * BIMODAL_LONG**2
    raise ValueError(dist)


def draw_service(rng: np.random.Generator, dist: str, n: int) -> np.ndarray:
    if dist == "exp":
        return rng.exponential(1.0, n)
    if dist == "det":
        return np.ones(n)
    if dist == "bimodal":
        return np.where(rng.random(n) < BIMODAL_P, BIMODAL_LONG, BIMODAL_SHORT)
    raise ValueError(dist)


# --- closed forms --------------------------------------------------------------


def erlang_c(c: int, a: float) -> float:
    """Probability an arrival waits in M/M/c with offered load a = lambda/mu."""
    # Erlang B by its stable recurrence, then convert to Erlang C.
    b = 1.0
    for k in range(1, c + 1):
        b = a * b / (k + a * b)
    rho = a / c
    return b / (1 - rho + rho * b)


def mmc_response_ccdf(t: float, c: int, rho: float) -> float:
    """P(R > t) for M/M/c FCFS with mu = 1. R = W + S, W is 0 w.p. 1-C, else Exp(c - lambda)."""
    lam = rho * c
    pc = erlang_c(c, lam)
    theta = c - lam
    if abs(theta - 1.0) < 1e-12:
        tail_ws = (1 + t) * math.exp(-t)
    else:
        tail_ws = (theta * math.exp(-t) - math.exp(-theta * t)) / (theta - 1.0)
    return (1 - pc) * math.exp(-t) + pc * tail_ws


def mmc_response_quantile(q: float, c: int, rho: float) -> float:
    lo, hi = 0.0, 1.0
    while mmc_response_ccdf(hi, c, rho) > 1 - q:
        hi *= 2
    for _ in range(200):
        mid = (lo + hi) / 2
        if mmc_response_ccdf(mid, c, rho) > 1 - q:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def mmc_mean_response(c: int, rho: float) -> float:
    lam = rho * c
    return 1.0 + erlang_c(c, lam) / (c - lam)


def mg1_mean_response(rho: float, dist: str) -> float:
    """Pollaczek-Khinchine."""
    es, es2 = service_moments(dist)
    lam = rho / es
    return es + lam * es2 / (2 * (1 - rho))


# --- statistics ----------------------------------------------------------------


def summarize(resp: np.ndarray) -> dict:
    r = resp[int(len(resp) * WARMUP):]
    return {
        "mean": float(r.mean()),
        "p50": float(np.quantile(r, 0.50)),
        "p99": float(np.quantile(r, 0.99)),
        "p999": float(np.quantile(r, 0.999)),
    }


def across_seeds(runs: list[dict]) -> dict:
    out = {}
    for key in runs[0]:
        vals = np.array([r[key] for r in runs], dtype=float)
        half = T_95_4 * vals.std(ddof=1) / math.sqrt(len(vals)) if len(vals) == 5 else float("nan")
        out[key] = {"mean": float(vals.mean()), "ci95": float(half), "seeds": [float(v) for v in vals]}
    return out


# --- simulators ------------------------------------------------------------------


def arrivals(rng: np.random.Generator, rate: float, n: int) -> np.ndarray:
    return np.cumsum(rng.exponential(1.0 / rate, n))


def sim_dispatch(policy: str, c: int, rho: float, dist: str, n: int, seed: int) -> np.ndarray:
    """c FCFS servers. 'shared' is one queue feeding all servers; the others
    send each job to one server's own queue when it arrives."""
    rng = np.random.default_rng(seed)
    arr = arrivals(rng, rho * c, n).tolist()
    svc = draw_service(rng, dist, n).tolist()
    resp = [0.0] * n

    if policy == "shared":
        free = [0.0] * c
        heapq.heapify(free)
        for k in range(n):
            t = arr[k]
            start = max(t, free[0])
            fin = start + svc[k]
            heapq.heapreplace(free, fin)
            resp[k] = fin - t
        return np.array(resp)

    free = [0.0] * c  # time each server finishes the work assigned to it
    deps = [deque() for _ in range(c)]  # departure times of jobs still present
    picks = rng.integers(0, c, size=(n, 2)).tolist()
    ties = rng.random(n).tolist()
    for k in range(n):
        t = arr[k]
        if policy == "random":
            i = picks[k][0]
        elif policy == "rr":
            i = k % c
        elif policy in ("jsq", "jsq2", "lwl"):
            for d in deps:
                while d and d[0] <= t:
                    d.popleft()
            if policy == "jsq":
                best = min(len(d) for d in deps)
                cand = [j for j in range(c) if len(deps[j]) == best]
                i = cand[int(ties[k] * len(cand))]
            elif policy == "jsq2":
                a, b = picks[k]
                if b == a:
                    b = (a + 1 + int(ties[k] * (c - 1))) % c
                la, lb = len(deps[a]), len(deps[b])
                i = a if la < lb else b if lb < la else (a if ties[k] < 0.5 else b)
            else:
                best = min(max(f - t, 0.0) for f in free)
                cand = [j for j in range(c) if max(free[j] - t, 0.0) == best]
                i = cand[int(ties[k] * len(cand))]
        else:
            raise ValueError(policy)
        start = max(t, free[i])
        fin = start + svc[k]
        free[i] = fin
        deps[i].append(fin)
        resp[k] = fin - t
    return np.array(resp)


def sim_order(policy: str, rho: float, dist: str, n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """One server, Poisson arrivals, the given order. Returns (response, size)."""
    rng = np.random.default_rng(seed)
    arr = arrivals(rng, rho, n).tolist()
    svc = draw_service(rng, dist, n)
    sizes = svc.tolist()
    resp = [0.0] * n

    if policy == "fcfs":
        free = 0.0
        for k in range(n):
            start = max(arr[k], free)
            free = start + sizes[k]
            resp[k] = free - arr[k]
        return np.array(resp), svc

    if policy == "ps":
        # Processor sharing via virtual time: with m jobs present, each gets
        # rate 1/m, so a job finishes when virtual time V has advanced by its size.
        heap: list[tuple[float, int]] = []
        now = 0.0
        vtime = 0.0
        k = 0
        while k < n or heap:
            m = len(heap)
            next_dep = now + (heap[0][0] - vtime) * m if m else math.inf
            next_arr = arr[k] if k < n else math.inf
            if next_arr <= next_dep:
                if m:
                    vtime += (next_arr - now) / m
                now = next_arr
                heapq.heappush(heap, (vtime + sizes[k], k))
                k += 1
            else:
                vfin, j = heapq.heappop(heap)
                vtime = vfin
                now = next_dep
                resp[j] = now - arr[j]
        return np.array(resp), svc

    if policy == "srpt":
        heap = []  # (remaining, job); heap[0] is the job in service
        now = 0.0
        k = 0
        while k < n or heap:
            next_dep = now + heap[0][0] if heap else math.inf
            next_arr = arr[k] if k < n else math.inf
            if next_arr <= next_dep:
                if heap:
                    rem, j = heap[0]
                    heapq.heapreplace(heap, (rem - (next_arr - now), j))
                now = next_arr
                heapq.heappush(heap, (sizes[k], k))
                k += 1
            else:
                rem, j = heapq.heappop(heap)
                now = next_dep
                resp[j] = now - arr[j]
        return np.array(resp), svc

    raise ValueError(policy)


def sim_hedge(mode: str, c: int, rho: float, n: int, seed: int, delay: float,
              copies: str = "independent") -> tuple[np.ndarray, float]:
    """c FCFS servers, random dispatch, exponential service.

    copies:
      independent   each copy draws its own Exp(1) service time, so slowness
                    belongs to the server that runs it
      identical     both copies of a request take the same time, so a copy can
                    only win by escaping a longer queue

    mode:
      none          one copy per request
      hedge         after `delay`, send a second copy to another server; the
                    first copy to finish wins and the other is cancelled,
                    removed from its queue or stopped mid-service
      hedge-nocancel  as hedge, but the losing copy still runs to completion
      dup           send two copies at arrival, cancel the loser when one finishes

    Returns (response times, work done / work an unhedged run would do).
    """
    rng = np.random.default_rng(seed)
    arr = arrivals(rng, rho * c, n).tolist()
    pick = rng.integers(0, c, size=(n, 2)).tolist()
    svc = rng.exponential(1.0, size=(n, 2))  # service time of each copy
    if copies == "identical":
        svc[:, 1] = svc[:, 0]
    elif copies != "independent":
        raise ValueError(copies)
    svc = svc.tolist()

    done = [math.inf] * n
    queues = [deque() for _ in range(c)]  # (request, copy) waiting
    serving: list[tuple[int, int] | None] = [None] * c
    started = [0.0] * c
    version = [0] * c  # invalidates completion events of stopped copies
    where = {}  # (request, copy) -> server
    events: list[tuple[float, int, int, int, int]] = []  # (time, kind, a, b, c)
    ARR, HEDGE, DONE = 0, 1, 2
    work = 0.0
    base_work = 0.0

    def start_next(s: int, now: float) -> None:
        q = queues[s]
        while q:
            r, cp = q.popleft()
            if done[r] < math.inf and mode != "hedge-nocancel":
                where.pop((r, cp), None)
                continue  # cancelled while queued
            serving[s] = (r, cp)
            started[s] = now
            version[s] += 1
            heapq.heappush(events, (now + svc[r][cp], DONE, s, version[s], 0))
            return
        serving[s] = None

    def enqueue(r: int, cp: int, s: int, now: float) -> None:
        where[(r, cp)] = s
        queues[s].append((r, cp))
        if serving[s] is None:
            start_next(s, now)

    second = {}
    for r in range(n):
        heapq.heappush(events, (arr[r], ARR, r, 0, 0))
        a, b = pick[r]
        if b == a:
            b = (a + 1) % c
        second[r] = b
        base_work += svc[r][0]

    while events:
        now, kind, x, y, _ = heapq.heappop(events)
        if kind == ARR:
            r = x
            enqueue(r, 0, pick[r][0], now)
            if mode == "dup":
                enqueue(r, 1, second[r], now)
            elif mode in ("hedge", "hedge-nocancel"):
                heapq.heappush(events, (now + delay, HEDGE, r, 0, 0))
        elif kind == HEDGE:
            r = x
            if done[r] == math.inf:
                enqueue(r, 1, second[r], now)
        else:
            s, ver = x, y
            if ver != version[s] or serving[s] is None:
                continue
            r, cp = serving[s]
            work += now - started[s]
            where.pop((r, cp), None)
            if done[r] == math.inf:
                done[r] = now
                other = (r, 1 - cp)
                if mode in ("hedge", "dup") and other in where:
                    so = where.pop(other)
                    if serving[so] == other:
                        work += now - started[so]
                        version[so] += 1
                        start_next(so, now)
                    # a queued twin is skipped when it reaches the head
            start_next(s, now)

    resp = np.array(done) - np.array(arr)
    return resp, work / base_work


# --- experiments -----------------------------------------------------------------

SEEDS = [0, 1, 2, 3, 4]


def run_dispatch_cell(args):
    policy, c, rho, dist, n, seed = args
    return summarize(sim_dispatch(policy, c, rho, dist, n, seed))


def exp_pooling(pool, n):
    """Separate M/M/1 queues (random dispatch) against one shared queue, rho = 0.9."""
    rho = 0.9
    rows = []
    for c in [1, 2, 4, 8, 16, 32, 64]:
        cells = {}
        for policy in ["random", "shared"]:
            runs = list(pool.map(run_dispatch_cell, [(policy, c, rho, "exp", n, s) for s in SEEDS]))
            cells[policy] = across_seeds(runs)
        rows.append({
            "servers": c,
            "rho": rho,
            "sim": cells,
            "theory": {
                "separate": {"mean": 1 / (1 - rho), "p99": math.log(100) / (1 - rho)},
                "shared": {
                    "mean": mmc_mean_response(c, rho),
                    "p99": mmc_response_quantile(0.99, c, rho),
                    "p_wait": erlang_c(c, rho * c),
                },
            },
        })
    return rows


def staffing_table():
    """Highest utilization at which a shared queue keeps p99 response <= target, exact."""
    out = []
    for target in [5.0, 10.0]:
        row = {"p99_target": target, "max_rho": {}}
        for c in [1, 2, 4, 8, 16, 32, 64, 128]:
            lo, hi = 0.0, 0.9999
            for _ in range(60):
                mid = (lo + hi) / 2
                if mmc_response_quantile(0.99, c, mid) <= target:
                    lo = mid
                else:
                    hi = mid
            row["max_rho"][c] = lo
        out.append(row)
    return out


def exp_dispatch(pool, n):
    c = 16
    rows = []
    for dist in ["exp", "bimodal"]:
        for rho in [0.5, 0.7, 0.9]:
            for policy in ["random", "rr", "jsq2", "jsq", "lwl", "shared"]:
                runs = list(pool.map(run_dispatch_cell, [(policy, c, rho, dist, n, s) for s in SEEDS]))
                rows.append({"dist": dist, "rho": rho, "servers": c, "policy": policy, "sim": across_seeds(runs)})
    return rows


def run_order_cell(args):
    policy, rho, dist, n, seed = args
    resp, size = sim_order(policy, rho, dist, n, seed)
    keep = slice(int(n * WARMUP), None)
    resp, size = resp[keep], size[keep]
    out = {
        "mean": float(resp.mean()),
        "p50": float(np.quantile(resp, 0.5)),
        "p99": float(np.quantile(resp, 0.99)),
        "p999": float(np.quantile(resp, 0.999)),
    }
    small = size <= 1.0
    out["short_p99"] = float(np.quantile(resp[small], 0.99)) if small.any() else float("nan")
    if (~small).any():
        out["long_mean"] = float(resp[~small].mean())
        out["long_p99"] = float(np.quantile(resp[~small], 0.99))
    return out


def exp_order(pool, n):
    rows = []
    for dist in ["exp", "bimodal"]:
        for rho in [0.7, 0.9]:
            for policy in ["fcfs", "ps", "srpt"]:
                runs = list(pool.map(run_order_cell, [(policy, rho, dist, n, s) for s in SEEDS]))
                theory = {}
                if policy == "fcfs":
                    theory["mean"] = mg1_mean_response(rho, dist)
                if policy == "ps":
                    theory["mean"] = 1 / (1 - rho)  # M/G/1-PS mean is insensitive to the distribution
                rows.append({"dist": dist, "rho": rho, "policy": policy, "sim": across_seeds(runs), "theory": theory})
    return rows


def run_hedge_cell(args):
    mode, c, rho, n, seed, delay, copies = args
    resp, work = sim_hedge(mode, c, rho, n, seed, delay, copies)
    out = summarize(resp)
    out["work"] = work
    # A run that never reaches steady state keeps getting slower: compare the
    # mean response of the last quarter of jobs with the quarter after warm-up.
    q = len(resp) // 4
    out["drift"] = float(resp[-q:].mean() / resp[int(len(resp) * WARMUP):int(len(resp) * WARMUP) + q].mean())
    return out


def exp_hedge(pool, n):
    c = 10
    rows = []
    for copies in ["independent", "identical"]:
        for rho in [0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
            base = list(pool.map(run_hedge_cell, [("none", c, rho, n, s, 0.0, copies) for s in SEEDS]))
            # Hedge at the unhedged system's p95 at this load: each server is
            # M/M/1, so response is Exp(1 - rho) and p95 = ln 20 / (1 - rho).
            delay = math.log(20) / (1 - rho)
            row = {"copies": copies, "rho": rho, "servers": c, "hedge_delay": delay, "sim": {"none": across_seeds(base)}}
            for mode in ["hedge", "hedge-nocancel", "dup"]:
                runs = list(pool.map(run_hedge_cell, [(mode, c, rho, n, s, delay, copies) for s in SEEDS]))
                row["sim"][mode] = across_seeds(runs)
            rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=1_000_000, help="jobs per run")
    ap.add_argument("--only", choices=["pooling", "dispatch", "order", "hedge", "staffing"])
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "queue_experiments_results.json"))
    args = ap.parse_args()

    results = {}
    if os.path.exists(args.out):
        with open(args.out) as f:
            results = json.load(f)
    results["environment"] = {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "machine": platform.processor() or platform.machine(),
        "cpus": os.cpu_count(),
    }
    results["settings"] = {
        "jobs_per_run": args.jobs,
        "warmup_fraction": WARMUP,
        "seeds": SEEDS,
        "ci": "95% t interval over the 5 seeds",
        "bimodal": {"p_long": BIMODAL_P, "short": BIMODAL_SHORT, "long": BIMODAL_LONG,
                    "cs2": service_moments("bimodal")[1] - 1},
    }

    todo = [args.only] if args.only else ["staffing", "pooling", "dispatch", "order", "hedge"]
    with ProcessPoolExecutor() as pool:
        for name in todo:
            t0 = time.time()
            if name == "staffing":
                results["staffing"] = staffing_table()
            elif name == "pooling":
                results["pooling"] = exp_pooling(pool, args.jobs)
            elif name == "dispatch":
                results["dispatch"] = exp_dispatch(pool, args.jobs)
            elif name == "order":
                results["order"] = exp_order(pool, args.jobs)
            elif name == "hedge":
                results["hedge"] = exp_hedge(pool, args.jobs)
            results.setdefault("seconds", {})[name] = round(time.time() - t0, 1)
            print(f"{name}: {time.time() - t0:.1f} s", file=sys.stderr)
            with open(args.out, "w") as f:
                json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
