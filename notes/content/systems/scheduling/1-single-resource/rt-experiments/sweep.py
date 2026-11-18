"""Deadline-miss sweep: random periodic task sets under SCHED_FIFO with
rate-monotonic priorities and under SCHED_DEADLINE, on one isolated CPU.

usage (as root, after setup.sh):
  python3 sweep.py --rtrun ./rtrun --out results.json [--sets 25 --reps 3]

Task sets: n tasks, utilizations from UUniFast (Bini and Buttazzo 2005),
periods log-uniform in [10, 100] ms rounded to 1 ms, D = T, synchronous
release. SCHED_DEADLINE threads get runtime 1.02 C + 1 ms (see rtrun.c).
Each (set, policy) pair runs for --dur ms, --reps times; repetitions
are the outer loop so slow drift in the VM affects both policies alike.
"""
import argparse, json, math, random, subprocess, sys, time

def uunifast(n, u, rng):
    us, s = [], u
    for i in range(1, n):
        nxt = s * rng.random() ** (1.0 / (n - i))
        us.append(s - nxt); s = nxt
    return us + [s]

def make_set(n, u, rng):
    while True:
        T = [int(round(math.exp(rng.uniform(math.log(10), math.log(100))))) * 1000 for _ in range(n)]
        C = [max(50, int(ui * t)) for ui, t in zip(uunifast(n, u, rng), T)]
        if sum(c / t for c, t in zip(C, T)) <= 1.0 + 1e-12:
            return list(zip(C, T))

def rta_ok(tasks):
    """Exact response-time test for rate-monotonic order, D = T."""
    ts = sorted(tasks, key=lambda ct: ct[1])
    for i, (c, t) in enumerate(ts):
        r = c
        while True:
            nr = c + sum(math.ceil(r / tj) * cj for cj, tj in ts[:i])
            if nr > t: return False
            if nr == r: break
            r = nr
    return True

def run(rtrun, pol, tasks, dur, budget, cpuset, slack):
    inp = "".join(f"{c} {t}\n" for c, t in tasks)
    p = subprocess.run([rtrun, pol, str(dur), str(budget), cpuset, str(slack)], input=inp,
                       capture_output=True, text=True)
    if p.returncode != 0:
        return {"error": p.stderr.strip() or f"rc={p.returncode}"}
    jobs = misses = 0
    worst_lat = 0.0; worst_late = -1e18; lat = []
    per_task = {}
    for line in p.stdout.splitlines():
        i, rel, st, fin, r, m = map(int, line.split())
        jobs += 1; misses += m
        d = tasks[i][1] * 1000
        worst_late = max(worst_late, (fin - rel - d) / 1e6)
        lat.append((st - rel) / 1e3)
        per_task.setdefault(i, [0, 0]); per_task[i][0] += 1; per_task[i][1] += m
    lat.sort()
    return {"jobs": jobs, "misses": misses, "max_lateness_ms": worst_late,
            "release_latency_us_p50": lat[len(lat) // 2], "release_latency_us_max": lat[-1],
            "missed_tasks": sum(1 for v in per_task.values() if v[1]),
            "overruns": int(p.stderr.split("overruns")[-1]) if "overruns" in p.stderr else 0}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rtrun", default="./rtrun")
    ap.add_argument("--out", default="results.json")
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--sets", type=int, default=25)
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--dur", type=int, default=1000)
    ap.add_argument("--budget", type=int, default=2, help="SCHED_DEADLINE runtime margin, percent of C")
    ap.add_argument("--slack", type=int, default=1000, help="SCHED_DEADLINE runtime margin, microseconds")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--utils", default="0.70,0.75,0.80,0.85,0.90,0.95,0.98,1.00")
    ap.add_argument("--cpuset", default="/sys/fs/cgroup/cpuset/rt/tasks")
    a = ap.parse_args()
    rng = random.Random(a.seed)
    utils = [float(x) for x in a.utils.split(",")]
    sets = []
    for u in utils:
        for k in range(a.sets):
            ts = make_set(a.n, u, rng)
            sets.append({"target_u": u, "u": sum(c / t for c, t in ts), "tasks": ts,
                         "rm_rta_schedulable": rta_ok(ts),
                         "ll_bound_ok": sum(c / t for c, t in ts) <= a.n * (2 ** (1 / a.n) - 1),
                         "runs": {"rm": [], "edf": []}})
    t_start = time.time()
    for rep in range(a.reps):
        for si, s in enumerate(sets):
            for pol in ("rm", "edf"):
                s["runs"][pol].append(run(a.rtrun, pol, s["tasks"], a.dur, a.budget, a.cpuset, a.slack))
            if si % 20 == 0:
                print(f"rep {rep} set {si}/{len(sets)} elapsed {time.time()-t_start:.0f}s", flush=True)
        json.dump({"params": vars(a), "sets": sets}, open(a.out, "w"))
    print("done", time.time() - t_start, flush=True)

if __name__ == "__main__":
    main()
