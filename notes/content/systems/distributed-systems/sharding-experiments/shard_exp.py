"""Measures how evenly consistent hashing and an indirection table spread
the keys and requests of a real cache trace, and how many keys move when a
server joins.

Run from this directory:

    sh fetch_trace.sh
    python3 shard_exp.py > results.json

Keys are hashed with MD5, as Dynamo and libmemcached's ketama do: the first 8
bytes of the digest, read big-endian, give a key's position on a 2^64 ring.
A server's ring points are MD5 hashes of "s<seed>-<server>#<point>", so each
seed is an independent random placement of the same servers.
"""

import hashlib
import json
import math
import os
import platform
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TRACE = os.path.join(HERE, "../../../../work/notebook-data/sharding/twitter_cluster52.csv")
SEEDS = 20


def md5_64(text: str) -> int:
    return int.from_bytes(hashlib.md5(text.encode()).digest()[:8], "big")


def load_trace():
    """Returns key strings, per-key request counts in each half, and positions."""
    ids, first, second = {}, [], []
    with open(TRACE) as f:
        next(f)
        rows = [line.split(",", 2)[1].strip() for line in f]
    half = len(rows) // 2
    for i, key in enumerate(rows):
        k = ids.get(key)
        if k is None:
            k = ids[key] = len(ids)
            first.append(0)
            second.append(0)
        (first if i < half else second)[k] += 1
    keys = list(ids)
    pos = np.array([md5_64(k) for k in keys], dtype=np.uint64)
    return keys, np.array(first, dtype=np.int64), np.array(second, dtype=np.int64), pos, len(rows)


def ring(servers: int, points: int, seed: int):
    """Sorted ring points and the server that owns each point."""
    toks = np.array([md5_64(f"s{seed}-{s}#{p}") for s in range(servers) for p in range(points)], dtype=np.uint64)
    owner = np.repeat(np.arange(servers), points)
    order = np.argsort(toks, kind="stable")
    return toks[order], owner[order]


def lookup(toks, owner, pos):
    """A key belongs to the first ring point at or after it, wrapping around."""
    i = np.searchsorted(toks, pos, side="left")
    i[i == len(toks)] = 0
    return owner[i]


def arc_shares(toks, owner, servers: int):
    """Exact fraction of the ring each server owns (the load with infinitely many keys)."""
    t = toks.astype(np.float64) / 2.0**64
    gaps = np.diff(np.concatenate([[t[-1] - 1.0], t]))
    return np.bincount(owner, weights=gaps, minlength=servers)


def peak(loads):
    return float(np.max(loads) / np.mean(loads))


def stats(values):
    v = np.array(values, dtype=np.float64)
    return {"mean": float(v.mean()), "min": float(v.min()), "max": float(v.max()), "sd": float(v.std(ddof=1)) if len(v) > 1 else 0.0}


def jump_hash(key: int, buckets: int) -> int:
    """Lamping and Veach's jump consistent hash, as in their paper's listing."""
    b, j = -1, 0
    while j < buckets:
        b = j
        key = (key * 2862933555777941757 + 1) & 0xFFFFFFFFFFFFFFFF
        j = int((b + 1) * (float(1 << 31) / float((key >> 33) + 1)))
    return b


def ketama_ring(servers: int, seed: int):
    """libmemcached's ketama: 40 MD5 digests per server, 4 points of 4 bytes each (little-endian)."""
    toks, owner = [], []
    for s in range(servers):
        for i in range(40):
            d = hashlib.md5(f"10.0.{seed}.{s}:11211-{i}".encode()).digest()
            for h in range(4):
                toks.append(int.from_bytes(d[4 * h : 4 * h + 4], "little"))
                owner.append(s)
    toks, owner = np.array(toks, dtype=np.uint64), np.array(owner)
    order = np.argsort(toks, kind="stable")
    return toks[order], owner[order]


def ketama_keypos(keys):
    return np.array([int.from_bytes(hashlib.md5(k.encode()).digest()[:4], "little") for k in keys], dtype=np.uint64)


def table_slot(pos, entries: int):
    """An indirection table indexes its entries by hash; the top bits of the position pick an entry."""
    return ((pos.astype(np.float64) / 2.0**64) * entries).astype(np.int64)


def round_robin(entries: int, servers: int):
    return np.arange(entries) % servers


def lpt(weights, servers: int):
    """Longest processing time first: each entry, heaviest first, goes to the lightest server."""
    owner = np.empty(len(weights), dtype=np.int64)
    load = np.zeros(servers)
    for e in np.argsort(-weights, kind="stable"):
        s = int(np.argmin(load))
        owner[e] = s
        load[s] += weights[e]
    return owner


def targeted_rebalance(owner, weights, servers: int, target: float, limit: int = 100000):
    """Moves one entry at a time off the busiest server to the idlest, choosing the
    entry that best levels the pair, until the peak is at or below target."""
    owner = owner.copy()
    moved = set()
    for _ in range(limit):
        load = np.bincount(owner, weights=weights, minlength=servers)
        hi, lo = int(np.argmax(load)), int(np.argmin(load))
        if load[hi] / load.mean() <= target:
            break
        gap = load[hi] - load[lo]
        cand = np.flatnonzero(owner == hi)
        w = weights[cand]
        ok = cand[(w > 0) & (w < gap)]
        if len(ok) == 0:
            break
        best = ok[np.argmin(np.abs(weights[ok] - gap / 2))]
        owner[best] = lo
        moved.add(int(best))
    return owner, moved


def main():
    t0 = time.time()
    keys, req1, req2, pos, nreq = load_trace()
    nkeys = len(keys)
    req = req1 + req2
    out = {
        "trace": {"requests": nreq, "keys": nkeys, "hottest_share": float(req.max() / req.sum()),
                  "top1pct_share": float(np.sort(req)[::-1][: nkeys // 100].sum() / req.sum()),
                  "hottest_share_second_half": float(req2.max() / req2.sum())},
        "env": {"python": sys.version.split()[0], "numpy": np.__version__, "machine": platform.machine(),
                "cpu": platform.processor() or platform.machine(), "seeds": SEEDS},
    }

    # E1: how even is the key count per server as ring points per server grow?
    e1 = []
    for servers in (8, 32, 128):
        for points in (1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024):
            arc, cnt = [], []
            for seed in range(SEEDS):
                toks, owner = ring(servers, points, seed)
                arc.append(peak(arc_shares(toks, owner, servers)))
                cnt.append(peak(np.bincount(lookup(toks, owner, pos), minlength=servers)))
            e1.append({"servers": servers, "points": points, "arc_peak": stats(arc), "key_peak": stats(cnt)})
        harmonic = sum(1 / i for i in range(1, servers + 1))
        e1.append({"servers": servers, "points": 1, "theory_arc_peak_mean": harmonic})
    out["e1"] = e1

    # Ketama (160 points per server) and fixed tables, for comparison at 32 servers.
    kp = ketama_keypos(keys)
    ket = []
    for seed in range(SEEDS):
        toks, owner = ketama_ring(32, seed)
        ket.append(peak(np.bincount(lookup(toks, owner, kp), minlength=32)))
    out["ketama_32"] = stats(ket)
    tables = []
    for entries in (32, 128, 512, 2048, 16384):
        slot = table_slot(pos, entries)
        own = round_robin(entries, 32)
        tables.append({"entries": entries, "key_peak": peak(np.bincount(own[slot], minlength=32))})
    out["table_32_round_robin"] = tables

    # Sampling noise alone: a perfectly even split of the hash space still has
    # random key counts. 32 equal ranges of the ring:
    out["equal_ranges_32_key_peak"] = peak(np.bincount(table_slot(pos, 32), minlength=32))

    # E2: a 33rd server joins 32. Which keys move, from how many servers?
    e2 = {"ideal_fraction": 1 / 33}
    n = 32
    ringrows = []
    for points in (1, 16, 256):
        frac, donors, newload, peak_after = [], [], [], []
        for seed in range(SEEDS):
            toks, owner = ring(n + 1, points, seed)
            keep = owner < n
            before = lookup(toks[keep], owner[keep], pos)
            after = lookup(toks, owner, pos)
            moved = before != after
            assert np.all(after[moved] == n), "a key moved somewhere other than the new server"
            frac.append(moved.mean())
            donors.append(len(np.unique(before[moved])))
            counts = np.bincount(after, minlength=n + 1)
            newload.append(counts[n] / counts.mean())
            peak_after.append(peak(counts))
        ringrows.append({"points": points, "moved": stats(frac), "donors": stats(donors),
                         "new_server_load": stats(newload), "peak_after": stats(peak_after)})
    e2["ring"] = ringrows
    e2["mod_n_moved"] = float(np.mean((pos % np.uint64(n)) != (pos % np.uint64(n + 1))))
    jk = [int(p) for p in pos]
    e2["jump_moved"] = float(np.mean([jump_hash(k, n) != jump_hash(k, n + 1) for k in jk]))
    trows = []
    for entries in (128, 2048, 16384):
        slot = table_slot(pos, entries)
        own = round_robin(entries, n)
        new = own.copy()
        take = entries // (n + 1)
        per = np.bincount(own, minlength=n)
        # Take one entry at a time from whichever server holds the most entries.
        for _ in range(take):
            s = int(np.argmax(per))
            e = np.flatnonzero(new == s)[-1]
            new[e] = n
            per[s] -= 1
        moved = new[slot] != own[slot]
        counts = np.bincount(new[slot], minlength=n + 1)
        trows.append({"entries": entries, "entries_moved": take, "moved": float(moved.mean()),
                      "donors": int(len(np.unique(own[np.flatnonzero(new != own)]))),
                      "new_server_load": float(counts[n] / counts.mean()), "peak_after": peak(counts)})
    e2["table"] = trows
    out["e2"] = e2

    # E3: request load. Plan on the first half of the trace, serve the second.
    e3 = {"servers": n, "floor_second_half": float(req2.max() / (req2.sum() / n))}
    rrows = []
    for points in (1, 16, 256):
        vals = []
        for seed in range(SEEDS):
            toks, owner = ring(n, points, seed)
            vals.append(peak(np.bincount(lookup(toks, owner, pos), weights=req2, minlength=n)))
        rrows.append({"points": points, "req_peak": stats(vals)})
    e3["ring"] = rrows
    trows = []
    for entries in (128, 2048, 16384):
        slot = table_slot(pos, entries)
        w1 = np.bincount(slot, weights=req1, minlength=entries)
        w2 = np.bincount(slot, weights=req2, minlength=entries)
        kc = np.bincount(slot, minlength=entries)
        rr = round_robin(entries, n)
        planned = lpt(w1, n)
        reb, moved = targeted_rebalance(rr, w1, n, target=1.10)
        mv = np.array(sorted(moved), dtype=np.int64)
        trows.append({
            "entries": entries,
            "round_robin_req_peak": peak(np.bincount(rr, weights=w2, minlength=n)),
            "lpt_req_peak_train": peak(np.bincount(planned, weights=w1, minlength=n)),
            "lpt_req_peak_test": peak(np.bincount(planned, weights=w2, minlength=n)),
            "lpt_entries_changed_vs_round_robin": int(np.sum(planned != rr)),
            "targeted_entries_moved": len(moved),
            "targeted_keys_moved_frac": float(kc[mv].sum() / nkeys) if len(mv) else 0.0,
            "targeted_req_peak_train": peak(np.bincount(reb, weights=w1, minlength=n)),
            "targeted_req_peak_test": peak(np.bincount(reb, weights=w2, minlength=n)),
            "targeted_key_peak": peak(np.bincount(reb, weights=kc, minlength=n)),
        })
    e3["table"] = trows
    out["e3"] = e3
    out["seconds"] = round(time.time() - t0, 1)
    json.dump(out, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
