"""Independent reference for the MlpTimeline figure's simulation.

Run beside the note: python3 mlp_queue_reference.py
Writes mlp_queue_reference.json, which notes/quartz-site/plugins/mdx/test/
mlp-timeline.test.mjs compares with the figure's TypeScript simulation.

The model: k chains, C miss buffers, FIFO admission. A chain issues its next
load when its previous load returns; the load starts when a buffer is free.
This version is written differently from the figure's (two heaps instead of a
queue and a scan over in-flight loads), so agreement checks the logic rather
than a copied loop.
"""

import heapq
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def simulate(chains, buffers, latencies):
    ready = [(0.0, seq, chain) for seq, chain in enumerate(range(chains))]
    heapq.heapify(ready)
    seq = chains
    free = [0.0] * buffers
    heapq.heapify(free)
    misses = []
    for index, lat in enumerate(latencies):
        t_ready, _, chain = heapq.heappop(ready)
        t_free = heapq.heappop(free)
        start = max(t_ready, t_free)
        end = start + lat
        misses.append({"chain": chain, "ready": t_ready, "start": start, "end": end})
        heapq.heappush(free, end)
        heapq.heappush(ready, (end, seq, chain))
        seq += 1
    ends = sorted(m["end"] for m in misses)
    half = len(ends) // 2
    t0, t1 = ends[half - 1], ends[-1]
    time_per_access = (t1 - t0) / (len(ends) - half)
    busy = sum(max(0.0, min(m["end"], t1) - max(m["start"], t0)) for m in misses)
    return misses, time_per_access, busy / (t1 - t0)


PHI = (5 ** 0.5 - 1) / 2


def spread(index):
    """Latencies between 120 and 240 ns from the golden-ratio sequence, which
    the test recomputes in JavaScript, so the file needs no latency list."""
    return 120 + 120 * ((index * PHI) % 1)


cases = []
for chains in (1, 8, 15, 16, 17, 32):
    for buffers in (10, 16):
        for kind in ("fixed", "spread"):
            lats = [178.0 if kind == "fixed" else spread(i) for i in range(2400)]
            misses, tpa, inflight = simulate(chains, buffers, lats)
            cases.append({
                "chains": chains,
                "buffers": buffers,
                "latency": kind,
                "time_per_access": round(tpa, 6),
                "in_flight": round(inflight, 6),
                "first": [[m["chain"], round(m["start"], 6), round(m["end"], 6)] for m in misses[:40]],
            })

(HERE / "mlp_queue_reference.json").write_text(json.dumps({"cases": cases}, separators=(",", ":")) + "\n")
print(f"{len(cases)} cases")
