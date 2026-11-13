"""Summarize results_window.json into the table the note prints.

    python3 summarize.py
"""

import json
import os
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    d = json.load(open(os.path.join(HERE, "results_window.json")))
    rows = {}
    for r in d["runs"]:
        rows.setdefault((r["rtt_ms"], r["rcvbuf_request"]), []).append(r)
    print("rtt_ms request effective adv_window ratio srtt_ms goodput_mbit(min-max) predicted_mbit")
    for (rtt, req), rs in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1] or 1 << 40)):
        g = [r["goodput_mbit"] for r in rs]
        w = statistics.median(r["median_adv_window"] for r in rs)
        srtt = statistics.median(r["median_srtt_ms"] for r in rs)
        eff = rs[0]["so_rcvbuf_effective"]
        # Window-limited prediction: one advertised window per measured round trip.
        pred = w * 8 / (srtt / 1e3) / 1e6
        print(f"{rtt:>4} {req or 'auto':>8} {eff:>9} {w:>10.0f} {w / eff:5.2f} {srtt:6.1f} "
              f"{statistics.median(g):8.2f} ({min(g):.2f}-{max(g):.2f}) {pred:8.2f}")


if __name__ == "__main__":
    main()
