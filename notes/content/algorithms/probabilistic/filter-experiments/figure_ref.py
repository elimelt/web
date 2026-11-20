"""Reference for the FilterLoad figure (components/filter-load/model.ts).

Re-implements the figure's hashing and its six builds in plain Python and
checks two of them against independent algorithms: the 2-core left by peeling
is recomputed by repeated full scans, and ribbon success is recomputed as the
GF(2) rank of the dense coefficient matrix. Writes figure-check.json, which
the figure's tests compare against.

    python3 figure_ref.py > figure-check.json
"""
import json
import os
import math
import sys

M32 = 0xFFFFFFFF


def fmix32(h):
    h &= M32
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & M32
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & M32
    h ^= h >> 16
    return h


def rng(h, r):
    return (h * r) >> 32


def seeds(seed):
    a = seed & M32
    out = []
    for _ in range(6):
        a = (a + 0x9E3779B9) & M32
        out.append(fmix32(a))
    return {"s": out[0], "t": out[1:5], "walk": out[5]}


def words(sd, x):
    base = fmix32((x + sd["s"]) & M32)
    return [fmix32(base ^ t) for t in sd["t"]]


def fuse_layout(n, S):
    nn = max(n, 2)
    seg = 2 ** math.floor(math.log(nn) / math.log(3.33) + 2.25)
    seg = min(seg, 262144, S // 4)
    return seg, S // seg - 2


def positions(kind, S, n, sd, x):
    w = words(sd, x)
    if kind == "xor":
        bl = S // 3
        return [rng(w[0], bl), bl + rng(w[1], bl), 2 * bl + rng(w[2], bl)]
    seg, count = fuse_layout(n, S)
    p0 = rng(w[0], seg * count)
    return [p0, (p0 + seg) ^ (w[1] & (seg - 1)), (p0 + 2 * seg) ^ (w[2] & (seg - 1))]


def alt(i, fp, nb):
    return i ^ (fmix32((fp * 0x5BD1E995) & M32) & (nb - 1))


def cuckoo(S, b, n, sd):
    nb = S // b
    t = [0] * S
    state = [sd["walk"]]

    def rand():
        state[0] = (state[0] + 0x6D2B79F5) & M32
        return fmix32(state[0])

    def put(i, fp):
        for j in range(b):
            if t[i * b + j] == 0:
                t[i * b + j] = fp
                return True
        return False

    kicks = placed = 0
    for x in range(n):
        w = words(sd, x)
        i1 = w[0] & (nb - 1)
        fp = (w[1] & 0xFFFF) or 1
        i2 = alt(i1, fp, nb)
        if put(i1, fp) or put(i2, fp):
            placed += 1
            continue
        i = i1 if rand() & 1 else i2
        ok = False
        for _ in range(500):
            j = rand() % b
            v = t[i * b + j]
            t[i * b + j] = fp
            fp = v
            kicks += 1
            i = alt(i, fp, nb)
            if put(i, fp):
                ok = True
                break
        if not ok:
            break
        placed += 1
    return {"placed": placed, "ok": placed == n, "stat": kicks, "used": sum(1 for v in t if v)}


def peel(kind, S, n, sd):
    pos = [positions(kind, S, n, sd, x) for x in range(n)]
    cnt = [0] * S
    xm = [0] * S
    for x, p in enumerate(pos):
        for c in p:
            cnt[c] += 1
            xm[c] ^= x
    q = [c for c in range(S) if cnt[c] == 1]
    done = 0
    h = 0
    while h < len(q):
        c = q[h]
        h += 1
        if cnt[c] != 1:
            continue
        x = xm[c]
        done += 1
        for d in pos[x]:
            cnt[d] -= 1
            xm[d] ^= x
            if cnt[d] == 1:
                q.append(d)
    return {"placed": done, "ok": done == n, "stat": n - done}, pos


def core_by_scans(S, pos):
    """2-core of the hypergraph by repeated full scans: remove any key that owns a slot of degree 1."""
    alive = set(range(len(pos)))
    while True:
        deg = [0] * S
        for x in alive:
            for c in pos[x]:
                deg[c] += 1
        gone = [x for x in alive if any(deg[c] == 1 for c in pos[x])]
        if not gone:
            return len(alive)
        alive.difference_update(gone)


def ribbon(S, wd, n, sd):
    lo = [0] * S
    rows = []
    for x in range(n):
        w = words(sd, x)
        i = rng(w[0], S - wd + 1)
        c = (w[1] | 1) | ((w[2] << 32) if wd == 64 else 0)
        rows.append(c << i)
        while True:
            if lo[i] == 0:
                lo[i] = c
                break
            c ^= lo[i]
            if c == 0:
                return {"placed": x, "ok": False, "stat": x}, rows
            j = (c & -c).bit_length() - 1
            c >>= j
            i += j
    return {"placed": n, "ok": True, "stat": -1}, rows


def first_dependent(rows):
    """Index of the first row in the GF(2) span of the rows before it, by dense elimination; -1 if none."""
    basis = {}
    for k, r in enumerate(rows):
        while r:
            top = r.bit_length() - 1
            if top not in basis:
                basis[top] = r
                break
            r ^= basis[top]
        if r == 0:
            return k
    return -1


def main():
    out = {"mix": [], "seeds": {}, "cases": [], "fuse": []}
    for x in [0, 1, 2, 12345, 0x7FFFFFFF, 0x80000000, M32, 0xDEADBEEF]:
        out["mix"].append({"x": x, "fmix32": fmix32(x)})
    for s in [1, 2, 3, 99, 123456789]:
        out["seeds"][str(s)] = seeds(s)
    for n in [2, 100, 230, 1000, 3700, 30000, 60000]:
        for S in [256, 4096, 65536]:
            if n <= S:
                seg, count = fuse_layout(n, S)
                out["fuse"].append({"n": n, "S": S, "seg": seg, "count": count})
    kinds = ["cuckoo2", "cuckoo4", "xor", "fuse", "ribbon32", "ribbon64"]
    checks = 0
    for kind in kinds:
        for S, loads in [(256, [0.7, 0.8, 0.85, 0.9, 0.95]), (4096, [0.8, 0.9])]:
            for load in loads:
                for seed in [1, 2, 3]:
                    n = round(load * S)
                    sd = seeds(seed)
                    if kind.startswith("cuckoo"):
                        r = cuckoo(S, 2 if kind == "cuckoo2" else 4, n, sd)
                    elif kind.startswith("ribbon"):
                        r, rows = ribbon(S, 32 if kind == "ribbon32" else 64, n, sd)
                        dep = first_dependent(rows)
                        assert dep == r["stat"], (kind, S, load, seed, dep, r)
                        checks += 1
                    else:
                        r, pos = peel(kind, S, n, sd)
                        assert core_by_scans(S, pos) == r["stat"], (kind, S, load, seed)
                        checks += 1
                    out["cases"].append({"kind": kind, "S": S, "n": n, "seed": seed, **r})
    print(f"independent checks passed: {checks}", file=sys.stderr)
    # The C harness's runs of the same six layouts on the pageview keys
    # (exp J), which the figure's tests compare with the browser's rates.
    jpath = os.path.join(os.path.dirname(os.path.abspath(__file__)), "J.txt")
    if os.path.exists(jpath):
        runs = {}
        for line in open(jpath):
            if line.startswith("#") or not line.strip():
                continue
            kind, S, load, trials, ok = line.split()
            runs.setdefault(kind, []).append({"load": float(load), "trials": int(trials), "ok": int(ok)})
        for v in runs.values():
            v.sort(key=lambda e: e["load"])
        out["pageview"] = {"S": 4096, "runs": runs}
    json.dump(out, sys.stdout, indent=None, separators=(",", ":"))


if __name__ == "__main__":
    main()
