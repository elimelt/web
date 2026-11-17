#!/usr/bin/env python3
"""Check every recorded snapshot against the full event logs.

For each run written by snapshot_bench.py this script rebuilds the execution
from the per-process logs and, for every snapshot, computes the cut (how many
application events each process had executed when it recorded its state). It
then checks the cut two independent ways:

1. Message test: a cut is inconsistent if some message is received inside it
   but sent outside it (an orphan).
2. Vector clock test: a cut c is consistent iff, for all i and j,
   V_j[c_j][i] <= c_i, where V_j[k] is process j's vector clock after its
   k-th event (Babaoglu and Marzullo, Theorem 4.1 in their notation).

It asserts that the two tests agree on every cut, that every Chandy-Lamport
channel record equals the set of messages actually in flight across the cut,
and that every recorded balance matches the balance replayed from the log.

Usage:
    python3 analyze.py run1.json run2.json ... > summary.json
    python3 analyze.py --lattice run.json --window 25
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys

import numpy as np


def load(path):
    with open(path) as f:
        return json.load(f)


def rebuild(run):
    n = len(run["nodes"])
    V = []  # V[j][k] = vector clock of process j after k application events
    bal = []  # bal[j][k] = balance after k application events
    sends = {}  # msgid -> (proc, k, amount, dest)
    recvs = {}  # msgid -> (proc, k)
    for nd in run["nodes"]:
        j = nd["proc"]
        vs = [[0] * n]
        bs = [run["initial"]]
        for kind, peer, mid, amt, t, napp, *vc in nd["log"]:
            if kind == "send":
                sends[mid] = (j, napp, amt, peer)
            elif kind == "recv":
                recvs[mid] = (j, napp)
            else:
                continue
            vs.append(vc)
            bs.append(bs[-1] + (amt if kind == "recv" else -amt))
            assert napp == len(vs) - 1
        V.append(np.array(vs))
        bal.append(bs)
    assert set(sends) == set(recvs), "a transfer was lost"
    return n, V, bal, sends, recvs


def classify(cut, sends, recvs):
    orphans, inflight = [], []
    for mid, (sp, sk, amt, dest) in sends.items():
        rp, rk = recvs[mid]
        sent_in = sk <= cut[sp]
        recv_in = rk <= cut[rp]
        if recv_in and not sent_in:
            orphans.append(mid)
        elif sent_in and not recv_in:
            inflight.append(mid)
    return orphans, inflight


def vc_consistent(cut, V):
    n = len(cut)
    for j in range(n):
        frontier = V[j][cut[j]]
        for i in range(n):
            if frontier[i] > cut[i]:
                return False
    return True


def analyze(run):
    n, V, bal, sends, recvs = rebuild(run)
    total = run["initial"] * n
    naive = {}
    for nd in run["nodes"]:
        for kind, peer, sid, amt, t, napp, *vc in nd["log"]:
            if kind == "naive":
                naive.setdefault(sid, {})[nd["proc"]] = (napp, amt, t)
    cl_rec = {}
    cl_done = {}
    for nd in run["nodes"]:
        for kind, peer, sid, amt, t, napp, *vc in nd["log"]:
            if kind == "cl_record":
                cl_rec.setdefault(sid, {})[nd["proc"]] = t
            elif kind == "cl_done":
                cl_done.setdefault(sid, {})[nd["proc"]] = t

    out = {"naive": [], "cl": []}
    for sid, rec in sorted(naive.items()):
        cut = [rec[j][0] for j in range(n)]
        for j in range(n):
            assert rec[j][1] == bal[j][cut[j]], "recorded balance disagrees with replay"
        orphans, inflight = classify(cut, sends, recvs)
        cons = vc_consistent(cut, V)
        assert cons == (not orphans), "vector clock test disagrees with message test"
        recorded = sum(rec[j][1] for j in range(n))
        ts = [rec[j][2] for j in range(n)]
        out["naive"].append(
            {
                "sid": sid,
                "consistent": cons,
                "orphans": len(orphans),
                "inflight": len(inflight),
                "sum_error": recorded - total,
                "skew_us": (max(ts) - min(ts)) / 1e3,
            }
        )

    for sid in sorted(cl_rec):
        snaps = {nd["proc"]: nd["cl"][str(sid)] for nd in run["nodes"]}
        cut = [snaps[j]["napp"] for j in range(n)]
        for j in range(n):
            assert snaps[j]["balance"] == bal[j][cut[j]]
        orphans, inflight = classify(cut, sends, recvs)
        cons = vc_consistent(cut, V)
        assert cons == (not orphans)
        recorded_chan = sorted(m for j in range(n) for ch in snaps[j]["chan"].values() for m, a in ch)
        assert recorded_chan == sorted(inflight), "channel record differs from the messages in flight"
        chan_amount = sum(a for j in range(n) for ch in snaps[j]["chan"].values() for m, a in ch)
        recorded = sum(snaps[j]["balance"] for j in range(n)) + chan_amount
        ts = [cl_rec[sid][j] for j in range(n)]
        out["cl"].append(
            {
                "sid": sid,
                "consistent": cons,
                "orphans": len(orphans),
                "inflight": len(inflight),
                "sum_error": recorded - total,
                "record_spread_us": (max(ts) - min(ts)) / 1e3,
                "latency_us": (max(cl_done[sid].values()) - min(ts)) / 1e3,
            }
        )
    events = sum(len(v) - 1 for v in V)
    out["app_events"] = events
    send_t = [e[4] for nd in run["nodes"] for e in nd["log"] if e[0] == "send"]
    out["sends_per_s_per_proc"] = len(send_t) / ((max(send_t) - min(send_t)) / 1e9) / n
    return out


def summarize(paths):
    by_rate = {}
    for p in paths:
        run = load(p)
        a = analyze(run)
        by_rate.setdefault(run["args"]["rate"], []).append((run["args"]["seed"], a))
    rows = []
    for rate in sorted(by_rate, key=lambda r: (r == 0, r)):
        runs = by_rate[rate]
        per_seed = []
        for seed, a in runs:
            nv = a["naive"]
            cv = a["cl"]
            per_seed.append(
                {
                    "seed": seed,
                    "sends_per_s_per_proc": round(a["sends_per_s_per_proc"]),
                    "naive_inconsistent": sum(not s["consistent"] for s in nv) / len(nv),
                    "naive_sum_wrong": sum(s["sum_error"] != 0 for s in nv) / len(nv),
                    "naive_median_skew_us": statistics.median(s["skew_us"] for s in nv),
                    "naive_mean_inflight": statistics.mean(s["inflight"] for s in nv),
                    "naive_max_orphans": max(s["orphans"] for s in nv),
                    "cl_inconsistent": sum(not s["consistent"] for s in cv) / len(cv),
                    "cl_sum_wrong": sum(s["sum_error"] != 0 for s in cv) / len(cv),
                    "cl_mean_channel_msgs": statistics.mean(s["inflight"] for s in cv),
                    "cl_median_latency_us": statistics.median(s["latency_us"] for s in cv),
                    "cl_p90_latency_us": sorted(s["latency_us"] for s in cv)[int(0.9 * len(cv))],
                    "snapshots": len(nv),
                }
            )
        rows.append({"rate": rate, "seeds": per_seed})
    return rows


def lattice(path, window):
    run = load(path)
    n, V, bal, sends, recvs = rebuild(run)
    k = window
    # Every cut of the first `window` events of each process.
    grids = np.meshgrid(*[np.arange(k + 1)] * n, indexing="ij")
    cuts = np.stack([g.ravel() for g in grids], axis=1)  # (k+1)^n x n
    ok = np.ones(len(cuts), dtype=bool)
    for j in range(n):
        frontier = V[j][cuts[:, j]]  # vector clocks of process j's frontier event
        ok &= np.all(frontier <= cuts, axis=1)
    # Cross-check a random sample against the message test.
    rng = np.random.default_rng(0)
    for idx in rng.choice(len(cuts), size=min(2000, len(cuts)), replace=False):
        orphans, _ = classify(list(cuts[idx]), sends, recvs)
        assert ok[idx] == (not orphans)
    msgs = sum(1 for mid, (sp, sk, a, d) in sends.items() if sk <= k and recvs[mid][1] <= k and recvs[mid][0] is not None)
    return {
        "procs": n,
        "window": k,
        "cuts": int(len(cuts)),
        "consistent": int(ok.sum()),
        "fraction": float(ok.mean()),
        "messages_inside_window": msgs,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--lattice", action="store_true")
    ap.add_argument("--window", type=int, default=25)
    args = ap.parse_args()
    if args.lattice:
        json.dump([lattice(p, args.window) for p in args.runs], sys.stdout, indent=1)
    else:
        json.dump(summarize(args.runs), sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
