"""Summarize results.json: per path, controller, mode and size, the median and
range of the transfer times, next to the link floor d + L_wire/R and the
fresh-connection floor. Also writes transfer-times.json for the figure.

    python3 summarize.py [results.json] [transfer-times.json]
"""

import json
import statistics
import sys
from collections import defaultdict

src = sys.argv[1] if len(sys.argv) > 1 else "results.json"
dst = sys.argv[2] if len(sys.argv) > 2 else "transfer-times.json"
d = json.load(open(src))

UDP_PAYLOAD, MSS = 1472, 1448


def udp_wire(n):  # bytes on the wire for a burst of n payload bytes
    k = -(-n // UDP_PAYLOAD)
    return n + 28 * k


groups = defaultdict(list)
windows = []
for c in d["configs"]:
    for t in c["trials"]:
        groups[(c["rate_mbit"], c["rtt_ms"], c["cc"], t["mode"], t["n"])].append(t["t_s"] * 1e3)
    if c["cc"] == "udp":
        continue
    # The server logs TCP_INFO when each request arrives: one line per fresh
    # trial, two (primer, then the measured request) per warm or idle trial.
    # For warm trials the second line is the window the measured response
    # starts with; idle trials log the same value, because Linux applies the
    # idle restart when it next transmits, after the log line.
    log, i, warm_cwnd, rto = c["server_log"], 0, [], []
    for t in c["trials"]:
        if t["mode"] == "fresh":
            assert log[i]["n"] == t["n"]
            i += 1
            continue
        assert log[i + 1]["n"] == t["n"]
        if t["mode"] == "warm":
            warm_cwnd.append(log[i + 1]["cwnd"])
        else:
            rto.append(log[i + 1]["rto_us"] / 1e3)
        i += 2
    assert i == len(log)
    windows.append({"rate": c["rate_mbit"], "rtt": c["rtt_ms"], "cc": c["cc"],
                    "cwnd": statistics.median(warm_cwnd), "rto_ms": statistics.median(rto)})

points = []
for (rate, rtt, cc, mode, n), ts in sorted(groups.items()):
    points.append({"rate": rate, "rtt": rtt, "cc": cc, "mode": mode, "n": n, "reps": len(ts),
                   "med": round(statistics.median(ts), 3), "min": round(min(ts), 3), "max": round(max(ts), 3)})

print(f"{'rate':>5} {'rtt':>4} {'cc':<5} {'mode':<5} {'n':>9} {'median ms':>10} {'range':>17} {'floor ms':>9}")
for p in points:
    floor = p["rtt"] / 2 + udp_wire(p["n"]) * 8 / (p["rate"] * 1e3)
    print(f"{p['rate']:>5} {p['rtt']:>4} {p['cc']:<5} {p['mode']:<5} {p['n']:>9} {p['med']:>10.2f} "
          f"{p['min']:>8.2f}-{p['max']:<8.2f} {floor:>9.2f}")

print()
for w in windows:
    print(f"{w['rate']:>5} {w['rtt']:>4} {w['cc']:<5} cwnd at warm request {w['cwnd']:>7} segments, RTO {w['rto_ms']:.0f} ms")
env = d["environment"]
json.dump({"environment": {k: env[k] for k in ("kernel", "cpu", "cores")}, "windows": windows, "points": points},
          open(dst, "w"), separators=(",", ":"))
