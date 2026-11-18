"""Transfer time versus message size over an emulated path.

Two network namespaces (client, server) are joined by TUN devices, and
linkem.c moves packets between them at a fixed rate with a fixed one-way
delay. Needs root, iproute2 and a compiled linkem:

    cc -O2 -Wall -o linkem linkem.c
    sudo python3 run_experiments.py            # full sweep -> results.json
    sudo python3 run_experiments.py --quick    # one configuration, for a smoke test

For each path (rate, RTT) and congestion controller the client times four
kinds of transfer of n bytes:
    udp    a back-to-back burst of datagrams, first send to last arrival (one way)
    fresh  a new TCP connection: connect(), request, receive n bytes
    warm   the same request on a connection that has just moved 4 BDP of data
    idle   as warm, but after the connection has been idle for 1 s
"""

import argparse
import json
import os
import platform
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LINKEM = os.environ.get("LINKEM", os.path.join(HERE, "linkem"))
ENDPOINT = os.path.join(HERE, "endpoint.py")
CLI, SRV = "pf_cli", "pf_srv"
MSS_WIRE = 1500


def sh(cmd):
    return subprocess.run(cmd, shell=True, check=True, text=True)


def setup():
    for ns in (CLI, SRV):
        subprocess.run(f"ip netns del {ns}", shell=True, stderr=subprocess.DEVNULL)
        sh(f"ip netns add {ns} && ip -n {ns} link set lo up")
    sh(f"ip netns exec {CLI} ip tuntap add dev tun0 mode tun")
    sh(f"ip netns exec {SRV} ip tuntap add dev tun1 mode tun")
    sh(f"ip -n {CLI} addr add 10.10.0.1 peer 10.10.0.2 dev tun0")
    sh(f"ip -n {SRV} addr add 10.10.0.2 peer 10.10.0.1 dev tun1")
    sh(f"ip -n {CLI} link set tun0 up mtu 1500 txqueuelen 20000")
    sh(f"ip -n {SRV} link set tun1 up mtu 1500 txqueuelen 20000")


def environment():
    def read(path):
        try:
            return open(path).read().strip()
        except OSError:
            return None
    cpu = next((l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name")), None)
    return {
        "kernel": platform.release(), "cpu": cpu, "cores": os.cpu_count(),
        "python": platform.python_version(),
        "tcp_slow_start_after_idle": read("/proc/sys/net/ipv4/tcp_slow_start_after_idle"),
        "tcp_rmem": read("/proc/sys/net/ipv4/tcp_rmem"), "tcp_wmem": read("/proc/sys/net/ipv4/tcp_wmem"),
        "mtu": 1500,
    }


def run_config(rate_mbit, rtt_ms, cc, sizes, modes, reps, max_s, queue_kb=None):
    bdp = rate_mbit * 1e6 / 8 * rtt_ms / 1e3
    if queue_kb is None:  # two BDP of buffering, at least 200 packets
        queue_kb = max(2 * bdp, 200 * MSS_WIRE) / 1024
    link = subprocess.Popen([LINKEM, "--ns-a", CLI, "--ns-b", SRV, "--delay-ms", str(rtt_ms / 2),
                             "--rate-mbit", str(rate_mbit), "--queue-kb", f"{queue_kb:.0f}"],
                            stderr=subprocess.PIPE, text=True)
    log = os.path.join(HERE, "server.log")
    open(log, "w").close()
    srv = subprocess.Popen(["ip", "netns", "exec", SRV, "python3", "-I", ENDPOINT, "server",
                            "--cc", "bbr" if cc == "udp" else cc, "--log", log], stdout=subprocess.PIPE, text=True)
    assert json.loads(srv.stdout.readline())["ready"]
    time.sleep(0.3)
    trials = []
    for rep in range(reps):
        for n in sizes:
            if n * 8 / (rate_mbit * 1e6) > max_s:
                continue
            for mode in modes:
                if mode == "udp" and n > 16 << 20:
                    continue
                trials.append({"mode": mode, "n": n, "rep": rep})
    plan = {"trials": trials, "primer": int(max(4 * bdp, 1 << 20)), "idle_s": 1.0, "gap_s": 0.05}
    out = subprocess.run(["ip", "netns", "exec", CLI, "python3", "-I", ENDPOINT, "client",
                          "--plan", json.dumps(plan)], check=True, capture_output=True, text=True).stdout
    srv.terminate()
    srv.wait()
    link.terminate()
    _, err = link.communicate()
    server_log = [json.loads(l) for l in open(log)]
    results = json.loads(out)
    for r in results:
        r.update({"rate_mbit": rate_mbit, "rtt_ms": rtt_ms, "cc": cc})
    return {"rate_mbit": rate_mbit, "rtt_ms": rtt_ms, "cc": cc, "queue_kb": round(queue_kb),
            "primer": plan["primer"], "linkem": err.strip().splitlines()[-1],
            "trials": results, "server_log": server_log}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--out", default=os.path.join(HERE, "results.json"))
    ap.add_argument("--resume", action="store_true", help="keep configurations already in --out")
    ap.add_argument("--wmem-max", type=int, default=0,
                    help="send-buffer follow-up: raise the server's tcp_wmem maximum to this many bytes "
                         "and time warm transfers on the 1 Gbit/s, 100 ms path only")
    a = ap.parse_args()
    setup()
    if a.wmem_max:
        sh(f'ip netns exec {SRV} sysctl -q -w net.ipv4.tcp_wmem="4096 16384 {a.wmem_max}"')
        configs = []
        for cc in ["bbr", "cubic"]:
            c = run_config(1000, 100, cc, [1 << k for k in range(20, 27, 2)], ["warm"], 3, max_s=4.0)
            c["tcp_wmem_server_ns"] = subprocess.run(["ip", "netns", "exec", SRV, "cat", "/proc/sys/net/ipv4/tcp_wmem"],
                                                     capture_output=True, text=True).stdout.strip()
            configs.append(c)
            print(f"wmem-max {a.wmem_max}  {cc}  {c['linkem']}", flush=True)
        json.dump({"environment": environment(), "configs": configs}, open(a.out, "w"))
        return
    sizes = [1 << k for k in range(10, 27, 2)]  # 1 KiB .. 64 MiB, factor 4
    tcp_modes = ["fresh", "warm", "idle"]
    if a.quick:
        paths, ccs, reps = [(100, 20)], ["bbr"], 1
    else:
        paths = [(r, t) for t in (100, 20, 2) for r in (10, 100, 1000)]  # slowest first
        ccs, reps = ["bbr", "cubic"], 5
    t0 = time.monotonic()
    configs = json.load(open(a.out))["configs"] if a.resume else []
    done = {(c["rate_mbit"], c["rtt_ms"], c["cc"]) for c in configs}
    for rate, rtt in paths:
        # The UDP burst is the path's floor: it must not be dropped, so the queue holds 64 MiB.
        runs = [("udp", ["udp"], 64 * 1024)] + [(cc, tcp_modes, None) for cc in ccs]
        for cc, modes, qkb in runs:
            if (rate, rtt, cc) in done:
                continue
            c = run_config(rate, rtt, cc, sizes, modes, reps, max_s=4.0, queue_kb=qkb)
            configs.append(c)
            print(f"{rate:>5} Mbit/s  rtt {rtt:>3} ms  {cc:<5}  {len(c['trials'])} trials  {c['linkem']}  "
                  f"[{time.monotonic() - t0:.0f} s]", flush=True)
            c["kernel"] = platform.release()
            json.dump({"environment": environment(), "configs": configs}, open(a.out, "w"))
            if os.environ.get("BACKUP"):
                json.dump({"environment": environment(), "configs": configs}, open(os.environ["BACKUP"], "w"))
    print("done", file=sys.stderr)


if __name__ == "__main__":
    main()
