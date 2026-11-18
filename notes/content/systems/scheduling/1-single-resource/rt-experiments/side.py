"""Smaller experiments beside the sweep (run as root after setup.sh):

1. platform noise: one task (C = 1 ms, T = 10 ms) alone on the isolated CPU
   under SCHED_FIFO, 5 s, 3 runs: release latency and the gap between wall
   time and thread CPU time during a job;
2. the separating example (C, T) = (20, 50) and (40, 70) ms, 5 runs per policy;
3. SCHED_DEADLINE runtime margin: one U = 0.70 task set from the sweep,
   runtime 1.02 C + slack for slack in {0, 50, 200, 1000} us, 5 runs each;
4. admission control at the default sched_rt_runtime_us = 950000: the largest
   single-thread bandwidth sched_setattr accepts on the one-CPU root domain.

  python3 side.py --rtrun ./rtrun --out side.json
"""
import argparse, json, subprocess, time

CPUSET = "/sys/fs/cgroup/cpuset/rt/tasks"

def run(rtrun, pol, tasks, dur, slack=1000, budget=2):
    inp = "".join(f"{c} {t}\n" for c, t in tasks)
    p = subprocess.run([rtrun, pol, str(dur), str(budget), CPUSET, str(slack)], input=inp, capture_output=True, text=True)
    jobs = [list(map(int, l.split())) for l in p.stdout.splitlines()]
    ov = int(p.stderr.split("overruns")[-1]) if "overruns" in p.stderr else None
    return p.returncode, jobs, ov

RT = "/proc/sys/kernel/sched_rt_runtime_us"

def read_rt():
    with open(RT) as f: return f.read().strip()

def set_rt(value):
    """Write the sysctl and read it back. The write fails with EBUSY while
    bandwidth of recently exited SCHED_DEADLINE threads is still reserved
    (until their 0-lag time), so retry for a few seconds."""
    for _ in range(20):
        try:
            with open(RT, "w") as f: f.write(value)
        except OSError:
            time.sleep(0.5); continue
        if read_rt() == value: return
    raise RuntimeError(f"could not set {RT} to {value}")

def pct(xs, q):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(q * len(xs)))]

def measure_runs(a, out):
    noise = []
    for r in range(3):
        _, jobs, _ = run(a.rtrun, "rm", [(1000, 10000)], 5000)
        lat = [(j[2] - j[1]) / 1e3 for j in jobs]
        extra = [(j[3] - j[2] - 1_000_000) / 1e3 for j in jobs]
        noise.append({"jobs": len(jobs), "release_latency_us": {q: pct(lat, v) for q, v in [("p50", .5), ("p99", .99), ("max", 1.0)]},
                      "wall_minus_cpu_us": {q: pct(extra, v) for q, v in [("p50", .5), ("p99", .99), ("max", 1.0)]}})
    out["noise"] = noise

    sep = {"rm": [], "edf": []}
    for r in range(5):
        for pol in ("rm", "edf"):
            _, jobs, ov = run(a.rtrun, pol, [(20000, 50000), (40000, 70000)], 700)
            jobs.sort(key=lambda j: (j[0], j[1]))
            sep[pol].append({"finish_ms": [round(j[3] / 1e6, 3) for j in jobs], "task": [j[0] for j in jobs],
                             "release_ms": [j[1] / 1e6 for j in jobs], "misses": sum(j[5] for j in jobs), "overruns": ov})
    out["separating"] = sep

    t07 = [(1775, 14000), (5338, 70000), (3224, 58000), (7197, 18000), (1284, 31000)]
    margin = {}
    for slack in (0, 50, 200, 1000):
        rows = []
        for r in range(5):
            _, jobs, ov = run(a.rtrun, "edf", t07, 1000, slack)
            rows.append({"jobs": len(jobs), "misses": sum(j[5] for j in jobs), "overruns": ov})
        margin[str(slack)] = rows
    out["runtime_margin"] = {"tasks": t07, "runs": margin}


def measure_admission(a, out):
    adm = {}
    old = read_rt()
    set_rt("950000")
    try:
        for c in (400000, 440000, 449000, 450000, 451000, 452000, 460000):
            rc, _, _ = run(a.rtrun, "edf", [(c, 500000)], 100, 0, 0)
            adm[f"{c / 500000:.3f}"] = rc == 0
    finally:
        set_rt(old)
    out["admission_default"] = adm

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--rtrun", default="./rtrun"); ap.add_argument("--out", default="side.json")
    ap.add_argument("--only", choices=["admission"], help="rerun one part and merge it into --out")
    a = ap.parse_args()
    out = json.load(open(a.out)) if a.only else {}
    if not a.only:
        measure_runs(a, out)
    measure_admission(a, out)
    json.dump(out, open(a.out, "w"), indent=1)

if __name__ == "__main__":
    main()
