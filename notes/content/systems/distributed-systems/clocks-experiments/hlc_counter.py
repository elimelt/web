#!/usr/bin/env python3
"""How large does a hybrid logical clock's counter get?

Simulates N processes running the HLC algorithm of Kulkarni et al. (2014)
over a network with random delays, and records the counter c and the lead
l - pt at every event. Sweeps clock uncertainty (how far apart the physical
clocks are) and event rate (events per second per process).

This is a discrete-event simulation, not a measurement of a real cluster.
Its assumptions are the constants below; change them and rerun.

    python3 hlc_counter.py            # full sweep, about a minute on one core
    python3 hlc_counter.py --quick    # one seed per configuration
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import random
import statistics
import sys
import time

N = 8  # processes
GRAIN_NS = 1_000  # physical clocks read whole microseconds (the paper's 48-bit l)
DELAY_MEDIAN_NS = 100_000  # one-way network delay: lognormal, median 100 us
DELAY_SIGMA = 0.5
SEND_FRACTION = 0.5  # half of all events send a message to a random other process
EVENTS_PER_RUN = 400_000  # all processes together
WARMUP_FRACTION = 0.1  # ignore the first 10% of simulated time

EPSILONS_MS = [0.1, 1.0, 10.0]  # spread of clock offsets: chrony-class, LAN NTP, WAN NTP
RATES = [10_000, 100_000, 1_000_000]  # events per second per process
RUNAWAY_MS = 100.0  # last sweep: clocks within 1 ms, except one 100 ms ahead


def run(eps_ms: float, rate: float, seed: int, runaway_ms: float = 0.0) -> dict:
    rnd = random.Random(seed)
    eps_ns = eps_ms * 1e6
    # Each clock is off from true time by a fixed amount, spread over [-eps/2, eps/2].
    # Drift is left out: at the ~30 us/s rate differences Huygens measured, it moves
    # clocks by at most a few microseconds over these runs.
    offsets = [rnd.uniform(-eps_ns / 2, eps_ns / 2) for _ in range(N)]
    # Optionally, one process's clock is far ahead of the rest.
    offsets[0] += runaway_ms * 1e6
    duration = EVENTS_PER_RUN / (N * rate) * 1e9  # ns of simulated time
    warmup = duration * WARMUP_FRACTION
    mu = math.log(DELAY_MEDIAN_NS)

    l = [0] * N
    c = [0] * N
    queue: list[tuple[float, int, int, int, int, int]] = []  # (t, seq, proc, kind, ml, mc)
    seq = 0
    for p in range(N):
        queue.append((rnd.expovariate(rate) * 1e9, seq, p, 0, 0, 0))
        seq += 1
    heapq.heapify(queue)

    cs: list[int] = []
    max_lead = 0
    pt_of = lambda t, p: int((t + offsets[p]) // GRAIN_NS)  # noqa: E731

    while queue:
        t, _, p, kind, ml, mc = heapq.heappop(queue)
        if t > duration:
            break
        pt = pt_of(t, p)
        if kind == 0:  # local or send
            old = l[p]
            l[p] = max(old, pt)
            c[p] = c[p] + 1 if l[p] == old else 0
            if rnd.random() < SEND_FRACTION:
                q = rnd.randrange(N - 1)
                q += q >= p
                arrive = t + rnd.lognormvariate(mu, DELAY_SIGMA)
                heapq.heappush(queue, (arrive, seq, q, 1, l[p], c[p]))
                seq += 1
            heapq.heappush(queue, (t + rnd.expovariate(rate) * 1e9, seq, p, 0, 0, 0))
            seq += 1
        else:  # receive
            old = l[p]
            l[p] = max(old, ml, pt)
            if l[p] == old == ml:
                c[p] = max(c[p], mc) + 1
            elif l[p] == old:
                c[p] += 1
            elif l[p] == ml:
                c[p] = mc + 1
            else:
                c[p] = 0
        if t >= warmup:
            cs.append(c[p])
            lead = l[p] - pt
            if lead > max_lead:
                max_lead = lead

    cs.sort()
    n = len(cs)
    return {
        "events": n,
        "c_p50": cs[n // 2],
        "c_p99": cs[min(n - 1, int(n * 0.99))],
        "c_max": cs[-1],
        "c_nonzero": sum(1 for x in cs if x) / n,
        "lead_max_us": max_lead * GRAIN_NS / 1000,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--seeds", type=int, default=5)
    parser.add_argument("--json", help="also write results to this file")
    args = parser.parse_args()
    seeds = 1 if args.quick else args.seeds

    print(f"python {sys.version.split()[0]}, {N} processes, {EVENTS_PER_RUN:,} events per run, {seeds} seeds")
    print(f"{'eps':>7} {'rate/s':>9} | {'c p50':>5} {'c p99':>13} {'c max':>15} {'c>0':>6} | {'max l-pt (us)':>14}")
    results = []
    start = time.time()
    configs = [(eps, rate, 0.0) for eps in EPSILONS_MS for rate in RATES]
    configs += [(1.0, rate, RUNAWAY_MS) for rate in RATES]
    for eps, rate, runaway in configs:
        runs = [run(eps, rate, 1000 * s + 7, runaway) for s in range(seeds)]

        def ms(key: str) -> tuple[float, float]:
            vals = [r[key] for r in runs]
            return statistics.mean(vals), (statistics.stdev(vals) if len(vals) > 1 else 0.0)

        p99, p99sd = ms("c_p99")
        cmax, cmaxsd = ms("c_max")
        nz, _ = ms("c_nonzero")
        lead, _ = ms("lead_max_us")
        p50, _ = ms("c_p50")
        label = f"{eps}ms" if not runaway else f"{eps}+{runaway:.0f}"
        print(
            f"{label:>7} {rate:>9,} | {p50:>5.0f} {p99:>7.0f} ±{p99sd:<5.0f} {cmax:>8.0f} ±{cmaxsd:<6.0f} {nz:>6.1%} | {lead:>14.0f}"
        )
        results.append({"eps_ms": eps, "rate": rate, "runaway_ms": runaway, "runs": runs})
    print(f"took {time.time() - start:.0f} s")
    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
