"""Summarize results.json from commit_bench.py into the tables the note uses.

For every protocol and participant count it reports, as mean ± standard
deviation over the repetitions: median and 99th-percentile commit latency,
median lock hold time at a participant, messages and forced writes per
transaction.

It also predicts 2PC's median commit latency from parts measured on their
own: the 2pc-nosync latency (network and CPU) plus two forced writes in
sequence, the participant's being the slowest of N. The forced-write times are
drawn from the same repetition's single-process fdatasync baseline, so the
prediction assumes the N participants' writes don't slow each other down.

Run:  python3 summarize.py results.json
"""

import json
import random
import statistics
import sys


def q(xs, p):
    s = sorted(xs)
    return s[min(len(s) - 1, int(p * len(s)))]


def ms(xs):
    m = statistics.mean(xs)
    sd = statistics.stdev(xs) if len(xs) > 1 else 0.0
    return f"{m:.0f} ± {sd:.0f}"


def main(path):
    data = json.load(open(path))
    reps = data["reps"]
    env = data["env"]
    rng = random.Random(0)
    rows = {}
    for rep in reps:
        nosync = {r["n"]: q(r["latency_us"], 0.5) for r in rep["runs"] if r["protocol"] == "2pc-nosync"}
        fs = rep["fsync_us"]
        for r in rep["runs"]:
            key = (r["protocol"], r["n"])
            row = rows.setdefault(key, {"p50": [], "p99": [], "hold": [], "msgs": r["messages_per_txn"], "forced": r["forced_per_txn"], "pred": []})
            row["p50"].append(q(r["latency_us"], 0.5))
            row["p99"].append(q(r["latency_us"], 0.99))
            row["hold"].append(q(r["hold_us"], 0.5))
            if r["protocol"] == "2pc":
                sims = [max(rng.choice(fs) for _ in range(r["n"])) + rng.choice(fs) for _ in range(20000)]
                row["pred"].append(nosync[r["n"]] + q(sims, 0.5))
    base = [q(rep["fsync_us"], 0.5) for rep in reps]
    base99 = [q(rep["fsync_us"], 0.99) for rep in reps]
    print(f"Environment: {env}")
    print(f"Single-process fdatasync of one 64-byte record: median {ms(base)} us, p99 {ms(base99)} us")
    print()
    print("| protocol | N | messages/txn | forced writes/txn | commit latency p50 (us) | p99 (us) | lock hold p50 (us) |")
    print("|---|---:|---:|---:|---:|---:|---:|")
    for (p, n), row in sorted(rows.items(), key=lambda kv: (["2pc", "pc", "implicit", "2pc-nosync"].index(kv[0][0]), kv[0][1])):
        print(f"| {p} | {n} | {row['msgs']:.0f} | {row['forced']:.0f} | {ms(row['p50'])} | {ms(row['p99'])} | {ms(row['hold'])} |")
    print()
    print("2PC median commit latency: measured vs. predicted from independent parts (us)")
    print("| N | measured | predicted (no-sync latency + max of N fsyncs + 1 fsync) |")
    print("|---:|---:|---:|")
    for (p, n), row in sorted(rows.items()):
        if p == "2pc":
            print(f"| {n} | {ms(row['p50'])} | {ms(row['pred'])} |")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "results.json")
