#!/usr/bin/env python3
"""Count executions per call under at-least-once and at-most-once RPC.

Drops are made by the kernel: iptables rules on the loopback interface drop
each request (destination port = server) with probability q and each reply
(source port = server) with probability r, independently per packet, using
the `statistic --mode random` match. Requires root.

Part 1 (loss): q, r over a grid, modes alo and amo, 4 attempts per call.
Part 2 (crash): reply loss r = 0.1, the server process is killed with SIGKILL
every U(20, 60) ms and restarted; modes alo, amo (table in memory) and
amo-recover (table rebuilt from the ledger), retries unbounded.

Usage: sudo python3 run_sem.py [--quick]  -> sem-results.json
"""
import argparse
import collections
import json
import os
import random
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "bin", "sem")
PORT = 47201


def ipt(action, q, r):
    rules = []
    if q > 0:
        rules.append(["--dport", str(PORT), q])
    if r > 0:
        rules.append(["--sport", str(PORT), r])
    for match, port, p in rules:
        subprocess.run(["iptables", action, "INPUT", "-i", "lo", "-p", "udp", match, port,
                        "-m", "statistic", "--mode", "random", "--probability", f"{p:.6f}",
                        "-j", "DROP"], check=True)


def drop_counters():
    """Packets dropped so far by our two rules, keyed by 'req' / 'rep'."""
    out = subprocess.run(["iptables", "-L", "INPUT", "-n", "-v", "-x"], check=True,
                         capture_output=True, text=True).stdout
    got = {"req": 0, "rep": 0}
    for line in out.splitlines():
        if "statistic" not in line:
            continue
        pkts = int(line.split()[0])
        if f"dpt:{PORT}" in line:
            got["req"] += pkts
        if f"spt:{PORT}" in line:
            got["rep"] += pkts
    return got


def start_server(mode, recover, ledger):
    args = [BIN, "server", "-mode", mode, "-ledger", ledger, "-port", str(PORT)]
    if recover:
        args.append("-recover")
    p = subprocess.Popen(args, stdout=subprocess.PIPE, text=True)
    assert p.stdout.readline().strip() == "ready"
    return p


def run_one(mode, recover, q, r, calls, attempts, crash_ms=None, seed=0):
    tmp = tempfile.mkdtemp(prefix="sem-")
    ledger = os.path.join(tmp, "ledger.txt")
    ipt("-A", q, r)
    try:
        srv = [start_server(mode, recover, ledger)]
        crashes = [0]
        stop = threading.Event()

        def killer():
            rng = random.Random(seed)
            while not stop.is_set():
                time.sleep(rng.uniform(*crash_ms) / 1000)
                if stop.is_set():
                    break
                srv[0].kill()
                srv[0].wait()
                crashes[0] += 1
                srv[0] = start_server(mode, recover, ledger)

        th = None
        if crash_ms:
            th = threading.Thread(target=killer)
            th.start()
        t0 = time.time()
        cl = subprocess.run([BIN, "client", "-calls", str(calls), "-conc", "16",
                             "-attempts", str(attempts), "-timeout", "20ms",
                             "-port", str(PORT)], check=True, capture_output=True, text=True)
        wall = time.time() - t0
        stop.set()
        if th:
            th.join()
        drops = drop_counters()
        srv[0].kill()
        srv[0].wait()
    finally:
        ipt("-D", q, r)

    execs = collections.Counter()
    with open(ledger) as f:
        for line in f:
            execs[int(line.split()[0])] += 1
    hist = collections.Counter()
    fail_hist = collections.Counter()
    ok_n = 0
    sends = 0
    for line in cl.stdout.splitlines():
        cid, a, ok = (int(x) for x in line.split())
        k = execs.get(cid, 0)
        hist[k] += 1
        sends += a
        if ok:
            ok_n += 1
        else:
            fail_hist[k] += 1
    n = sum(hist.values())
    # Replies sent = executions + duplicates answered from the table, which is
    # not logged; the realized reply drop rate is therefore reported only
    # against the number of requests that reached the server.
    delivered = sends - drops["req"]
    return {
        "mode": mode + ("-recover" if recover else ""), "q": q, "r": r,
        "attempts": attempts, "calls": n, "crash_ms": crash_ms, "crashes": crashes[0],
        "wall_s": round(wall, 2), "sends": sends,
        "req_drop_rate": drops["req"] / sends if sends else 0,
        "rep_drop_rate": drops["rep"] / delivered if delivered else 0,
        "ok": ok_n / n,
        "hist": {str(k): v for k, v in sorted(hist.items())},
        "fail_hist": {str(k): v for k, v in sorted(fail_hist.items())},
        "dup": sum(v for k, v in hist.items() if k >= 2) / n,
        "zero": hist.get(0, 0) / n,
        "mean_exec": sum(k * v for k, v in hist.items()) / n,
        "ledger_records": sum(execs.values()),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--out", default=os.path.join(HERE, "sem-results.json"))
    a = ap.parse_args()
    calls = 800 if a.quick else 4800
    crash_calls = 4000 if a.quick else 24000
    loss = [(p, p) for p in (0, 0.01, 0.05, 0.1, 0.2, 0.3, 0.5)] + [(0.2, 0), (0, 0.2)]
    if a.quick:
        loss = [(0, 0), (0.2, 0.2)]
    results = []
    for run in range(a.runs):
        for q, r in loss:
            for mode in ("alo", "amo"):
                res = run_one(mode, False, q, r, calls, 4, seed=run)
                res["run"] = run
                results.append(res)
                print(json.dumps({k: res[k] for k in ("run", "mode", "q", "r", "ok", "dup", "zero", "mean_exec", "req_drop_rate", "rep_drop_rate", "wall_s")}), flush=True)
        for mode, rec in (("alo", False), ("amo", False), ("amo", True)):
            res = run_one(mode, rec, 0, 0.1, crash_calls, 0, crash_ms=(20, 60), seed=100 + run)
            res["run"] = run
            results.append(res)
            print(json.dumps({k: res[k] for k in ("run", "mode", "q", "r", "crashes", "calls", "ok", "dup", "zero", "mean_exec", "wall_s")}), flush=True)
    with open(a.out, "w") as f:
        json.dump({"machine": machine(), "results": results}, f, indent=1)


def machine():
    def sh(cmd):
        return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()
    return {
        "cpu": sh("lscpu | grep 'Model name' | sed 's/.*: *//'"),
        "vcpus": os.cpu_count(),
        "kernel": sh("uname -r"),
        "go": sh("go version"),
    }


if __name__ == "__main__":
    sys.exit(main())
