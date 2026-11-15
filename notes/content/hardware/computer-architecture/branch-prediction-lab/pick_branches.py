"""Find individual branches in a trace that show one behavior each, and cut
a window of their real outcomes for the figure.

    python3 pick_branches.py TRACE.bin            # list candidates
    python3 pick_branches.py TRACE.bin PC START N # print one window as JSON
    python3 pick_branches.py TRACE.bin --figure BASE NAME=PC ... > figure-windows.json
        # the windows the note's figure replays (PC relative to load base BASE)

For every static branch it reports how often it ran, how often it was taken,
and the misses of three predictors when that branch is replayed through them:
a 1-bit and a 2-bit counter of its own (no sharing with other branches), and
the TAGE from check_predsim.py running over the whole trace. A branch that a
2-bit counter misses but TAGE gets right is following a pattern that history
can see; one that both miss is driven by data.
"""

import json
import sys

from check_predsim import load, tage


def per_branch(trace):
    stats = {}
    one, two = {}, {}
    for pc, back, t in trace:
        s = stats.setdefault(pc, [0, 0, back, 0, 0])  # count, taken, backward, miss1, miss2
        s[0] += 1
        s[1] += t
        p1 = one.get(pc, 0)
        s[3] += p1 != t
        one[pc] = t
        c = two.get(pc, 1)
        s[4] += (c >= 2) != t
        two[pc] = min(c + 1, 3) if t else max(c - 1, 0)
    return stats


def window(trace, pc, start, n):
    """Outcomes number start .. start+n-1 of branch pc, and the 1-bit and
    2-bit state the branch's own counters held just before them."""
    seen = 0
    bit, ctr = 0, 1
    out = []
    first_bit = first_ctr = None
    for p, _, t in trace:
        if p != pc:
            continue
        if seen == start:
            first_bit, first_ctr = bit, ctr
        if start <= seen < start + n:
            out.append(t)
        seen += 1
        bit = t
        ctr = min(ctr + 1, 3) if t else max(ctr - 1, 0)
    return {"outcomes": "".join("T" if t else "N" for t in out), "start_bit": first_bit, "start_ctr": first_ctr, "runs": seen}


def figure(trace, base, picks, start=3000, n=64):
    stats = per_branch(trace)
    tmiss = {}
    tage(trace, tmiss)
    out = {}
    for name, off in picks:
        pc = base + off
        cnt, tk, back, m1, m2 = stats[pc]
        w = window(trace, pc, start, n)
        out[name] = {
            "offset": hex(off),
            "outcomes": w["outcomes"],
            "start": {"1": w["start_bit"], "2": w["start_ctr"]},
            "whole": {"runs": cnt, "miss1": round(m1 / cnt, 3), "miss2": round(m2 / cnt, 3),
                      "missTage": round(tmiss.get(pc, 0) / cnt, 3)},
        }
    return out


def main():
    trace = load(sys.argv[1])
    if len(sys.argv) > 2 and sys.argv[2] == "--figure":
        base = int(sys.argv[3], 0)
        picks = [(a.split("=")[0], int(a.split("=")[1], 0)) for a in sys.argv[4:]]
        print(json.dumps(figure(trace, base, picks), indent=2))
        return
    if len(sys.argv) > 2:
        pc, start, n = int(sys.argv[2], 0), int(sys.argv[3]), int(sys.argv[4])
        print(json.dumps(window(trace, pc, start, n)))
        return
    stats = per_branch(trace)
    tmiss = {}
    tage(trace, tmiss)
    rows = []
    for pc, (cnt, tk, back, m1, m2) in stats.items():
        if cnt < 2000:
            continue
        rows.append((pc, cnt, tk / cnt, back, m1 / cnt, m2 / cnt, tmiss.get(pc, 0) / cnt))
    rows.sort(key=lambda r: -r[1])
    print("pc count taken back miss1bit miss2bit misstage")
    for r in rows[:80]:
        print(f"{r[0]:#x} {r[1]} {r[2]:.3f} {r[3]} {r[4]:.3f} {r[5]:.3f} {r[6]:.3f}")


if __name__ == "__main__":
    main()
