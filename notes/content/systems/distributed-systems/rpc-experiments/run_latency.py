#!/usr/bin/env python3
"""Time one echo call locally and over loopback (UDP, TCP, HTTP/1.1+JSON,
gRPC). Three runs, each with a fresh server and fresh client processes.

Usage: python3 run_latency.py  -> latency-results.json, latency-results.txt
"""
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "bin", "latency")
RUNS = 3
SIZES = (16, 4096)
MODES = ("udp", "tcp", "http", "grpc")


def main():
    rows = []
    for run in range(RUNS):
        srv = subprocess.Popen([BIN, "server"], stdout=subprocess.PIPE, text=True)
        assert srv.stdout.readline().strip() == "ready"
        try:
            for size in SIZES:
                for mode in MODES:
                    out = subprocess.run([BIN, "client", "-mode", mode, "-n", "20000", "-warm", "2000", "-size", str(size)],
                                         check=True, capture_output=True, text=True).stdout
                    row = json.loads(out)
                    row["run"] = run
                    rows.append(row)
                    print(json.dumps(row), flush=True)
        finally:
            srv.kill()
            srv.wait()
        for size in SIZES:
            out = subprocess.run([BIN, "local", "-size", str(size)], check=True, capture_output=True, text=True).stdout
            for line in out.splitlines():
                row = json.loads(line)
                row["run"] = run
                rows.append(row)
                print(json.dumps(row), flush=True)

    def sh(cmd):
        return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()

    machine = {"cpu": sh("lscpu | grep 'Model name' | sed 's/.*: *//'"), "vcpus": os.cpu_count(),
               "kernel": sh("uname -r"), "go": sh("go version"),
               "grpc": sh(f"grep 'google.golang.org/grpc ' {HERE}/go.mod").strip()}
    json.dump({"machine": machine, "rows": rows}, open(os.path.join(HERE, "latency-results.json"), "w"), indent=1)

    order = ["local", "proto-marshal", "json-marshal", "udp", "tcp", "http", "grpc"]
    lines = [f"Machine: {machine}", "Median over 3 runs of each run's p50 / p99, microseconds (local and marshal: per call, batched).", ""]
    lines.append(f"{'mode':14} {'size':>5} | {'p50 (min..max of runs)':>26} | {'p99 (min..max)':>24}")
    for size in SIZES:
        for mode in order:
            rs = [r for r in rows if r["mode"] == mode and r["size"] == size]
            p50 = sorted(r["p50_us"] for r in rs)
            p99 = sorted(r["p99_us"] for r in rs)
            lines.append(f"{mode:14} {size:5d} | {p50[1]:9.3f} ({p50[0]:.3f}..{p50[-1]:.3f}) | {p99[1]:9.3f} ({p99[0]:.3f}..{p99[-1]:.3f})")
    txt = "\n".join(lines) + "\n"
    open(os.path.join(HERE, "latency-results.txt"), "w").write(txt)
    print(txt)


if __name__ == "__main__":
    main()
