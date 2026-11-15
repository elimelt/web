"""Classifies recorded etcd histories and summarizes them per configuration.

    python3 classify.py data/*.jsonl.gz > results.txt
    python3 classify.py --porcupine recorder/recorder data/*.jsonl.gz > results.txt

For each history: linearizable, sequentially consistent, causal (see
checkers.py). Per configuration (read mode, client placement and
inter-member delay), it reports the mean and range over the five clusters of
the number of histories (out of 100) in each class, and the share of stale
reads: reads whose etcd revision is lower than that of a write which had
already returned when the read was invoked.

For the first history of each class that fails a model, it prints a minimal
witness: a sub-history that still fails the model, found by deleting
operations one at a time (a write together with the reads of its value) for
as long as the rest still fails. Such a sub-history is closed under
writes-into, and restricting a linearization (or sequential order) of the
whole history to it gives one for the sub-history, so its failure proves the
whole history's. The same holds for each process's view under causal
memory.
"""

import gzip
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict

import checkers


def load(paths):
    hs = []
    for path in paths:
        with (gzip.open(path, "rt") if path.endswith(".gz") else open(path)) as f:
            for line in f:
                h = json.loads(line)
                for op in h["ops"]:
                    if op["ret"] < 0:
                        op["ret"] = None
                hs.append(h)
    return hs


def stale(ops):
    """Reads served at a revision older than a write that had returned before
    the read was invoked."""
    writes = [o for o in ops if o["kind"] == "w" and o["ret"] is not None]
    return [r for r in ops if r["kind"] == "r" and any(w["ret"] < r["call"] and w["rev"] > r["rev"] for w in writes)]


def _without(ops, i):
    op = ops[i]
    drop = {i}
    if op["kind"] == "w":
        drop |= {j for j, o in enumerate(ops) if o["kind"] == "r" and o["v"] == op["v"]}
    return [o for j, o in enumerate(ops) if j not in drop]


def minimize(ops, fails):
    changed = True
    while changed:
        changed = False
        for i in range(len(ops)):
            rest = _without(ops, i)
            if fails(rest):
                ops, changed = rest, True
                break
    return sorted(ops, key=lambda o: o["call"])


def main():
    args = sys.argv[1:]
    porc = None
    if args and args[0] == "--porcupine":
        porc, args = args[1], args[2:]
    hs = load(args)
    unknown = sum(op["ret"] is None for h in hs for op in h["ops"])
    groups = defaultdict(lambda: defaultdict(list))
    examples = {}
    stale_reads = defaultdict(lambda: [0, 0])
    shapes = defaultdict(lambda: defaultdict(int))
    pc_mismatch = 0
    if porc:
        verdict = {}
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            for h in hs:
                ops = [dict(o, ret=-1 if o["ret"] is None else o["ret"]) for o in h["ops"]]
                f.write(json.dumps(dict(h, ops=ops)) + "\n")
        out = subprocess.run([porc, "check", "-in", f.name], capture_output=True, text=True, check=True).stdout
        os.unlink(f.name)
        for line in out.strip().split("\n"):
            run, idx, ok = line.split("\t")
            verdict[(run, int(idx))] = ok == "true"
    for h in hs:
        m = re.match(r"(\w+)-(\w+)-d(\d+)-s(\d+)", h["run"])
        cfg = (m.group(1), m.group(2), int(m.group(3)))
        c = checkers.classify(h["ops"], h["init"])
        if porc and verdict[(h["run"], h["index"])] != c["linearizable"]:
            pc_mismatch += 1
        if c["linearizable"]:
            cls = "linearizable"
        elif c["sequential"]:
            cls = "sequential, not linearizable"
        elif c["causal"]:
            cls = "causal, not sequential"
        else:
            cls = "not causal"
        groups[cfg][h["run"]].append(cls)
        if cls != "linearizable":
            core = minimize(h["ops"], lambda o: not checkers.linearizable(o, h["init"])[0])
            shapes[cfg[:2]]["".join(o["kind"] for o in core)] += 1
        reads = [o for o in h["ops"] if o["kind"] == "r"]
        stale_reads[cfg][0] += len(stale(h["ops"]))
        stale_reads[cfg][1] += len(reads)
        if cls != "linearizable" and (cfg[:2], cls) not in examples:
            model = {"sequential, not linearizable": checkers.linearizable, "causal, not sequential": checkers.sequential, "not causal": checkers.causal}[cls]
            examples[(cfg[:2], cls)] = (h["run"], h["index"], minimize(h["ops"], lambda o: not model(o, h["init"])[0]))

    classes = ["linearizable", "sequential, not linearizable", "causal, not sequential", "not causal"]
    print(f"{len(hs)} histories, {sum(len(h['ops']) for h in hs)} operations, {unknown} with unknown outcome")
    if porc:
        print(f"Porcupine disagrees with checkers.linearizable on {pc_mismatch} histories")
    print()
    for cfg in sorted(groups):
        runs = groups[cfg]
        print(f"reads={cfg[0]} clients={cfg[1]} delay={cfg[2]}ms runs={len(runs)} histories/run={[len(v) for v in runs.values()]}")
        for cls in classes:
            per = [v.count(cls) for v in runs.values()]
            print(f"  {cls:30s} mean {sum(per) / len(per):6.1f}  min {min(per):3d}  max {max(per):3d}  per run {per}")
        s, t = stale_reads[cfg]
        print(f"  stale reads: {s}/{t} = {100 * s / t:.2f}%")
    print()
    print("operation kinds of the minimal non-linearizable sub-history, in invocation order, summed over delays")
    for key in sorted(shapes):
        print(f"  reads={key[0]} clients={key[1]}: " + ", ".join(f"{k} {n}" for k, n in sorted(shapes[key].items(), key=lambda x: -x[1])))
    print()
    for (_, cls), (run, idx, ops) in sorted(examples.items()):
        print(f"minimal witness, {cls}: {run} history {idx}")
        for o in ops:
            print(f"    P{o['p'] + 1} {o['kind']}({o['v']})  [{o['call'] / 1e6:8.3f}, {o['ret'] / 1e6:8.3f}] ms  rev {o['rev']}  member m{o['m'] + 1}")


if __name__ == "__main__":
    main()
