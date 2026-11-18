"""Independent reference for the figure's transfer-time model.

An event-driven simulation (heap of timed events) of the same assumptions as
model.ts: segments of MSS payload plus 52 header bytes serialized at R, one-way
delay d = RTT/2 each way, one ACK per segment, cwnd += 1 per ACK from w0, no
loss. The sender starts 1.5 RTT after connect() on a new connection and 0.5 RTT
after the request on an open one. Prints a JSON fixture of last-byte arrival
times for a few paths and sizes.

    python3 model_reference.py > transfer-time.fixture.json
"""

import heapq
import json
import math

MSS, HEADER = 1448, 52


def simulate(rate_mbit, rtt_ms, w0, start, n):
    d = rtt_ms / 2e3
    segs = max(1, math.ceil(n / MSS))
    sizes = [MSS] * (segs - 1) + [n - MSS * (segs - 1)]
    t_start = (3 if start == "fresh" else 1) * d
    events = [(t_start, 0, "request")]
    seq = 1
    cwnd, next_seg, outstanding = w0, 0, 0
    wire_free = 0.0
    last_arrival = None
    while events:
        t, _, kind, *rest = heapq.heappop(events)
        if kind == "ack":
            outstanding -= 1
            cwnd += 1
        elif kind == "arrive":
            heapq.heappush(events, (t + d, seq, "ack"))
            seq += 1
            if rest[0] == segs - 1:
                last_arrival = t
            continue
        while next_seg < segs and outstanding < cwnd:
            depart = max(wire_free, t) + (sizes[next_seg] + HEADER) * 8 / (rate_mbit * 1e6)
            wire_free = depart
            heapq.heappush(events, (depart + d, seq, "arrive", next_seg))
            seq += 1
            next_seg += 1
            outstanding += 1
    return last_arrival * 1e3


cases = []
for rate, rtt in [(10, 100), (100, 20), (1000, 2), (1000, 100), (100, 100)]:
    for w0, start in [(10, "fresh"), (10, "open"), (100000, "open")]:
        for n in [1, 1000, 1448, 14480, 14481, 65536, 262144, 1048576, 4194304]:
            cases.append({"rate": rate, "rtt": rtt, "w0": w0, "start": start, "n": n,
                          "ms": simulate(rate, rtt, w0, start, n)})
print(json.dumps(cases, indent=0))
