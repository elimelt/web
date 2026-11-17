#!/usr/bin/env python3
"""Runs the load sweep for the admission-control note.

For each policy, offered load and seed it starts a fresh server pinned to
CPUs 0-1, offers Poisson load from a load generator pinned to CPUs 2-3, and
records the load generator's summary and the server's counters. Results are
appended to results.jsonl, one line per run, so an interrupted sweep resumes.

  go build -o bin/server ./server && go build -o bin/loadgen ./loadgen
  python3 run.py --rates 500,1000 --policies none,fixed --seeds 1

The spike experiment uses the same runner with retries and a load step:

  python3 run.py --rates 1400 --policies none,fixed,codel,gradient --retries 2 \
      --spike 4,2,3500 --duration 16 --warmup 0 --out spike.jsonl
"""
import argparse, json, os, subprocess, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def stats():
    # The server speaks HTTP/2 without TLS only, so use curl's prior knowledge.
    out = subprocess.run(["curl", "-s", "--http2-prior-knowledge", "http://127.0.0.1:8080/stats"], capture_output=True, text=True)
    return json.loads(out.stdout)


def spike_args(args):
    if not args.spike:
        return []
    at, length, rate = args.spike.split(",")
    return ["-spike-at", f"{at}s", "-spike-for", f"{length}s", "-spike-rate", rate]


def run_one(policy, rate, seed, args):
    env = dict(os.environ, GOMAXPROCS="2")
    srv = subprocess.Popen(["taskset", "-c", "0,1", os.path.join(args.bin, "server"), "-policy", policy], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(0.5)
        before = stats()
        t0 = time.time()
        lg = subprocess.run(["taskset", "-c", "2,3", os.path.join(args.bin, "loadgen"), "-rate", str(rate),
                             "-work", str(args.work), "-duration", f"{args.duration}s", "-warmup", f"{args.warmup}s",
                             "-seed", str(seed), "-retries", str(args.retries)] + spike_args(args), env=env, capture_output=True, text=True, check=True)
        elapsed = time.time() - t0
        after = stats()
    finally:
        srv.kill()
        srv.wait()
    out = json.loads(lg.stdout)
    done = (after["served"] + after["abandoned"]) - (before["served"] + before["abandoned"])
    out.update(policy=policy, rate=rate, seed=seed, retries=args.retries, spike=args.spike, server=after, server_completions=done, elapsed_s=elapsed)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rates", required=True)
    ap.add_argument("--policies", default="none,fixed,queue,codel,gradient")
    ap.add_argument("--seeds", default="1,2,3")
    ap.add_argument("--work", type=int, default=11000)
    ap.add_argument("--duration", type=float, default=12)
    ap.add_argument("--warmup", type=float, default=2)
    ap.add_argument("--retries", type=int, default=0, help="immediate retries per failed attempt")
    ap.add_argument("--spike", default="", help="at,length,rate: offer `rate` from second `at` for `length` seconds")
    ap.add_argument("--bin", default=os.path.join(HERE, "bin"))
    ap.add_argument("--out", default=os.path.join(HERE, "results.jsonl"))
    args = ap.parse_args()
    done = set()
    if os.path.exists(args.out):
        for line in open(args.out):
            r = json.loads(line)
            done.add((r["policy"], r["rate"], r["seed"]))
    for seed in [int(s) for s in args.seeds.split(",")]:
        for rate in [int(r) for r in args.rates.split(",")]:
            for policy in args.policies.split(","):
                if (policy, rate, seed) in done:
                    continue
                r = run_one(policy, rate, seed, args)
                with open(args.out, "a") as f:
                    f.write(json.dumps(r) + "\n")
                print(f"{policy:9s} rate={rate:5d} seed={seed} goodput={r['goodput_rps']:7.1f} shed={r['shed_rps']:7.1f} "
                      f"timeout={r['timeout_rps']:7.1f} p99={r['p99_ms']:6.1f}ms", flush=True)
                time.sleep(0.5)


if __name__ == "__main__":
    main()
