"""Independent reference for the stream-sampling figure (components/stream-sampling).

Usage: python3 -I figure_ref.py DIR
Reads DIR/records.bin.gz and DIR/meta.json; writes DIR/figure-check.json
(cases the figure's tests compare against) and DIR/initial.json (the
figure's default view, rendered at build time).

The samplers follow the definitions in the note, and the random draws
follow the figure's generator (Mulberry32, one stream per method and
trial), so the samples must agree exactly.
"""
import gzip
import json
import math
import sys

import numpy as np

D = sys.argv[1]
meta = json.load(open(f"{D}/meta.json"))
raw = np.frombuffer(gzip.decompress(open(f"{D}/records.bin.gz", "rb").read()), dtype=np.uint8).reshape(-1, 5)
P = raw[:, 0].astype(np.int64) | (raw[:, 1].astype(np.int64) << 8)
H = raw[:, 2].astype(np.int64)
W = (raw[:, 3].astype(np.int64) | (raw[:, 4].astype(np.int64) << 8)).astype(np.float64)
N = len(W)
names = meta["names"]
M32 = 0xFFFFFFFF


def mulberry(seed, count):
    """The first count outputs of Mulberry32 from seed, as floats in [0, 1)."""
    a = (np.uint64(seed) + np.arange(1, count + 1, dtype=np.uint64) * np.uint64(0x6D2B79F5)) & np.uint64(M32)
    a = a.astype(np.uint64)

    def imul(x, y):
        return (x * y) & np.uint64(M32)

    t = imul(a ^ (a >> np.uint64(15)), a | np.uint64(1))
    t = ((t + imul(t ^ (t >> np.uint64(7)), t | np.uint64(61))) & np.uint64(M32)) ^ t
    return ((t ^ (t >> np.uint64(14))) & np.uint64(M32)).astype(np.float64) / 4294967296.0


class Stream:
    """Sequential draws from Mulberry32, generated in blocks."""

    def __init__(self, seed):
        self.seed, self.pos, self.buf = seed, 0, mulberry(seed, 1 << 16)

    def next(self):
        if self.pos >= len(self.buf):
            self.buf = mulberry(self.seed, 2 * len(self.buf))
        x = self.buf[self.pos]
        self.pos += 1
        return float(x)

    def take(self, k):
        while self.pos + k > len(self.buf):
            self.buf = mulberry(self.seed, 2 * len(self.buf))
        x = self.buf[self.pos:self.pos + k]
        self.pos += k
        return x


def trial_seed(base, trial, method):
    return ((base * 0x9E3779B1) + 3 * trial + method) & M32


def mask_of(sid):
    if sid == "all":
        return np.ones(N, bool)
    kind, arg = sid.split(":")
    if kind == "p":
        return P == names.index(arg)
    if kind == "h":
        return H == int(arg)
    if kind == "w":
        return W == 1 if arg == "1" else W >= int(arg)
    raise ValueError(sid)


def algorithm_l(n, K, s):
    res = list(range(K))
    Wl = math.exp(math.log(1 - s.next()) / K)
    t = K - 1
    while True:
        t += math.floor(math.log(1 - s.next()) / math.log1p(-Wl)) + 1
        if t >= n:
            break
        res[math.floor(s.next() * K)] = t
        Wl *= math.exp(math.log(1 - s.next()) / K)
    return sorted(res)


def uniform(K, s):
    idx = np.array(algorithm_l(N, K, s))
    return idx, N / K * W[idx], float("nan")


def priority(K, s):
    pri = W / (1 - s.take(N))
    tau = float(np.partition(pri, N - 1 - K)[N - 1 - K])
    idx = np.flatnonzero(pri > tau)
    return idx, np.maximum(W[idx], tau), tau


def ppswor(K, s):
    rank = -np.log(1 - s.take(N)) / W
    tau = float(np.partition(rank, K)[K])
    idx = np.flatnonzero(rank < tau)
    return idx, W[idx] / -np.expm1(-W[idx] * tau), tau


SAMPLERS = [("uniform", uniform), ("priority", priority), ("ppswor", ppswor)]


def run(K, sid, base, trials):
    m = mask_of(sid)
    out = {"K": K, "subset": sid, "base": base, "trials": trials, "truth": float(W[m].sum()), "records": int(m.sum()),
           "est": {name: [] for name, _ in SAMPLERS}, "pvar": []}
    for t in range(trials):
        for mi, (name, f) in enumerate(SAMPLERS):
            idx, adj, tau = f(K, Stream(trial_seed(base, t, mi)))
            inm = m[idx]
            out["est"][name].append(float(adj[inm].sum()))
            if name == "priority":
                w = W[idx][inm]
                out["pvar"].append(float((tau * (tau - w))[w < tau].sum()))
                if t == 0:
                    out["first"] = {"idx": idx.tolist(), "tau": tau, "w": W[idx].tolist(), "inSubset": m[idx].tolist()}
            if t == 0 and name != "priority":
                out.setdefault("firstIdx", {})[name] = idx.tolist()
    return out


if __name__ == "__main__":
    cases = [run(K, sid, base, 6) for K, sid, base in
             [(10, "all", 1), (100, "p:de", 2), (500, "w:1", 3), (1000, "p:en.m", 4), (50, "h:12", 5), (200, "w:100", 1)]]
    json.dump({"n": N, "total": float(W.sum()), "cases": cases}, open(f"{D}/figure-check.json", "w"))
    K0, S0 = int(sys.argv[2]), sys.argv[3]
    init = run(K0, S0, 1, 100)
    json.dump(init, open(f"{D}/initial.json", "w"))
    for name in init["est"]:
        e = np.array(init["est"][name])
        print(name, "rrmse", np.sqrt(((e - init["truth"]) ** 2).mean()) / init["truth"])
