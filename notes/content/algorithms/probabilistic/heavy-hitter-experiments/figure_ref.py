"""Independent implementation of the heavy-hitter figure's summaries.

Reads stream.u16.gz (the records of the pageview benchmark whose key hash
falls in the lowest 1/4096 of the hash range, in file order: T uint16 key
numbers, then T uint16 view counts) and writes figure-check.json, which the
figure's tests compare against the TypeScript model, and initial.json, the
default view that the page renders before its script loads.

Every rule a tie could make ambiguous follows the figure: the smallest counter
with the lowest slot index is replaced, new keys take the next free slot, and
Misra-Gries keeps surviving counters in slot order when it compacts.
"""
import gzip
import json
import math
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
M32 = 0xFFFFFFFF
TOP = 20
BUDGETS = [16, 32, 64, 128, 256, 512]
ROWS = {"mg": 0, "ss": 0, "cs": 5, "cms": 4}


def fmix32(h):
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & M32
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & M32
    h ^= h >> 16
    return h


def seq(seed):
    x = seed & M32
    while True:
        x = (x + 0x9E3779B9) & M32
        yield fmix32(x)


def permutation(T, seed):
    p = list(range(T))
    g = seq((seed ^ 0x5BD1E995) & M32)
    for i in range(T - 1, 0, -1):
        j = (next(g) * (i + 1)) >> 32
        p[i], p[j] = p[j], p[i]
    return p


def load():
    raw = gzip.decompress(open(os.path.join(HERE, "stream.u16.gz"), "rb").read())
    T = len(raw) // 4
    keys = struct.unpack("<%dH" % T, raw[: 2 * T])
    counts = struct.unpack("<%dH" % T, raw[2 * T :])
    return keys, counts


def capacity(alg, budget):
    return budget if alg in ("mg", "ss") else budget // 4


def width(alg, budget):
    return (3 * budget) // ROWS[alg] if ROWS[alg] else 0


def counter_summary(alg, budget, records):
    """Misra-Gries (weighted, Berinde et al. 2010) or Space-Saving over records."""
    cap = budget
    slots = []  # [key, count, err]
    where = {}
    for key, c in records:
        if key in where:
            slots[where[key]][1] += c
        elif len(slots) < cap:
            where[key] = len(slots)
            slots.append([key, c, 0])
        elif alg == "ss":
            q = min(range(len(slots)), key=lambda i: (slots[i][1], i))
            mn = slots[q][1]
            del where[slots[q][0]]
            slots[q] = [key, mn + c, mn]
            where[key] = q
        else:
            mn = min(s[1] for s in slots)
            d = min(c, mn)
            slots = [[k, v - d, 0] for k, v, _ in slots if v - d > 0]
            where = {s[0]: i for i, s in enumerate(slots)}
            if c > d:
                where[key] = len(slots)
                slots.append([key, c - d, 0])
    return slots


def sketch_summary(alg, budget, records, seed):
    rows, w, cap = ROWS[alg], width(alg, budget), capacity(alg, budget)
    g = seq(seed)
    seeds = [next(g) for _ in range(rows)]
    cells = [[0] * w for _ in range(rows)]

    def query(key):
        v = []
        for j in range(rows):
            h = fmix32(((key + 1) ^ seeds[j]) & M32)
            cell = cells[j][(h * w) >> 32]
            v.append((cell if h & 1 else -cell) if alg == "cs" else cell)
        if alg == "cms":
            return min(v)
        v.sort()
        return v[len(v) // 2]

    slots = []
    where = {}
    for key, c in records:
        for j in range(rows):
            h = fmix32(((key + 1) ^ seeds[j]) & M32)
            cells[j][(h * w) >> 32] += (c if h & 1 else -c) if alg == "cs" else c
        e = query(key)
        if key in where:
            slots[where[key]][1] = e
        elif len(slots) < cap:
            where[key] = len(slots)
            slots.append([key, e, 0])
        else:
            q = min(range(len(slots)), key=lambda i: (slots[i][1], i))
            if e > slots[q][1]:
                del where[slots[q][0]]
                slots[q] = [key, e, 0]
                where[key] = q
    return slots, query, w


def outcome(alg, budget, records):
    n = sum(c for _, c in records)
    truth = {}
    for k, c in records:
        truth[k] = truth.get(k, 0) + c
    top = sorted(truth, key=lambda k: (-truth[k], k))[:TOP]
    if alg in ("mg", "ss"):
        slots = counter_summary(alg, budget, records)
        val = {s[0]: s for s in slots}
        full = len(slots) == budget
        mn = min(s[1] for s in slots) if full else 0
        counted = sum(s[1] for s in slots)
        rows = []
        for k in top:
            if alg == "mg":
                c = val[k][1] if k in val else 0
                rows.append((c, c, c + (n - counted) / (budget + 1)))
            elif k in val:
                rows.append((val[k][1], val[k][1] - val[k][2], val[k][1]))
            else:
                rows.append((0, 0, mn))
        bound = (n - counted) / (budget + 1) if alg == "mg" else mn
    else:
        slots, query, w = sketch_summary(alg, budget, records, 1)
        norm2 = math.sqrt(sum(v * v for v in truth.values()))
        rows = []
        for k in top:
            c = query(k)
            if alg == "cms":
                rows.append((c, max(0, c - math.e * n / w), c))
            else:
                r = math.sqrt(3 / w) * norm2
                rows.append((c, max(0, c - r), c + r))
        bound = math.e * n / w if alg == "cms" else math.sqrt(3 / w) * norm2
    rep = [s[0] for s in sorted(slots, key=lambda s: (-s[1], s[0]))[:TOP]]
    hits = len(set(rep) & set(top))
    max_err = max(abs(r[0] - truth[k]) for r, k in zip(rows, top))
    return {
        "slots": sorted([s[0], s[1], s[2]] for s in slots),
        "top": top,
        "truth": [truth[k] for k in top],
        "est": [r[0] for r in rows],
        "lo": [r[1] for r in rows],
        "hi": [r[2] for r in rows],
        "reported": rep,
        "hits": hits,
        "maxErr": max_err,
        "bound": bound,
        "n": n,
    }


def main():
    keys, counts = load()
    T = len(keys)
    file_order = list(range(T))
    shuffled = permutation(T, 1)
    cases = []
    plan = []
    for alg in ("mg", "ss", "cs", "cms"):
        for b in BUDGETS:
            plan.append((alg, b, "file", T))
            plan.append((alg, b, "shuffled", T))
        for upto in (1, 2, 100, 5000, 20000):
            plan.append((alg, 64, "file", upto))
    for alg, b, order, upto in plan:
        perm = file_order if order == "file" else shuffled
        records = [(keys[r], counts[r]) for r in perm[:upto]]
        o = outcome(alg, b, records)
        o.update({"alg": alg, "budget": b, "order": order, "upto": upto})
        cases.append(o)
    # Misra-Gries with k counters equals Space-Saving with k+1 counters minus
    # its smallest counter (Agarwal et al. 2013, Lemma 2.3), for weighted
    # updates as well.
    equiv = []
    for k in (15, 63, 255):
        for perm in (file_order, shuffled):
            records = [(keys[r], counts[r]) for r in perm]
            mg = {s[0]: s[1] for s in counter_summary("mg", k, records)}
            ss = counter_summary("ss", k + 1, records)
            mn = min(s[1] for s in ss)
            ss_minus = {s[0]: s[1] - mn for s in ss if s[1] - mn > 0}
            equiv.append({"k": k, "equal": mg == ss_minus, "min": mn})
    out = {
        "T": T,
        "views": sum(counts),
        "perm1_head": shuffled[:10],
        "seq7": [x for x, _ in zip(seq(7), range(5))],
        "mix": [{"x": x, "fmix32": fmix32(x)} for x in (0, 1, 2, 12345, 0xDEADBEEF, M32)],
        "cases": cases,
        "equivalence": equiv,
    }
    json.dump(out, open(os.path.join(HERE, "figure-check.json"), "w"), separators=(",", ":"))
    init = next(c for c in cases if c["alg"] == "ss" and c["budget"] == 64 and c["order"] == "file" and c["upto"] == T)
    keep = {k: init[k] for k in ("top", "truth", "est", "lo", "hi", "reported", "hits", "maxErr", "bound", "n")}
    json.dump(keep, open(os.path.join(HERE, "initial.json"), "w"), separators=(",", ":"))
    for e in equiv:
        print("equivalence", e)
    print("cases", len(cases))


if __name__ == "__main__":
    main()
