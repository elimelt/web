"""Runs every experiment the Dynamo note reports and writes results.json.

    OMP_NUM_THREADS=2 python3 run_experiments.py > results.json

Each configuration runs with several seeds; a reported value is the mean over
seeds with a 95% confidence interval from the spread between seeds (Student t).
"""

from __future__ import annotations

import json
import sys
import time

import numpy as np

import dynsim as d

T975 = {5: 2.776, 10: 2.262}  # Student t, 97.5% quantile, for seeds - 1 degrees of freedom


def summary(xs):
    xs = np.asarray(xs, dtype=float)
    k = len(xs)
    half = T975[k] * xs.std(ddof=1) / np.sqrt(k) if k > 1 else 0.0
    return {"mean": float(xs.mean()), "lo": float(xs.mean() - half), "hi": float(xs.mean() + half), "seeds": k}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def pbs_table(seeds=10, n=1_000_000):
    """PBS Table 4 and the t = 0 values of section 5.5: N = 3."""
    out = []
    for prof in ["LNKD-SSD", "LNKD-DISK", "YMMR", "WAN"]:
        for R, W in [(1, 1), (1, 2), (2, 1), (2, 2), (3, 1), (1, 3)]:
            p0, t999 = [], []
            for sd in range(seeds):
                T = d.stale_thresholds(np.random.default_rng([1, sd]), prof, 3, R, W, n)
                p0.append(float((T <= 0).mean()))
                t999.append(max(0.0, float(np.quantile(T, 0.999))))
            out.append({"profile": prof, "N": 3, "R": R, "W": W, "p_consistent_t0": summary(p0), "t_999_ms": summary(t999)})
            log(f"pbs {prof} R={R} W={W}: {np.mean(p0):.4f} {np.mean(t999):.2f}")
    return out


def n_sweep(seeds=10, n=1_000_000):
    """PBS section 5.7: LNKD-DISK, R = W = 1, N from 2 to 10."""
    out = []
    for N in range(2, 11):
        p0, t999 = [], []
        for sd in range(seeds):
            T = d.stale_thresholds(np.random.default_rng([2, sd]), "LNKD-DISK", N, 1, 1, n)
            p0.append(float((T <= 0).mean()))
            t999.append(max(0.0, float(np.quantile(T, 0.999))))
        out.append({"N": N, "p_consistent_t0": summary(p0), "t_999_ms": summary(t999)})
        log(f"nsweep N={N}: {np.mean(p0):.4f} {np.mean(t999):.2f}")
    return out


def curves(seeds=10, n=1_000_000):
    """P(stale) at fixed times after commit, failure free."""
    ts = [0, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
    out = []
    for prof in ["LNKD-SSD", "LNKD-DISK", "YMMR", "WAN"]:
        for N, R, W in [(3, 1, 1), (3, 1, 2), (3, 2, 1), (3, 2, 2), (5, 1, 1), (5, 2, 2)]:
            per = {t: [] for t in ts}
            for sd in range(seeds):
                T = d.stale_thresholds(np.random.default_rng([3, sd]), prof, N, R, W, n)
                for t in ts:
                    per[t].append(float((T > t).mean()))
            out.append({"profile": prof, "N": N, "R": R, "W": W, "t_ms": ts, "p_stale": [summary(per[t]) for t in ts]})
        log(f"curves {prof}")
    return out


def failures(seeds=5, n=500_000):
    """Sloppy against strict quorums under node failures, LNKD-DISK delays."""
    ts = [0, 10, 100, 1000, 10_000, 100_000]
    out = []
    for outage in [10.0, 10_000.0]:
        for f in [0.0, 0.01, 0.05, 0.1]:
            if f == 0 and outage != 10.0:
                continue
            for N, R, W in [(3, 1, 1), (3, 2, 2)]:
                for sloppy in [True, False]:
                    stale = {t: [] for t in ts}
                    wfail, rfail = {t: [] for t in ts}, {t: [] for t in ts}
                    for sd in range(seeds):
                        for t in ts:
                            rng = np.random.default_rng([4, sd, int(outage), int(f * 1000), N, R, W, int(sloppy), t])
                            res = d.simulate(rng, "LNKD-DISK", N, R, W, t, n, d.Failures(f, outage, 1000.0), sloppy=sloppy)
                            ok = res["write_ok"] & res["read_ok"]
                            stale[t].append(float(res["stale"][ok].mean()))
                            wfail[t].append(float(1 - res["write_ok"].mean()))
                            rfail[t].append(float(1 - res["read_ok"][res["write_ok"]].mean()))
                    out.append(
                        {
                            "f": f,
                            "outage_ms": outage,
                            "hint_delay_ms": 1000.0,
                            "N": N,
                            "R": R,
                            "W": W,
                            "sloppy": sloppy,
                            "t_ms": ts,
                            "p_stale": [summary(stale[t]) for t in ts],
                            "p_write_unavailable": summary(wfail[0]),
                            "p_read_unavailable": [summary(rfail[t]) for t in ts],
                        }
                    )
                    log(f"failures outage={outage} f={f} {N}{R}{W} sloppy={sloppy}: " + " ".join(f"{np.mean(stale[t]):.2e}" for t in ts))
    return out


def ring_check(n=100_000):
    """The same failure scenario with real preference lists from a 30-node ring."""
    ring = d.Ring(30, 8, seed=0)
    rows = []
    for use_ring in [True, False]:
        rng = np.random.default_rng([5, int(use_ring)])
        res = d.simulate(rng, "LNKD-DISK", 3, 2, 2, 1000.0, n, d.Failures(0.1, 10_000.0, 1000.0), ring=ring if use_ring else None, width=11)
        ok = res["write_ok"] & res["read_ok"]
        k = int(res["stale"][ok].sum())
        rows.append({"ring": use_ring, "trials": int(ok.sum()), "stale": k, "p": k / int(ok.sum()), "ci": d.wilson(k, int(ok.sum()))})
    log(f"ring check {rows}")
    return rows


def read_repair(seeds=10, n=1_000_000):
    out = []
    for prof in ["LNKD-DISK", "YMMR"]:
        for gap in [1, 10, 100, 1000]:
            row = {"profile": prof, "N": 3, "R": 1, "W": 1, "t1_ms": 0, "gap_ms": gap}
            for repair in [False, True]:
                s2 = []
                for sd in range(seeds):
                    _, b = d.read_repair_pair(np.random.default_rng([6, sd, gap]), prof, 3, 1, 1, 0.0, gap, n, repair)
                    s2.append(float(b.mean()))
                row["second_read_stale_" + ("repair" if repair else "none")] = summary(s2)
            out.append(row)
            log(f"repair {prof} gap={gap}: {row['second_read_stale_none']['mean']:.4f} -> {row['second_read_stale_repair']['mean']:.4f}")
    return out


if __name__ == "__main__":
    t0 = time.time()
    res = {"numpy": np.__version__, "python": sys.version.split()[0]}
    res["failures"] = failures()  # slowest first
    res["ring_check"] = ring_check()
    res["pbs_table4"] = pbs_table()
    res["n_sweep"] = n_sweep()
    res["curves"] = curves()
    res["read_repair"] = read_repair()
    res["seconds"] = round(time.time() - t0, 1)
    json.dump(res, sys.stdout, indent=1)
