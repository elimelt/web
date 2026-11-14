"""Check predsim.c against a separate Python implementation.

    python3 check_predsim.py TRACE.bin RESULT.json [--tage]

Re-implements each predictor from its description, not by translating the C,
and asserts that the misprediction counts match predsim's output exactly. The
TAGE check computes every folded history directly from the full history
(XOR of fixed-width chunks) instead of predsim's incremental circular shift
register, so it also checks that the two folding methods agree.
"""

import json
import struct
import sys


def load(path):
    raw = open(path, "rb").read()
    recs = struct.unpack(f"<{len(raw) // 8}Q", raw)
    return [(r >> 2, (r >> 1) & 1, r & 1) for r in recs]


def counter(c, taken, top=3):
    return min(c + 1, top) if taken else max(c - 1, 0)


def static(trace, btfnt):
    return sum((back if btfnt else 1) != t for _, back, t in trace)


def onebit(trace, n):
    last = {}
    miss = 0
    for pc, _, t in trace:
        i = pc % n
        miss += last.get(i, 0) != t
        last[i] = t
    return miss


def bimodal(trace, n, misses_at=None):
    ctr = [1] * n
    miss = 0
    for pc, _, t in trace:
        i = pc % n
        miss += (ctr[i] >= 2) != t
        if misses_at is not None and (ctr[i] >= 2) != t:
            misses_at[pc] = misses_at.get(pc, 0) + 1
        ctr[i] = counter(ctr[i], t)
    return miss


def gshare(trace, n, misses_at=None):
    bits = n.bit_length() - 1
    ctr = [1] * n
    hist = []  # outcomes, newest last
    miss = 0
    for pc, _, t in trace:
        g = 0
        for b in hist[-bits:]:
            g = (g << 1) | b
        i = (pc ^ g) % n
        miss += (ctr[i] >= 2) != t
        if misses_at is not None and (ctr[i] >= 2) != t:
            misses_at[pc] = misses_at.get(pc, 0) + 1
        ctr[i] = counter(ctr[i], t)
        hist.append(t)
        if len(hist) > bits:
            hist.pop(0)
    return miss


def tournament(trace, n):
    bits = n.bit_length() - 1
    bi, gs, ch = [1] * n, [1] * n, [1] * n
    g = 0
    miss = 0
    for pc, _, t in trace:
        a, b = pc % n, (pc ^ g) % n
        pb, pg = bi[a] >= 2, gs[b] >= 2
        miss += (pg if ch[a] >= 2 else pb) != t
        if pb != pg:
            ch[a] = counter(ch[a], pg == t)
        bi[a] = counter(bi[a], t)
        gs[b] = counter(gs[b], t)
        g = ((g << 1) | t) & (n - 1)
    return miss


def fold(h, length, width):
    """XOR the newest `length` outcomes, `width` bits at a time."""
    h &= (1 << length) - 1
    out = 0
    while h:
        out ^= h & ((1 << width) - 1)
        h >>= width
    return out


def tage(trace, misses_at=None):
    hlen, tagw, logt, logb = [5, 15, 44, 130], [8, 9, 10, 11], 10, 12
    size = 1 << logt
    tables = [[[0, 0, 0] for _ in range(size)] for _ in hlen]  # [tag, ctr, u]
    base = [1] * (1 << logb)
    h = 0  # bit a is the outcome a branches ago
    use_alt = 8
    miss = 0
    for k, (pc, _, t) in enumerate(trace):
        idx = [(pc ^ (pc >> logt) ^ fold(h, L, logt)) % size for L in hlen]
        tag = [(pc ^ fold(h, L, w) ^ (fold(h, L, w - 1) << 1)) % (1 << w) for L, w in zip(hlen, tagw)]
        hits = [i for i in range(len(hlen)) if tables[i][idx[i]][0] == tag[i]]
        prov = hits[-1] if hits else None
        alt = hits[-2] if len(hits) > 1 else None
        b = pc % (1 << logb)
        basepred = base[b] >= 2
        altpred = tables[alt][idx[alt]][1] >= 4 if alt is not None else basepred
        weak = False
        if prov is not None:
            e = tables[prov][idx[prov]]
            provpred = e[1] >= 4
            weak = e[1] in (3, 4) and e[2] == 0
            pred = altpred if (weak and use_alt >= 8) else provpred
        else:
            provpred = pred = basepred
        miss += pred != t
        if misses_at is not None and pred != t:
            misses_at[pc] = misses_at.get(pc, 0) + 1
        if prov is not None and weak and provpred != altpred:
            use_alt = min(use_alt + 1, 15) if altpred == t else max(use_alt - 1, 0)
        start = -1 if prov is None else prov
        if pred != t and start < len(hlen) - 1:
            free = [j for j in range(start + 1, len(hlen)) if tables[j][idx[j]][2] == 0]
            if free:
                tables[free[0]][idx[free[0]]] = [tag[free[0]], 4 if t else 3, 0]
            else:
                for j in range(start + 1, len(hlen)):
                    tables[j][idx[j]][2] = max(tables[j][idx[j]][2] - 1, 0)
        if prov is not None:
            e = tables[prov][idx[prov]]
            e[1] = counter(e[1], t, 7)
            if provpred != altpred:
                e[2] = min(e[2] + 1, 3) if provpred == t else max(e[2] - 1, 0)
            if alt is None and weak:
                base[b] = counter(base[b], t)
        else:
            base[b] = counter(base[b], t)
        if k % (1 << 18) == (1 << 18) - 1:
            for tab in tables:
                for e in tab:
                    e[2] >>= 1
        h = ((h << 1) | t) & ((1 << 256) - 1)
    return miss


def main():
    trace = load(sys.argv[1])
    res = json.load(open(sys.argv[2]))
    want = {(r["predictor"], r["entries"]): r["misses"] for r in res["results"]}
    checks = {
        ("always-taken", 0): lambda: static(trace, False),
        ("btfnt", 0): lambda: static(trace, True),
        ("onebit", 4096): lambda: onebit(trace, 4096),
        ("bimodal", 256): lambda: bimodal(trace, 256),
        ("bimodal", 4096): lambda: bimodal(trace, 4096),
        ("gshare", 4096): lambda: gshare(trace, 4096),
        ("tournament", 1024): lambda: tournament(trace, 1024),
    }
    if "--tage" in sys.argv:
        checks[("tage", 0)] = lambda: tage(trace)
    ok = True
    for key, fn in checks.items():
        got = fn()
        flag = "ok" if got == want[key] else "MISMATCH"
        ok &= got == want[key]
        print(f"{key[0]:>12} {key[1]:>6}: python {got:>9}  predsim {want[key]:>9}  {flag}", flush=True)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
