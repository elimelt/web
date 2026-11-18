"""Summarize the fio JSON in res/ (and res2/) into summary.json: median and min-max over runs."""
import json, glob, os, re, statistics as st, sys
base = sys.argv[1] if len(sys.argv) > 1 else "."
def load(pat):
    out = {}
    for f in sorted(glob.glob(os.path.join(base, pat))):
        m = re.match(r"(.+)\.r(\d+)\.json$", os.path.basename(f))
        if not m or os.path.getsize(f) == 0: continue
        out.setdefault(m.group(1), []).append(json.load(open(f)))
    return out
def agg(vals):
    return {"median": st.median(vals), "min": min(vals), "max": max(vals), "n": len(vals)}
def side(j):
    jb = j["jobs"][0]
    return jb["read"] if jb["read"]["total_ios"] > 0 else jb["write"]
summary = {}
for name, runs in load("res/*.r*.json").items():
    xs = [side(r) for r in runs]
    jb = [r["jobs"][0] for r in runs]
    row = {
        "iops": agg([x["iops"] for x in xs]),
        "mibps": agg([x["bw"] / 1024 for x in xs]),
        "lat_us": agg([x["lat_ns"]["mean"] / 1e3 for x in xs]),
        "clat_p50_us": agg([x["clat_ns"]["percentile"]["50.000000"] / 1e3 for x in xs]),
        "clat_p99_us": agg([x["clat_ns"]["percentile"]["99.000000"] / 1e3 for x in xs]),
        "cpu_pct": agg([j["usr_cpu"] + j["sys_cpu"] for j in jb]),
    }
    if "sync" in jb[0] and jb[0]["sync"]["lat_ns"].get("mean"):
        s = [j["sync"]["lat_ns"] for j in jb]
        row["sync_mean_us"] = agg([v["mean"] / 1e3 for v in s])
        row["sync_p50_us"] = agg([v["percentile"]["50.000000"] / 1e3 for v in s])
        row["sync_p99_us"] = agg([v["percentile"]["99.000000"] / 1e3 for v in s])
    summary[name] = row
for name, runs in load("res2/*.r*.json").items():
    xs = [side(r) for r in runs]
    summary[name] = {"iops": agg([x["iops"] for x in xs]), "lat_us": agg([x["lat_ns"]["mean"] / 1e3 for x in xs]),
                     "clat_p50_us": agg([x["clat_ns"]["percentile"]["50.000000"] / 1e3 for x in xs])}
for rw in ("randread", "randwrite"):
    f = os.path.join(base, f"res/ts-{rw}.json")
    if os.path.exists(f):
        x = side(json.load(open(f)))
        log = sorted(glob.glob(os.path.join(base, f"res/ts-{rw}_iops*.log")))
        per_s = [int(l.split(",")[1]) for l in open(log[0])] if log else []
        summary[f"ts-{rw}"] = {"iops": x["iops"], "per_second": per_s}
json.dump(summary, open(os.path.join(base, "summary.json"), "w"), indent=1)
def fmt(n, k): r = summary.get(n, {}).get(k); return "-" if not r else f"{r['median']:.1f} [{r['min']:.1f}-{r['max']:.1f}]"
for n in sorted(summary):
    if n.startswith("ts-"): continue
    print(n.ljust(22), "iops", fmt(n, "iops"), "lat", fmt(n, "lat_us"), "p99", fmt(n, "clat_p99_us"), "sync", fmt(n, "sync_mean_us"), "sync p99", fmt(n, "sync_p99_us"), "cpu", fmt(n,"cpu_pct"))
