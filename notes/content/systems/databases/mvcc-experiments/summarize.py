"""Summarize bloat.json (experiment A) into the table the note quotes.

Run:  python3 summarize.py bloat.json > bloat.txt
"""
import json
import statistics
import sys

d = json.load(open(sys.argv[1]))
hold = d["args"]["hold"]


def at(run, t):
    """The last sample taken at or before time t."""
    return [s for s in run["samples"] if s["t"] <= t + 0.5][-1]


def ms(xs, fmt="{:.1f}"):
    m = statistics.mean(xs)
    sd = statistics.stdev(xs) if len(xs) > 1 else 0.0
    return f"{fmt.format(m)} ± {fmt.format(sd)}"


print(f"PostgreSQL {d['settings']['server_version']}, {d['rows']:,} rows, {d['args']['rate']:.0f} updates/s offered,"
      f" snapshot held for {hold:.0f} s of {d['args']['total']:.0f} s; mean ± sd over {d['args']['reps']} runs\n")
rows = [
    ("updates per second achieved", lambda r, s: r["updates"] / r["elapsed"], "{:.0f}"),
    ("heap size (MB)", lambda r, s: s["heap_bytes"] / 2**20, "{:.1f}"),
    ("index size (MB)", lambda r, s: s["index_bytes"] / 2**20, "{:.2f}"),
    ("dead tuples (stats)", lambda r, s: s["dead"], "{:.0f}"),
    ("HOT share of updates (%)", lambda r, s: 100 * s["hot_upd"] / max(1, s["upd"]), "{:.1f}"),
    ("fresh point read: buffers", lambda r, s: s["fresh_read_bufs"], "{:.1f}"),
    ("fresh point read: server us (median)", lambda r, s: s["fresh_read_us"], "{:.0f}"),
    ("old snapshot point read: buffers", lambda r, s: s.get("old_read_bufs", float("nan")), "{:.1f}"),
    ("old snapshot point read: server us (median)", lambda r, s: s.get("old_read_us", float("nan")), "{:.0f}"),
    ("count(*) seq scan (ms)", lambda r, s: s["seqscan_ms"], "{:.1f}"),
    ("autovacuum runs so far", lambda r, s: s["autovac"], "{:.1f}"),
]
for label, t in (("while the snapshot is held", hold - 5), ("at the end, after release", d["args"]["total"])):
    print(f"## {label} (t = {t:.0f} s)")
    print(f"{'':44s} {'no snapshot':>18s} {'held snapshot':>18s}")
    for name, f, fmt in rows:
        cells = []
        for cond in ("none", "held"):
            runs = [r for r in d["runs"] if r["cond"] == cond]
            vals = [f(r, at(r, t)) for r in runs]
            vals = [v for v in vals if v == v]
            cells.append(ms(vals, fmt) if vals else "-")
        print(f"{name:44s} {cells[0]:>18s} {cells[1]:>18s}")
    print()

print("## held condition over time (run 1)")
r = [r for r in d["runs"] if r["cond"] == "held"][0]
for s in r["samples"][::3]:
    print(f"t={s['t']:6.1f}  heap {s['heap_bytes']/2**20:6.1f} MB  dead {s['dead']:7d}  fresh bufs {s['fresh_read_bufs']:5.1f}  "
          f"old bufs {s.get('old_read_bufs', float('nan')):5.1f}  seqscan {s['seqscan_ms']:6.1f} ms")
