# Independent NumPy reference for the hash-family figure (32-bit families,
# HyperLogLog with p = 10 and Ertl's estimator).  Parameters are drawn from
# mulberry32 exactly as the figure draws them.
import numpy as np, math, json, sys
M32 = 0xffffffff
def mulberry32(seed):
    a = seed & M32
    def f():
        nonlocal a
        a = (a + 0x6d2b79f5) & M32
        t = ((a ^ (a >> 15)) * (1 | a)) & M32
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & M32)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296
    return f
P31 = (1 << 31) - 1
FAMS = ["ms", "mslo", "mas", "cw", "poly4", "tab", "fmix"]
def u32(r): return int(r() * 4294967296)
def params(fam, seed):
    r = mulberry32(seed)
    d = {}
    if fam in ("ms", "mslo"): d["a"] = u32(r) | 1
    elif fam == "mas": d["a"] = (u32(r) << 32) | u32(r); d["b"] = (u32(r) << 32) | u32(r)
    elif fam == "cw": d["c"] = [u32(r) % (P31 - 1) + 1, u32(r) % P31]
    elif fam == "poly4": d["c"] = [u32(r) % P31 for _ in range(4)]
    elif fam == "tab": d["T"] = np.array([[u32(r) for _ in range(256)] for _ in range(4)], dtype=np.uint64)
    else: d["s"] = u32(r)
    return d
def fmix32(h):
    h = h.astype(np.uint64)
    h ^= h >> np.uint64(16); h = (h * np.uint64(0x85ebca6b)) & np.uint64(M32)
    h ^= h >> np.uint64(13); h = (h * np.uint64(0xc2b2ae35)) & np.uint64(M32)
    h ^= h >> np.uint64(16); return h
def scramble31(i):
    x = i.astype(np.uint64); m = np.uint64(0x7fffffff)
    x ^= x >> np.uint64(16); x = (x * np.uint64(0x2c1b3c6d)) & m
    x ^= x >> np.uint64(13); x = (x * np.uint64(0x297a2d39)) & m
    x ^= x >> np.uint64(16); return x
def keys(ks, n):
    i = np.arange(n, dtype=np.uint64)
    if ks == "dense": return i
    if ks == "stride": return i * np.uint64(1024)
    return scramble31(i)
def hashv(fam, d, x):
    x = [int(v) for v in x] if fam in ("mas", "cw", "poly4") else x
    if fam in ("ms", "mslo"): return (x * np.uint64(d["a"])) & np.uint64(M32)
    if fam == "mas": return np.array([((d["a"] * v + d["b"]) % (1 << 64)) >> 32 for v in x], dtype=np.uint64)
    if fam == "cw": a, b = d["c"]; return np.array([((a * (v % P31) + b) % P31) * 2 for v in x], dtype=np.uint64)
    if fam == "poly4":
        c = d["c"]; out = []
        for v in x:
            y = v % P31; h = c[0]
            for k in (1, 2, 3): h = (h * y + c[k]) % P31
            out.append(h * 2)
        return np.array(out, dtype=np.uint64)
    if fam == "tab":
        T = d["T"]; h = np.zeros(len(x), dtype=np.uint64)
        for c in range(4): h ^= T[c][((x >> np.uint64(8 * c)) & np.uint64(255)).astype(np.int64)]
        return h
    return fmix32(x ^ np.uint64(d["s"]))
def sigma(x):
    if x == 1: return math.inf
    y, z = 1.0, x
    while True:
        x *= x; zp = z; z += x * y; y += y
        if zp == z: return z
def tau(x):
    if x in (0, 1): return 0.0
    y, z = 1.0, 1 - x
    while True:
        x = math.sqrt(x); zp = z; y *= 0.5; z -= (1 - x) ** 2 * y
        if zp == z: return z / 3
def registers(fam, v, p):
    m = 1 << p
    if fam == "mslo": idx = (v & np.uint64(m - 1)).astype(np.int64); w = v & np.uint64(M32 ^ (m - 1))
    else: idx = (v >> np.uint64(32 - p)).astype(np.int64); w = (v << np.uint64(p)) & np.uint64(M32)
    wf = w.astype(np.float64)
    r = np.where(w == 0, 32 - p + 1, 32 - np.floor(np.log2(np.maximum(wf, 1))).astype(np.int64))
    reg = np.zeros(m, dtype=np.int64); np.maximum.at(reg, idx, r); return reg
def ertl(reg, p):
    m = 1 << p; q = 32 - p; C = np.bincount(reg, minlength=q + 2)
    z = m * tau((m - C[q + 1]) / m)
    for k in range(q, 0, -1): z = (z + C[k]) * 0.5
    z += m * sigma(C[0] / m)
    return m * m / (2 * math.log(2)) / z
def run(ks, fam, n, seed, p=10):
    x = keys(ks, n); v = hashv(fam, params(fam, seed), x); reg = registers(fam, v, p)
    return ertl(reg, p), np.bincount(reg, minlength=32 - p + 2).tolist()
if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 65536
    for ks in ["dense", "stride", "scrambled"]:
        for fam in FAMS:
            e = [run(ks, fam, n, 1000 + t)[0] / n - 1 for t in range(16 if fam in ("mas","cw","poly4") else 32)]
            print(ks, fam, "median %+.3f sd %.4f" % (np.median(e), np.std(e)))
