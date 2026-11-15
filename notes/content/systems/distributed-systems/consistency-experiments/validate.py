"""Validates checkers.py and writes the figure's test fixtures.

    python3 validate.py            # brute force vs checkers, and fixtures.json
    python3 validate.py --porcupine recorder/recorder   # also Porcupine

1. On 4000 random histories of at most eight operations, every checker must
   agree with the brute-force enumeration in bruteforce.py.
2. With --porcupine, linearizable() must agree with Porcupine on the same
   histories and on the larger ones (421 of 600 generated have 12 to 24
   operations and are kept).
3. fixtures.json holds 600 small and 300 larger histories with the verdicts
   of checkers.py; the figure's test (consistency-lab.test.mjs) runs its
   TypeScript checkers on them and must agree.
"""

import json
import os
import random
import subprocess
import sys
import tempfile

import bruteforce
import checkers

HERE = os.path.dirname(os.path.abspath(__file__))


def random_history(rng, procs, per_proc):
    """Operations on an integer time grid. Each read returns the value the
    register would hold at a random point in its interval, given random
    points for the writes, or with some probability any other value; so a
    useful share of histories is linearizable and a useful share is not."""
    ops = []
    for p in range(procs):
        t = rng.randint(0, 4)
        for k in range(rng.randint(1, per_proc)):
            dur = rng.randint(1, 6)
            kind = "w" if rng.random() < 0.5 else "r"
            ops.append({"p": p, "kind": kind, "v": None, "call": t, "ret": t + dur})
            t += dur + rng.randint(1, 4)  # a process waits for its previous operation
    vals = iter(range(1, 100))
    for op in ops:
        if op["kind"] == "w":
            op["v"] = next(vals)
    points = [rng.uniform(op["call"], op["ret"]) for op in ops]
    written = [op["v"] for op in ops if op["kind"] == "w"]
    for i, op in enumerate(ops):
        if op["kind"] != "r":
            continue
        if rng.random() < 0.65:
            latest, value = -1.0, 0
            for j, w in enumerate(ops):
                if w["kind"] == "w" and latest < points[j] < points[i]:
                    latest, value = points[j], w["v"]
            op["v"] = value
        else:
            op["v"] = rng.choice([0] + written)
    rng.shuffle(ops)
    return ops


def porcupine(binary, histories):
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        for k, ops in enumerate(histories):
            f.write(json.dumps({"run": "v", "index": k, "init": 0, "ops": [dict(o, rev=0) for o in ops]}) + "\n")
        name = f.name
    out = subprocess.run([binary, "check", "-in", name], capture_output=True, text=True, check=True).stdout
    os.unlink(name)
    return [line.split("\t")[2] == "true" for line in out.strip().split("\n")]


def main():
    rng = random.Random(20261115)
    small = []
    while len(small) < 4000:
        h = random_history(rng, rng.choice([2, 3]), 3)
        if len(h) <= 8:
            small.append(h)
    large = [random_history(rng, 3, 8) for _ in range(600)]
    large = [h for h in large if len(h) >= 12]

    counts = {"linearizable": 0, "sequential": 0, "causal": 0}
    for h in small:
        got = checkers.classify(h)
        want = {
            "linearizable": bruteforce.linearizable(h),
            "sequential": bruteforce.sequential(h),
            "causal": bruteforce.causal(h),
        }
        assert got == want, (h, got, want)
        for k in counts:
            counts[k] += want[k]
        # Containment: linearizable => sequential => causal.
        assert not got["linearizable"] or got["sequential"]
        assert not got["sequential"] or got["causal"]
    print(f"brute force agrees on {len(small)} histories; admitted: {counts}")

    big = [checkers.classify(h) for h in large]
    print(
        f"{len(large)} larger histories ({min(map(len, large))}-{max(map(len, large))} ops); admitted: "
        + str({k: sum(b[k] for b in big) for k in counts})
    )

    if "--porcupine" in sys.argv:
        binary = sys.argv[sys.argv.index("--porcupine") + 1]
        pc = porcupine(binary, small + large)
        ours = [checkers.linearizable(h)[0] for h in small + large]
        mismatches = sum(a != b for a, b in zip(pc, ours))
        assert mismatches == 0, mismatches
        print(f"Porcupine agrees on {len(pc)} histories ({sum(pc)} linearizable)")

    fixtures = [{"ops": h, **checkers.classify(h)} for h in small[:600] + large[:300]]
    with open(os.path.join(HERE, "fixtures.json"), "w") as f:
        json.dump(fixtures, f, separators=(",", ":"))
    print(f"wrote fixtures.json with {len(fixtures)} histories")


if __name__ == "__main__":
    main()
