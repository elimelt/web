"""Writes figure-data.json for the hash ring figure and figure-check.json for
its tests. The figure hashes with 32-bit MurmurHash3 (seed 0 unless a
scenario reseeds), as Cassandra's partitioner does with the 128-bit variant.

    pip install mmh3
    python3 figure_data.py
"""

import collections
import json
import os

import mmh3

HERE = os.path.dirname(os.path.abspath(__file__))
TRACE = os.path.join(HERE, "../../../../work/notebook-data/sharding/twitter_cluster52.csv")
SAMPLE = 60   # keys drawn on the ring
TOP = 24      # hottest keys drawn in the hot-key scenario
ENTRIES = 20  # table entries in the table scenarios
SERVERS = 5


def h(text, seed=0):
    return mmh3.hash(text, seed, signed=False)


def entry(pos):
    return pos * ENTRIES >> 32


def main():
    counts = collections.Counter()
    order = []
    with open(TRACE) as f:
        next(f)
        for line in f:
            k = line.split(",", 2)[1].strip()
            if k not in counts:
                order.append(k)
            counts[k] += 1
    total = sum(counts.values())
    sample = order[:: len(order) // SAMPLE][:SAMPLE]
    top = counts.most_common(TOP)
    weights = [0] * ENTRIES
    nkeys = [0] * ENTRIES
    for k, c in counts.items():
        e = entry(h(k))
        weights[e] += c
        nkeys[e] += 1
    data = {
        "source": "Twitter cache trace, cluster 52, first 1M requests (libCacheSim sample)",
        "requests": total,
        "keys": len(counts),
        "sample": sample,
        "top": [[k, c] for k, c in top],
        "entries": ENTRIES,
        "entryRequests": weights,
        "entryKeys": nkeys,
    }
    with open(os.path.join(HERE, "figure-data.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))

    # Reference values for the tests, from Python's mmh3 and a separate
    # implementation of the rebalancing loop.
    names = [f"{s}#{i}" for s in "ABCDEF" for i in range(16)]
    owners = [e % SERVERS for e in range(ENTRIES)]
    moves = []
    while True:
        load = [0] * SERVERS
        for e, o in enumerate(owners):
            load[o] += weights[e]
        hi = max(range(SERVERS), key=lambda s: (load[s], -s))
        lo = min(range(SERVERS), key=lambda s: (load[s], s))
        gap = load[hi] - load[lo]
        cand = [e for e in range(ENTRIES) if owners[e] == hi and 0 < weights[e] < gap]
        if not cand:
            break
        best = min(cand, key=lambda e: (abs(weights[e] - gap / 2), e))
        owners[best] = lo
        moves.append([best, hi, lo])
    check = {
        "murmur": {k: [h(k), h(k, 7)] for k in sample[:20] + names[:20]},
        "rebalanceMoves": moves,
        "rebalanceOwners": owners,
    }
    with open(os.path.join(HERE, "figure-check.json"), "w") as f:
        json.dump(check, f, indent=1)
    load = [0] * SERVERS
    for e, o in enumerate(owners):
        load[o] += weights[e]
    rr = [0] * SERVERS
    for e in range(ENTRIES):
        rr[e % SERVERS] += weights[e]
    mean = total / SERVERS
    print("round robin peak", max(rr) / mean, "after", len(moves), "moves", max(load) / mean)
    print("hottest key alone", top[0][1] / mean, "hottest entry", max(weights) / mean)
    print("entry weights / mean", [round(w / mean, 2) for w in weights])


if __name__ == "__main__":
    main()
