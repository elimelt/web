"""Prints the tables the note quotes from results.json.

    python3 summarize.py results.json
"""

import json
import sys

res = json.load(open(sys.argv[1]))


def ci(s, scale=1.0, digits=1):
    return f"{s['mean'] * scale:.{digits}f} ({s['lo'] * scale:.{digits}f} to {s['hi'] * scale:.{digits}f})"


print("PBS Table 4 reproduction, N = 3: P(consistent at t = 0) in %, time to 99.9% in ms")
for r in res["pbs_table4"]:
    print(f"{r['profile']:9s} R={r['R']} W={r['W']}  {ci(r['p_consistent_t0'], 100, 2):28s} {ci(r['t_999_ms'], 1, 1)}")

print("\nN sweep, LNKD-DISK, R = W = 1")
for r in res["n_sweep"]:
    print(f"N={r['N']:2d}  {ci(r['p_consistent_t0'], 100, 1):24s} {ci(r['t_999_ms'], 1, 1)}")

print("\nFailures, LNKD-DISK: P(stale) in % at t (ms)")
for r in res["failures"]:
    cells = " ".join(f"{s['mean'] * 100:8.4f}" for s in r["p_stale"])
    print(
        f"D={r['outage_ms']:7.0f} f={r['f']:.2f} {r['N']}{r['R']}{r['W']} {'sloppy' if r['sloppy'] else 'strict'}  "
        f"t={r['t_ms']}  {cells}  write unavailable {r['p_write_unavailable']['mean'] * 100:.3f}%  "
        f"read unavailable at t=0 {r['p_read_unavailable'][0]['mean'] * 100:.3f}%"
    )
    print("      CI: " + " ".join(f"[{s['lo'] * 100:.4f},{s['hi'] * 100:.4f}]" for s in r["p_stale"]))

print("\nRing check", res["ring_check"])

print("\nRead repair, N = 3, R = W = 1: second read stale, %")
for r in res["read_repair"]:
    print(f"{r['profile']:9s} gap={r['gap_ms']:5d}  none {ci(r['second_read_stale_none'], 100, 3)}  repair {ci(r['second_read_stale_repair'], 100, 3)}")

print("\nCurves, P(stale) in %")
for r in res["curves"]:
    print(f"{r['profile']:9s} {r['N']}{r['R']}{r['W']} " + " ".join(f"{t}:{s['mean'] * 100:.3g}" for t, s in zip(r["t_ms"], r["p_stale"])))
print("\nseconds", res["seconds"], "python", res["python"], "numpy", res["numpy"])
