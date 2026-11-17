"""Summarize results.json: per-configuration latency percentiles, the model
calibration, and the data file the figure loads.

usage: python3 summarize.py results.json figure-data.json > results.txt
"""
import json, statistics, sys

def pct(xs, q):
    xs = sorted(xs)
    i = (len(xs) - 1) * q
    lo, hi = int(i), min(int(i) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)

def stats(reps):
    pooled = [x / 1e3 for r in reps for x in r]
    meds = [pct([x / 1e3 for x in r], 0.5) for r in reps]
    return {"p50": round(pct(pooled, 0.5), 3), "p25": round(pct(pooled, 0.25), 3), "p75": round(pct(pooled, 0.75), 3),
            "p99": round(pct(pooled, 0.99), 3), "lo": round(min(meds), 3), "hi": round(max(meds), 3), "n": len(pooled)}

def key(rtts, downs, op, via):
    return f"{','.join(str(r) for r in rtts)}|{','.join(str(d) for d in downs)}|{op}|{via}"

def main():
    res = json.load(open(sys.argv[1]))
    groups = {}
    fsync0 = []
    fsync_by_r = {}
    for run in res["runs"]:
        rtts = run["delays"][1:]
        if run["exp"] == "sym3":
            for op in ["put", "get-linearizable", "get-serializable"]:
                groups.setdefault(key(rtts, [], op, 0), []).append(run[op])
            fsync_by_r.setdefault(rtts[0], []).append(run["fsync_ms"]["0"] if "0" in run["fsync_ms"] else run["fsync_ms"][0])
        elif run["exp"] == "five":
            for op in ["put", "get-linearizable"]:
                groups.setdefault(key(rtts, run["killed"], op, 0), []).append(run[op])
        elif run["exp"] == "via":
            for op in ["put", "get-serializable"]:
                groups.setdefault(key(rtts, [], op, run["member"]), []).append(run[op])
    points = {k: stats(v) for k, v in groups.items()}
    F = statistics.mean(fsync_by_r[0])
    cal = {"fsync": round(F, 3), "overhead": {
        "put": round(points[key([0, 0], [], "put", 0)]["p50"] - F, 3),
        "get-linearizable": round(points[key([0, 0], [], "get-linearizable", 0)]["p50"], 3),
        "get-serializable": round(points[key([0, 0], [], "get-serializable", 0)]["p50"], 3)}}
    json.dump({"etcd": res["etcd"], "calibration": cal, "points": points}, open(sys.argv[2], "w"), indent=1, sort_keys=True)
    print(f"etcd {res['etcd']}; latencies in ms; p50 [lowest..highest repetition median] p25 p75 p99, n requests")
    print(f"calibration from the 0 ms runs: leader WAL fsync mean {cal['fsync']} ms; fixed overhead {cal['overhead']}")
    print("leader WAL fsync mean by follower RTT:", {r: round(statistics.mean(v), 3) for r, v in sorted(fsync_by_r.items())})
    for k in sorted(points, key=lambda k: (k.split("|")[2], k.split("|")[3], [float(x) for x in k.split("|")[0].split(",")], k.split("|")[1])):
        p = points[k]
        print(f"{k:42s} p50 {p['p50']:8.3f} [{p['lo']:.3f}..{p['hi']:.3f}]  p25 {p['p25']:8.3f}  p75 {p['p75']:8.3f}  p99 {p['p99']:8.3f}  n {p['n']}")

main()
