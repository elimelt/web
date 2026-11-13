"""Flow-control experiments on a real Linux TCP stack over an emulated link.

Two network namespaces (sender, receiver) are joined by TUN devices, and
linkem.c moves packets between them with a fixed rate and one-way delay.
Needs root, iproute2 and tcpdump, and a compiled linkem binary:

    cc -O2 -Wall -o linkem linkem.c
    sudo python3 run_experiments.py window   # goodput vs receive buffer
    sudo python3 run_experiments.py zero     # zero window and persist probes
    sudo python3 run_experiments.py trickle  # receiver silly-window avoidance

Each command writes a JSON file of raw results beside this script.
"""

import json
import os
import platform
import statistics
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LINKEM = os.environ.get("LINKEM", os.path.join(HERE, "linkem"))
ENDPOINT = os.path.join(HERE, "endpoint.py")
SND, RCV = "fc_snd", "fc_rcv"
RATE_MBIT = 200


def sh(cmd, **kw):
    return subprocess.run(cmd, shell=True, check=True, text=True, **kw)


def setup():
    for ns in (SND, RCV):
        subprocess.run(f"ip netns del {ns}", shell=True, stderr=subprocess.DEVNULL)
        sh(f"ip netns add {ns} && ip -n {ns} link set lo up")
    sh(f"ip netns exec {SND} ip tuntap add dev tun0 mode tun")
    sh(f"ip netns exec {RCV} ip tuntap add dev tun1 mode tun")
    sh(f"ip -n {SND} addr add 10.9.0.1 peer 10.9.0.2 dev tun0")
    sh(f"ip -n {RCV} addr add 10.9.0.2 peer 10.9.0.1 dev tun1")
    sh(f"ip -n {SND} link set tun0 up mtu 1500 txqueuelen 10000")
    sh(f"ip -n {RCV} link set tun1 up mtu 1500 txqueuelen 10000")


def environment():
    def read(path):
        try:
            return open(path).read().strip()
        except OSError:
            return None
    cpu = next((l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name")), None)
    return {
        "kernel": platform.release(),
        "cpu": cpu,
        "cores": os.cpu_count(),
        "python": platform.python_version(),
        "congestion_control": read("/proc/sys/net/ipv4/tcp_congestion_control"),
        "tcp_rmem": read("/proc/sys/net/ipv4/tcp_rmem"),
        "rmem_max": read("/proc/sys/net/core/rmem_max"),
        "tcp_moderate_rcvbuf": read("/proc/sys/net/ipv4/tcp_moderate_rcvbuf"),
        "link_rate_mbit": RATE_MBIT,
        "mtu": 1500,
    }


class Link:
    def __init__(self, one_way_ms, queue_kb=16384):
        self.cmd = [LINKEM, "--ns-a", SND, "--ns-b", RCV, "--delay-ms", str(one_way_ms),
                    "--rate-mbit", str(RATE_MBIT), "--queue-kb", str(queue_kb)]

    def __enter__(self):
        self.proc = subprocess.Popen(self.cmd, stderr=subprocess.PIPE, text=True)
        time.sleep(0.3)
        return self

    def __exit__(self, *exc):
        self.proc.terminate()
        _, err = self.proc.communicate()
        self.log = err.strip().splitlines()[-1]
        if "dropped" in self.log and "(0 dropped)" not in self.log.replace("(0 dropped), ", "", 1):
            print("  warning:", self.log, file=sys.stderr)


def transfer(recv_args, duration, sample=0.05):
    rcv = subprocess.Popen(["ip", "netns", "exec", RCV, "python3", "-I", ENDPOINT, "recv", *recv_args],
                           stdout=subprocess.PIPE, text=True)
    assert json.loads(rcv.stdout.readline())["ready"]
    out = subprocess.run(["ip", "netns", "exec", SND, "python3", "-I", ENDPOINT, "send",
                          "--duration", str(duration), "--sample", str(sample)],
                         check=True, capture_output=True, text=True).stdout
    rcv_out = json.loads(rcv.stdout.readline())
    rcv.wait()
    return json.loads(out), rcv_out


def window_sweep():
    rtts_ms = [100, 40, 10]  # slowest first
    requests = [16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 0]
    reps, duration, measure_from = 3, 6.0, 3.0
    runs = []
    t0 = time.monotonic()
    for rtt in rtts_ms:
        for req in requests:
            for rep in range(reps):
                with Link(rtt / 2) as link:
                    snd, rcv = transfer(["--rcvbuf", str(req)] if req else [], duration)
                s = [x for x in snd["samples"] if x["t"] >= measure_from]
                span = s[-1]["t"] - s[0]["t"]
                goodput = (s[-1]["bytes_acked"] - s[0]["bytes_acked"]) * 8 / span / 1e6
                wnd = statistics.median(x["snd_wnd"] for x in s)
                rwnd_frac = (s[-1]["rwnd_limited_us"] - s[0]["rwnd_limited_us"]) / (span * 1e6)
                srtt = statistics.median(x["rtt_us"] for x in s) / 1e3
                runs.append({
                    "rtt_ms": rtt, "rcvbuf_request": req, "rep": rep,
                    "so_rcvbuf_effective": rcv["so_rcvbuf_effective"], "rcv_wscale": rcv["rcv_wscale"],
                    "goodput_mbit": goodput, "median_adv_window": wnd,
                    "median_srtt_ms": srtt, "rwnd_limited_frac": rwnd_frac,
                    "retrans": s[-1]["retrans"], "linkem": link.log,
                })
                print(f"rtt {rtt:>3} ms  req {req:>8}  rep {rep}  eff {rcv['so_rcvbuf_effective']:>8}  "
                      f"wnd {wnd:>9}  srtt {srtt:6.1f} ms  goodput {goodput:7.2f} Mbit/s  "
                      f"rwnd-limited {rwnd_frac:5.2f}  [{time.monotonic() - t0:5.0f} s]", flush=True)
    return {"environment": environment(), "duration_s": duration, "measure_from_s": measure_from,
            "runs": runs}


def capture(seconds_guard, recv_args, duration, one_way_ms):
    pcap = os.path.join(HERE, "work.pcap")
    with Link(one_way_ms):
        dump = subprocess.Popen(["ip", "netns", "exec", SND, "tcpdump", "-i", "tun0", "-n", "-s", "96",
                                 "-w", pcap, "tcp port 5001"], stderr=subprocess.DEVNULL)
        try:
            time.sleep(1.0)
            snd, rcv = transfer(recv_args, duration, sample=0.1)
            time.sleep(seconds_guard)
        finally:
            dump.terminate()
            dump.wait()
    text = subprocess.run(["tcpdump", "-r", pcap, "-n", "-tt", "-S", "-v"], capture_output=True,
                          text=True).stdout
    os.remove(pcap)
    return snd, rcv, parse_tcpdump(text)


def parse_tcpdump(text):
    """Turn `tcpdump -n -tt -S -v` output into one dict per TCP segment."""
    import re
    pkts = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"^(\d+\.\d+) IP ", line)
        if not m or i + 1 >= len(lines):
            continue
        body = lines[i + 1].strip()
        hdr = re.match(r"(\S+)\.(\d+) > (\S+)\.(\d+): Flags \[([^\]]*)\]", body)
        if not hdr:
            continue
        seq = re.search(r"seq (\d+)(?::(\d+))?", body)
        ack = re.search(r"ack (\d+)", body)
        win = re.search(r"win (\d+)", body)
        length = re.search(r"length (\d+)", body)
        pkts.append({
            "t": float(m.group(1)),
            "dir": "data" if hdr.group(4) == "5001" else "ack",
            "flags": hdr.group(5),
            "seq": int(seq.group(1)) if seq else None,
            "seq_end": int(seq.group(2)) if seq and seq.group(2) else None,
            "ack": int(ack.group(1)) if ack else None,
            "win_raw": int(win.group(1)) if win else None,
            "len": int(length.group(1)) if length else 0,
        })
    return pkts


def zero_window():
    # Receiver asks for a 64 KiB buffer and reads nothing for 20 s, then drains.
    snd, rcv, pkts = capture(1.0, ["--rcvbuf", "65536", "--mode", "stall", "--stall", "20"],
                             duration=24, one_way_ms=20)
    return {"environment": environment(), "rtt_ms": 40, "rcvbuf_request": 65536, "stall_s": 20,
            "receiver": rcv, "sender_samples": snd["samples"], "snd_wscale": snd["snd_wscale"],
            "packets": pkts}


def trickle():
    # Receiver fills a small buffer, then reads 200 bytes every 20 ms (10 kB/s).
    snd, rcv, pkts = capture(0.5, ["--rcvbuf", "16384", "--mode", "trickle", "--stall", "2",
                                   "--chunk", "200", "--interval", "0.02", "--trickle-for", "6"],
                             duration=7.5, one_way_ms=20)
    return {"environment": environment(), "rtt_ms": 40, "rcvbuf_request": 16384,
            "read_chunk": 200, "read_interval_s": 0.02,
            "receiver": rcv, "snd_wscale": snd["snd_wscale"], "snd_mss": snd["snd_mss"],
            "packets": pkts}


def main():
    what = sys.argv[1]
    setup()
    result = {"window": window_sweep, "zero": zero_window, "trickle": trickle}[what]()
    path = os.path.join(HERE, f"results_{what}.json")
    with open(path, "w") as f:
        json.dump(result, f, indent=1)
    print("wrote", path)


if __name__ == "__main__":
    main()
