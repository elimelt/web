"""Event-driven simulator for GPipe, 1F1B and interleaved 1F1B pipeline schedules.

Each of p devices runs its operations in a fixed order (the schedule). An
operation starts when its device is free and its dependency has finished:
the forward of a microbatch on model stage s needs that microbatch's forward
on stage s-1, and its backward needs the backward on stage s+1 (the last
stage's backward needs its own forward). Communication takes no time, as in
the papers' closed forms. A forward on one model chunk takes 1 time unit and
a backward 2; with v chunks per device, a device's share of one microbatch's
work is 3v units.

The script checks the simulated bubble fraction and the peak number of
in-flight microbatches per device against the closed forms over a grid of
(p, m, v), and writes the fixtures the figure's test compares with:

  python3 content/ml/serving-systems/parallelism/pipeline_sim.py

Closed forms (Huang et al. 2019; Narayanan et al. 2021, Section 2.2;
Korthikanti et al. 2022, Section 4.2.3):
  bubble time / ideal time = (p - 1) / m          GPipe and 1F1B
                           = (p - 1) / (m v)      interleaved, m a multiple of p
  peak in-flight microbatches on device i (0-based), in units of one
  microbatch's activations for a whole device:
      GPipe        m
      1F1B         min(p - i, m)
      interleaved  (2 (p - i - 1) + (v - 1) p + 1) / v, or m when m = p
                   (Megatron-LM then runs every forward before any backward)
"""

import heapq
import json
import pathlib

TF, TB = 1, 2


def orders(kind, p, m, v):
    """Per-device list of (phase, microbatch, chunk), phase 'F' or 'B'."""
    out = []
    for i in range(p):
        if kind == "gpipe":
            seq = [("F", k, 0) for k in range(m)] + [("B", k, 0) for k in range(m)]
        elif kind == "1f1b":
            w = min(p - i - 1, m)
            seq = [("F", k, 0) for k in range(w)]
            for k in range(m - w):
                seq += [("F", w + k, 0), ("B", k, 0)]
            seq += [("B", k, 0) for k in range(m - w, m)]
        elif kind == "interleaved":
            assert m % p == 0, "interleaving needs m to be a multiple of p"
            total = m * v

            def fwd(k):
                return ("F", (k // (p * v)) * p + k % p, (k // p) % v)

            def bwd(k):
                return ("B", (k // (p * v)) * p + k % p, v - 1 - (k // p) % v)

            w = total if m == p else min(2 * (p - i - 1) + (v - 1) * p, total)
            seq = [fwd(k) for k in range(w)]
            for k in range(total - w):
                seq += [fwd(w + k), bwd(k)]
            seq += [bwd(k) for k in range(total - w, total)]
        else:
            raise ValueError(kind)
        out.append(seq)
    return out


def simulate(kind, p, m, v=1):
    if kind != "interleaved":
        v = 1
    seqs = orders(kind, p, m, v)
    S = p * v  # model stages; chunk c on device i is model stage c*p + i
    done = {}  # (phase, mb, stage) -> finish time
    nxt = [0] * p
    free = [0] * p
    busy = [False] * p
    events = []  # (time, device)
    ops = []  # (device, phase, mb, chunk, start, end)

    def stage_of(i, c):
        return c * p + i

    def dep(i, op):
        ph, mb, c = op
        s = stage_of(i, c)
        if ph == "F":
            return None if s == 0 else ("F", mb, s - 1)
        return ("F", mb, s) if s == S - 1 else ("B", mb, s + 1)

    def try_start(i, now):
        if busy[i] or nxt[i] >= len(seqs[i]):
            return
        op = seqs[i][nxt[i]]
        d = dep(i, op)
        if d is not None and d not in done:
            return
        start = max(now, free[i], done.get(d, 0) if d else 0)
        end = start + (TF if op[0] == "F" else TB)
        busy[i] = True
        nxt[i] += 1
        ops.append((i, op[0], op[1], op[2], start, end))
        heapq.heappush(events, (end, i, op))

    for i in range(p):
        try_start(i, 0)
    while events:
        t, i, op = heapq.heappop(events)
        busy[i] = False
        free[i] = t
        done[(op[0], op[1], stage_of(i, op[2]))] = t
        # A finished op can release its own device and its neighbours.
        for j in range(p):
            try_start(j, t)
    assert all(nxt[i] == len(seqs[i]) for i in range(p)), "deadlock"

    makespan = max(e for *_, e in ops)
    ideal = m * v * (TF + TB)
    # In-flight: a microbatch's activations on (device, chunk) are held from
    # the start of its forward to the end of its backward.
    peak = []
    for i in range(p):
        ev = []
        for d, ph, mb, c, s, e in ops:
            if d != i:
                continue
            if ph == "F":
                ev.append((s, 1))
            else:
                ev.append((e, -1))
        ev.sort(key=lambda x: (x[0], x[1]))  # release before acquire at equal times
        cur = best = 0
        for _, delta in ev:
            cur += delta
            best = max(best, cur)
        peak.append(best / v)
    return {"makespan": makespan, "ideal": ideal, "bubble": makespan / ideal - 1, "peak": peak, "ops": ops}


def closed_bubble(kind, p, m, v):
    return (p - 1) / (m * (v if kind == "interleaved" else 1))


def closed_peak(kind, p, m, v, i):
    if kind == "gpipe":
        return m
    if kind == "1f1b":
        return min(p - i, m)
    if m == p:  # Megatron runs every forward first when m = p
        return m
    return min(2 * (p - i - 1) + (v - 1) * p + 1, m * v) / v


def main():
    checked = 0
    fixtures = []
    for p in range(1, 9):
        for m in range(1, 33):
            for kind, vs in (("gpipe", [1]), ("1f1b", [1]), ("interleaved", [2, 3, 4])):
                for v in vs:
                    if kind == "interleaved" and m % p:
                        continue
                    r = simulate(kind, p, m, v)
                    assert abs(r["bubble"] - closed_bubble(kind, p, m, v)) < 1e-12, (kind, p, m, v, r["bubble"])
                    for i in range(p):
                        assert abs(r["peak"][i] - closed_peak(kind, p, m, v, i)) < 1e-12, (kind, p, m, v, i, r["peak"])
                    checked += 1
                    if m <= 12 and p <= 6:
                        # Each device's operations in execution order, as
                        # "<phase><microbatch>.<chunk>@<start>".
                        per = [[] for _ in range(p)]
                        for d, ph, mb, c, st, _ in sorted(r["ops"], key=lambda o: (o[0], o[4])):
                            per[d].append(f"{ph}{mb}.{c}@{st}")
                        fixtures.append({"kind": kind, "p": p, "m": m, "v": v, "makespan": r["makespan"], "peak": r["peak"], "ops": [" ".join(x) for x in per]})
    print(f"{checked} (schedule, p, m, v) cases match the closed forms")
    path = pathlib.Path(__file__).resolve().parent / "pipeline-fixtures.json"
    path.write_text(json.dumps(fixtures, separators=(",", ":")))
    print(f"wrote {len(fixtures)} fixtures to {path.name} ({path.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()
