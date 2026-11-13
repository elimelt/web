"""Measure how often, and how badly, plausible greedy rules fail on interval problems.

Interval scheduling: every rule uses the same template. Sort the intervals by a
key, scan them in that order, and keep each one that is compatible with
everything kept so far. Only earliest-finish order is optimal; the experiment
measures the others against it on random instances.

Interval partitioning: first-fit (put each interval in the lowest-numbered room
that is free, open a new room otherwise) in three orders. Start order is
optimal and uses exactly `depth` rooms; the others are compared to depth.

Run from notes/:
    python3 content/algorithms/greedy-intervals/greedy_intervals.py --exhaustive 5,8 6,8 7,8 7,10

The --exhaustive checks use every core and take most of the run time (the
7-interval, grid-10 check is about 15 minutes on 4 cores).

Intervals are half-open [s, f). Ties in every sort key are broken by finish
time, then start time, then position in the input.
"""

from __future__ import annotations

import argparse
import bisect
import heapq
import itertools
import json
import math
import platform
import random
import statistics
import sys
import time
from pathlib import Path

Interval = tuple[float, float]

# ---------------------------------------------------------------- instances

def make_instance(rng: random.Random, n: int, dist: str, load: float) -> list[Interval]:
    """n intervals with starts uniform on [0, 1).

    `load` is the expected number of intervals covering a typical point,
    n * mean_length on a unit horizon (ignoring the right edge), so the mean
    length is load / n for every distribution.
    """
    mean = load / n
    out = []
    for _ in range(n):
        s = rng.random()
        if dist == "uniform":
            length = rng.uniform(0, 2 * mean)
        elif dist == "exponential":
            length = rng.expovariate(1 / mean)
        elif dist == "bimodal":
            # 80% short, 20% long, long ones 10x the short ones, same overall mean.
            short = mean / (0.8 + 0.2 * 10)
            length = short * (10 if rng.random() < 0.2 else 1) * rng.uniform(0.5, 1.5)
        else:
            raise ValueError(dist)
        out.append((s, s + max(length, 1e-9)))
    return out

# ---------------------------------------------------------------- scheduling

def conflicts(intervals: list[Interval]) -> list[int]:
    """Number of other intervals each one overlaps, in O(n log n)."""
    starts = sorted(s for s, _ in intervals)
    finishes = sorted(f for _, f in intervals)
    n = len(intervals)
    out = []
    for s, f in intervals:
        ends_before = bisect.bisect_right(finishes, s)          # f_i <= s
        starts_after = n - bisect.bisect_left(starts, f)         # s_i >= f
        out.append(n - 1 - ends_before - starts_after)
    return out


def order(intervals: list[Interval], rule: str, rng: random.Random | None = None) -> list[int]:
    idx = range(len(intervals))
    tie = lambda i: (intervals[i][1], intervals[i][0], i)
    if rule == "finish":
        return sorted(idx, key=tie)
    if rule == "start":
        return sorted(idx, key=lambda i: (intervals[i][0],) + tie(i))
    if rule == "shortest":
        return sorted(idx, key=lambda i: (intervals[i][1] - intervals[i][0],) + tie(i))
    if rule == "conflicts":
        c = conflicts(intervals)
        return sorted(idx, key=lambda i: (c[i],) + tie(i))
    if rule == "input":
        return list(idx)
    if rule == "random":
        perm = list(idx)
        rng.shuffle(perm)
        return perm
    raise ValueError(rule)


def greedy_schedule(intervals: list[Interval], ordering: list[int]) -> list[int]:
    """Keep each interval compatible with everything kept so far."""
    kept_starts: list[float] = []   # kept intervals, sorted by start (they are disjoint)
    kept_ends: list[float] = []
    chosen = []
    for i in ordering:
        s, f = intervals[i]
        k = bisect.bisect_right(kept_starts, s)
        if k > 0 and kept_ends[k - 1] > s:
            continue                 # overlaps the kept interval that starts at or before s
        if k < len(kept_starts) and kept_starts[k] < f:
            continue                 # overlaps the next kept interval
        kept_starts.insert(k, s)
        kept_ends.insert(k, f)
        chosen.append(i)
    return chosen


def min_degree_greedy(intervals: list[Interval]) -> list[int]:
    """Fewest conflicts, recounted: keep the interval with the fewest overlaps among
    those still available, discard everything it overlaps, repeat. This is the
    min-degree greedy that Chaplick et al. (2024) analyze."""
    n = len(intervals)
    ids = sorted(range(n), key=lambda i: intervals[i][0])
    starts = [intervals[i][0] for i in ids]
    nbrs: list[list[int]] = [[] for _ in range(n)]
    for a_pos, a in enumerate(ids):
        fa = intervals[a][1]
        for b in ids[a_pos + 1: bisect.bisect_left(starts, fa)]:
            nbrs[a].append(b)
            nbrs[b].append(a)
    deg = [len(x) for x in nbrs]
    tie = lambda i: (intervals[i][1], intervals[i][0], i)
    heap = [(deg[i],) + tie(i) for i in range(n)]
    heapq.heapify(heap)
    alive = [True] * n
    chosen = []
    while heap:
        d, f, s, i = heapq.heappop(heap)
        if not alive[i] or d != deg[i]:
            continue
        chosen.append(i)
        dead = [i] + [j for j in nbrs[i] if alive[j]]
        for j in dead:
            alive[j] = False
        for j in dead:
            for k in nbrs[j]:
                if alive[k]:
                    deg[k] -= 1
                    heapq.heappush(heap, (deg[k],) + tie(k))
    return chosen


def brute_force_max(intervals: list[Interval]) -> int:
    n = len(intervals)
    best = 0
    for mask in range(1 << n):
        picked = sorted(intervals[i] for i in range(n) if mask >> i & 1)
        if all(a[1] <= b[0] for a, b in zip(picked, picked[1:])):
            best = max(best, len(picked))
    return best

# ---------------------------------------------------------------- partitioning

def depth(intervals: list[Interval]) -> int:
    events = sorted([(f, -1) for _, f in intervals] + [(s, 1) for s, _ in intervals])
    # At equal times the -1 (finish) sorts first, matching half-open intervals.
    best = cur = 0
    for _, d in events:
        cur += d
        best = max(best, cur)
    return best


def first_fit(intervals: list[Interval], ordering: list[int]) -> int:
    """Rooms used by first-fit in the given order. A room fits if no interval in it overlaps."""
    rooms: list[tuple[list[float], list[float]]] = []
    for i in ordering:
        s, f = intervals[i]
        for starts, ends in rooms:
            k = bisect.bisect_right(starts, s)
            if (k == 0 or ends[k - 1] <= s) and (k == len(starts) or starts[k] >= f):
                starts.insert(k, s)
                ends.insert(k, f)
                break
        else:
            rooms.append(([s], [f]))
    return len(rooms)


def heap_partition(intervals: list[Interval]) -> int:
    """The O(n log n) version of start-order partitioning: reuse the room that frees up first."""
    ends: list[float] = []
    for s, f in sorted(intervals):
        if ends and ends[0] <= s:
            heapq.heapreplace(ends, f)
        else:
            heapq.heappush(ends, f)
    return len(ends)

# ---------------------------------------------------------------- experiments

SCHED_RULES = ["finish", "start", "shortest", "conflicts", "min_degree", "random"]
PART_ORDERS = ["start", "finish", "random"]


def ci95(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return 1.96 * statistics.stdev(values) / math.sqrt(len(values))


def run_cell(n: int, dist: str, load: float, seeds: list[int], per_seed: int) -> dict:
    sched = {r: {"ratio": [], "fail": [], "worst": 1.0, "kept_len": []} for r in SCHED_RULES}
    part = {o: {"ratio": [], "fail": [], "worst": 1.0} for o in PART_ORDERS}
    depths = []
    for seed in seeds:
        rng = random.Random(f"{n}-{dist}-{load}-{seed}")
        acc_s = {r: ([], [], []) for r in SCHED_RULES}
        acc_p = {o: ([], []) for o in PART_ORDERS}
        for _ in range(per_seed):
            inst = make_instance(rng, n, dist, load)
            opt = len(greedy_schedule(inst, order(inst, "finish")))
            for r in SCHED_RULES:
                kept = min_degree_greedy(inst) if r == "min_degree" else greedy_schedule(inst, order(inst, r, rng))
                got = len(kept)
                assert got <= opt
                # Mean length of the kept intervals, relative to the instance's mean length.
                mean_len = statistics.fmean(f - s for s, f in inst)
                acc_s[r][2].append(statistics.fmean(inst[i][1] - inst[i][0] for i in kept) / mean_len)
                ratio = got / opt
                acc_s[r][0].append(ratio)
                acc_s[r][1].append(got < opt)
                sched[r]["worst"] = min(sched[r]["worst"], ratio)
            d = depth(inst)
            depths.append(d)
            assert heap_partition(inst) == d
            for o in PART_ORDERS:
                rooms = first_fit(inst, order(inst, o, rng))
                assert rooms >= d
                if o == "start":
                    assert rooms == d
                acc_p[o][0].append(rooms / d)
                acc_p[o][1].append(rooms > d)
                part[o]["worst"] = max(part[o]["worst"], rooms / d)
        for r in SCHED_RULES:
            sched[r]["ratio"].append(statistics.fmean(acc_s[r][0]))
            sched[r]["fail"].append(statistics.fmean(acc_s[r][1]))
            sched[r]["kept_len"].append(statistics.fmean(acc_s[r][2]))
        for o in PART_ORDERS:
            part[o]["ratio"].append(statistics.fmean(acc_p[o][0]))
            part[o]["fail"].append(statistics.fmean(acc_p[o][1]))

    def summarize(d):
        return {
            k: {
                "mean_ratio": statistics.fmean(v["ratio"]),
                "ratio_ci95": ci95(v["ratio"]),
                "fail_rate": statistics.fmean(v["fail"]),
                "fail_ci95": ci95(v["fail"]),
                "worst_ratio": v["worst"],
                "per_seed_ratio": v["ratio"],
                **({"kept_length_vs_mean": statistics.fmean(v["kept_len"])} if "kept_len" in v else {}),
            }
            for k, v in d.items()
        }

    return {
        "n": n, "dist": dist, "load": load, "seeds": seeds, "instances_per_seed": per_seed,
        "mean_depth": statistics.fmean(depths),
        "scheduling": summarize(sched), "partitioning": summarize(part),
    }


def check_against_brute_force(trials: int) -> int:
    """Earliest finish equals the brute-force optimum on small random instances."""
    rng = random.Random("brute")
    for _ in range(trials):
        n = rng.randint(1, 12)
        inst = [(a, b) for a, b in (sorted(rng.sample(range(13), 2)) for _ in range(n))]
        assert len(greedy_schedule(inst, order(inst, "finish"))) == brute_force_max(inst)
    return trials


def smallest_counterexample(rule: str, kind: str, grid: int, max_n: int) -> dict | None:
    """Exhaustive search over intervals with integer endpoints in [0, grid], fewest intervals first."""
    cells = [(a, b) for a in range(grid) for b in range(a + 1, grid + 1)]
    for n in range(1, max_n + 1):
        best = None
        for inst in itertools.combinations_with_replacement(cells, n):
            inst = list(inst)
            if kind == "scheduling":
                opt = len(greedy_schedule(inst, order(inst, "finish")))
                got = len(greedy_schedule(inst, order(inst, rule)))
                bad = got < opt
                score = (opt - got, -max(f for _, f in inst))
            else:
                d = depth(inst)
                got = first_fit(inst, order(inst, rule))
                bad = got > d
                score = (got - d, -max(f for _, f in inst))
            if bad and (best is None or score > best[0]):
                best = (score, inst, got, opt if kind == "scheduling" else d)
        if best:
            return {"rule": rule, "kind": kind, "n": n, "grid": grid, "intervals": best[1],
                    "greedy": best[2], "optimum": best[3]}
    return None


def _fails(inst: list[Interval], rule: str) -> bool:
    return len(greedy_schedule(inst, order(inst, rule))) < len(greedy_schedule(inst, order(inst, "finish")))


def shrink_search(rule: str, trials: int, seed: str) -> dict:
    """Random instances until one fails, then drop intervals while it still fails.

    For rules whose failures are too rare or too large for exhaustive search.
    Returns the smallest failing instance seen.
    """
    rng = random.Random(seed)
    best = None
    for _ in range(trials):
        n = rng.randint(5, 11)
        grid = rng.choice([8, 10, 12])
        inst = [tuple(sorted(rng.sample(range(grid + 1), 2))) for _ in range(n)]
        if not _fails(inst, rule):
            continue
        shrunk = True
        while shrunk:
            shrunk = False
            for i in range(len(inst)):
                if _fails(inst[:i] + inst[i + 1:], rule):
                    inst = inst[:i] + inst[i + 1:]
                    shrunk = True
                    break
        if best is None or len(inst) < len(best):
            best = sorted(inst)
    if best is None:
        return {"rule": rule, "trials": trials, "n": None}
    return {"rule": rule, "trials": trials, "n": len(best), "intervals": best,
            "greedy": len(greedy_schedule(best, order(best, rule))),
            "optimum": len(greedy_schedule(best, order(best, "finish")))}


def _exhaustive_worker(job: tuple[str, int, int, int]) -> list[Interval] | None:
    rule, n, grid, first = job
    cells = [(a, b) for a in range(grid) for b in range(a + 1, grid + 1)]
    for rest in itertools.combinations_with_replacement(cells[first:], n - 1):
        inst = [cells[first], *rest]
        if _fails(inst, rule):
            return inst
    return None


def exhaustive_none(rule: str, n: int, grid: int) -> dict:
    """Check every instance of n intervals with integer endpoints in [0, grid] (multisets)."""
    from multiprocessing import Pool
    cells = grid * (grid + 1) // 2
    with Pool() as pool:
        found = [r for r in pool.imap_unordered(_exhaustive_worker, [(rule, n, grid, i) for i in range(cells)]) if r]
    return {"rule": rule, "n": n, "grid": grid, "failing_found": found[:3]}


def fixtures(count: int) -> list[dict]:
    """Small integer instances with every rule's result, for the browser figure's tests."""
    rng = random.Random("fixtures")
    out = []
    for _ in range(count):
        n = rng.randint(3, 12)
        inst = []
        for _ in range(n):
            s = rng.randint(0, 14)
            inst.append((s, min(16, s + rng.randint(1, 6))))
        out.append({
            "intervals": inst,
            "schedule": {r: greedy_schedule(inst, order(inst, r)) for r in ["finish", "start", "shortest", "conflicts"]},
            "optimum": brute_force_max(inst),
            "rooms": {o: first_fit(inst, order(inst, o)) for o in ["start", "finish", "input"]},
            "depth": depth(inst),
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).with_name("greedy_intervals_results.json")))
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--exhaustive", type=lambda v: tuple(map(int, v.split(","))), nargs="*", default=[],
                    metavar="N,GRID", help="also check every fewest-conflicts instance of N intervals on [0, GRID]")
    args = ap.parse_args()

    t0 = time.perf_counter()
    seeds = [0, 1, 2, 3, 4]
    plan = [(1000, 200), (100, 2000), (10, 20000)] if not args.quick else [(100, 20), (10, 200)]
    cells = []
    for n, per_seed in plan:      # slowest first
        for dist in ["uniform", "exponential", "bimodal"]:
            for load in [2.0, 10.0]:
                t = time.perf_counter()
                cells.append(run_cell(n, dist, load, seeds, per_seed))
                print(f"n={n:5d} {dist:12s} load={load:4.1f}  {time.perf_counter() - t:6.1f}s", flush=True)

    brute = check_against_brute_force(300 if args.quick else 3000)
    searches = []
    for rule in ["start", "shortest", "conflicts"]:
        searches.append(smallest_counterexample(rule, "scheduling", grid=8, max_n=4))
    searches.append(smallest_counterexample("finish", "partitioning", grid=6, max_n=4))
    shrunk = shrink_search("conflicts", trials=20_000 if args.quick else 200_000, seed="conflicts")
    exhaustive = [exhaustive_none("conflicts", n, g) for n, g in args.exhaustive]

    result = {
        "cells": cells,
        "brute_force_checks": brute,
        "smallest_counterexamples": searches,
        "conflicts_shrink_search": shrunk,
        "conflicts_exhaustive": exhaustive,
        "fixtures": fixtures(60),
        "environment": {
            "python": sys.version.split()[0],
            "machine": platform.machine(),
            "processor": platform.processor(),
            "seconds": round(time.perf_counter() - t0, 1),
        },
    }
    Path(args.out).write_text(json.dumps(result, indent=1))
    print(f"wrote {args.out} in {result['environment']['seconds']}s")


if __name__ == "__main__":
    main()
