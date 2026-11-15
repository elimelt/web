"""How many errors does each code miss? Run: python3 experiment.py

Protects every captured wire-size Ethernet frame four ways (one even parity
bit, the 16-bit Internet checksum, a 16-bit CRC and Ethernet's CRC-32), flips
bits in the protected frame, and counts the corrupted frames the receiver
would accept.

Error models, over the codeword's bits in the order Ethernet sends them
(bytes in order, least significant bit first, check field included):

- k random bit flips: k distinct positions, uniform;
- a burst of length b: the first and last bit of a b-bit span flip, each bit
  between flips with probability 1/2;
- a word swap: two different aligned 16-bit words trade places.

A frame is chosen with probability proportional to its length, so every bit
of the traffic is equally likely to be hit.

All four codes use exact arithmetic on the frames, vectorized with numpy. For
the CRCs and parity this works because they are linear over GF(2): whether an
error is caught depends only on the error pattern, so each flipped bit's
effect on the check value is precomputed. The Internet checksum is not
linear over GF(2); its verdict depends on the data, and it is computed from
each frame's real words. `verify_sample()` re-checks a sample of trials, and
every missed error, by corrupting the bytes and running the plain receivers
from codes.py.
"""

from __future__ import annotations

import json
import platform
import sys
import time
import zlib
from pathlib import Path

import numpy as np

import captures
import codes

SEEDS = [11, 12, 13, 14, 15]
TRIALS = 200_000  # per seed, per code, per error model
WEIGHTS = [1, 2, 3, 4, 5, 6]
BURSTS = [8, 15, 16, 17, 24, 32, 33, 48, 64, 128]
CODES = ["parity", "checksum", "crc16", "crc32"]
CHECK_BITS = {"parity": 1, "checksum": 16, "crc16": 16, "crc32": 32}


def pad(frame: bytes) -> bytes:
    """All codes protect the same bytes: the frame, zero-padded to even length."""
    return frame + b"\x00" if len(frame) % 2 else frame


def codeword(code: str, data: bytes) -> bytes:
    if code == "checksum":
        return data + codes.internet_checksum(data).to_bytes(2, "big")
    if code == "crc16":
        return data + codes.crc16_kermit(data).to_bytes(2, "little")
    if code == "crc32":
        return data + zlib.crc32(data).to_bytes(4, "little")
    raise ValueError(code)


def accepts(code: str, word: bytes, nbits: int) -> bool:
    """The plain receiver, used to cross-check the vectorized counts."""
    if code == "parity":
        # The parity bit rides in the low bit of one extra byte.
        return codes.parity_bit(word[:-1]) == (word[-1] & 1)
    if code == "checksum":
        return codes.checksum_ok(word)
    if code == "crc16":
        return codes.crc16_kermit(word[:-2]) == int.from_bytes(word[-2:], "little")
    if code == "crc32":
        return zlib.crc32(word[:-4]) == int.from_bytes(word[-4:], "little")
    raise ValueError(code)


def crc_tables(max_len: int):
    """Effect on the check value of flipping bit i (LSB first) of the byte d
    bytes from the end of the data. Linear CRCs with a zero register give
    this by feeding zeros; Ethernet's preset and final inversion cancel out
    when comparing a corrupted frame with the original."""
    out = {}
    for name, poly, width in (("crc16", 0x8408, 16), ("crc32", 0xEDB88320, 32)):
        t = np.zeros((max_len + 1, 8), dtype=np.uint64)
        for bit in range(8):
            reg = 1 << bit
            for d in range(1, max_len + 1):
                for _ in range(8):
                    reg = (reg >> 1) ^ (poly if reg & 1 else 0)
                t[d, bit] = reg  # the next byte of zeros continues from here
        out[name] = t
    return out


def sample_positions(rng, nbits, model, param, n):
    """Return (positions[n, w], mask[n, w]) of flipped bits."""
    if model == "weight":
        k = param
        pos = (rng.random((n, k)) * nbits[:, None]).astype(np.int64)
        while True:
            s = np.sort(pos, axis=1)
            dup = (np.diff(s, axis=1) == 0).any(axis=1) if k > 1 else np.zeros(n, bool)
            if not dup.any():
                break
            pos[dup] = (rng.random((dup.sum(), k)) * nbits[dup, None]).astype(np.int64)
        return pos, np.ones((n, k), bool)
    if model == "burst":
        b = param
        start = (rng.random(n) * (nbits - b + 1)).astype(np.int64)
        pos = start[:, None] + np.arange(b)[None, :]
        mask = rng.random((n, b)) < 0.5
        mask[:, 0] = mask[:, -1] = True
        return pos, mask
    raise ValueError(model)


class Pool:
    """The frames, their codewords per code, and arrays for fast lookup."""

    def __init__(self, frames: list[bytes]):
        self.data = [pad(f) for f in frames]
        self.lens = np.array([len(d) for d in self.data])
        self.max_len = int(self.lens.max())
        # Words of each checksum codeword, padded into one matrix.
        cw = [codeword("checksum", d) for d in self.data]
        self.words = np.zeros((len(cw), (self.max_len + 2) // 2), dtype=np.int64)
        for i, w in enumerate(cw):
            arr = np.frombuffer(w, dtype=">u2").astype(np.int64)
            self.words[i, : len(arr)] = arr
        self.tables = crc_tables(self.max_len)

    def nbits(self, code):
        if code == "parity":
            return self.lens * 8 + 1
        return self.lens * 8 + CHECK_BITS[code]


def undetected(pool: Pool, code: str, frame_idx, pos, mask):
    """Boolean per trial: the corrupted codeword still passes."""
    if code == "parity":
        return mask.sum(axis=1) % 2 == 0
    byte = pos // 8
    bit = pos % 8
    L = pool.lens[frame_idx][:, None]
    if code == "checksum":
        # Byte j sits in word j // 2, high half if j is even (big-endian).
        # Bit i of a byte is sent i-th, so it is bit i of the byte's value.
        word = byte // 2
        shift = bit + 8 * (1 - byte % 2)
        val = pool.words[frame_idx[:, None], word]
        was_one = (val >> shift) & 1
        delta = np.where(was_one == 1, -(1 << shift), 1 << shift)
        total = np.where(mask, delta, 0).sum(axis=1)
        return total % 0xFFFF == 0
    table = pool.tables[code]
    in_data = byte < L
    dist = np.where(in_data, L - byte, 0)
    contrib = table[dist, bit]
    lin = np.bitwise_xor.reduce(np.where(mask & in_data, contrib, np.uint64(0)), axis=1)
    check_bit = (byte - L) * 8 + bit
    field = np.where(mask & ~in_data, np.left_shift(np.uint64(1), np.maximum(check_bit, 0).astype(np.uint64)), np.uint64(0))
    field = np.bitwise_xor.reduce(field, axis=1)
    return lin == field


CHUNK = 50_000


def run_flips(pool: Pool, code: str, model: str, param: int, seed: int, n: int):
    """Returns (misses, first chunk's frame_idx, pos, mask, miss) for checks."""
    rng = np.random.default_rng([seed, CODES.index(code), {"weight": 1, "burst": 2}[model], param])
    p = pool.lens / pool.lens.sum()
    misses, first = 0, None
    for start in range(0, n, CHUNK):
        m = min(CHUNK, n - start)
        frame_idx = rng.choice(len(pool.lens), size=m, p=p)
        nbits = pool.nbits(code)[frame_idx]
        pos, mask = sample_positions(rng, nbits, model, param, m)
        miss = undetected(pool, code, frame_idx, pos, mask)
        misses += int(miss.sum())
        if first is None:
            first = (frame_idx, pos, mask, miss)
    return (misses, *first)


def run_swaps(pool: Pool, code: str, seed: int, n: int):
    """Swap two different aligned 16-bit words of the data, checked directly."""
    rng = np.random.default_rng([seed, CODES.index(code), 999])
    p = pool.lens / pool.lens.sum()
    misses = tried = 0
    for i in rng.choice(len(pool.lens), size=n, p=p):
        d = pool.data[i]
        nw = len(d) // 2
        a, b = rng.choice(nw, size=2, replace=False)
        if d[2 * a:2 * a + 2] == d[2 * b:2 * b + 2]:
            continue
        w = bytearray(d)
        w[2 * a:2 * a + 2], w[2 * b:2 * b + 2] = d[2 * b:2 * b + 2], d[2 * a:2 * a + 2]
        tried += 1
        if code == "parity":
            misses += 1  # same bits, same count of ones
            continue
        word = bytes(w) + codeword(code, d)[len(d):]
        misses += accepts(code, word, 0)
    return misses, tried


def corrupt(pool: Pool, code: str, i: int, pos, mask) -> bytes:
    d = pool.data[i]
    word = bytearray(d + b"\x00") if code == "parity" else bytearray(codeword(code, d))
    if code == "parity":
        word[-1] = codes.parity_bit(d)
    for p_, m in zip(pos, mask):
        if m:
            word[p_ // 8] ^= 1 << (p_ % 8)
    return bytes(word)


def verify_sample(pool, code, frame_idx, pos, mask, miss, rng, k=300):
    """Every missed error plus k random trials, through the plain receivers."""
    idx = np.concatenate([np.flatnonzero(miss)[:2000], rng.choice(len(miss), size=k, replace=False)])
    for t in idx:
        word = corrupt(pool, code, int(frame_idx[t]), pos[t], mask[t])
        assert accepts(code, word, 0) == bool(miss[t]), (code, t)
    return len(idx)


def summarize(counts, n):
    rates = [c / n for c in counts]
    total = sum(counts)
    N = n * len(counts)
    return {
        "missed": total,
        "trials": N,
        "rate": total / N,
        "seed_min": min(rates),
        "seed_max": max(rates),
        # Rule of three: with no misses, the 95% upper bound is 3/N.
        "upper95_if_zero": 3 / N if total == 0 else None,
    }


def main():
    t0 = time.time()
    pool = Pool(captures.wire_frames())
    rng_v = np.random.default_rng(0)
    results = {"frames": len(pool.lens), "bytes": int(pool.lens.sum()), "models": {}}
    checked = 0
    models = [("weight", k) for k in WEIGHTS] + [("burst", b) for b in BURSTS]
    for model, param in models:
        key = f"{model}-{param}"
        results["models"][key] = {}
        for code in CODES:
            counts = []
            for seed in SEEDS:
                c, fi, pos, mask, miss = run_flips(pool, code, model, param, seed, TRIALS)
                counts.append(c)
                if seed == SEEDS[0]:
                    checked += verify_sample(pool, code, fi, pos, mask, miss, rng_v)
            results["models"][key][code] = summarize(counts, TRIALS)
        row = "  ".join(f"{c}={results['models'][key][c]['rate']:.3g}" for c in CODES)
        print(f"{key:10s} {row}  ({time.time() - t0:.0f}s)", flush=True)

    # Random-data control for the checksum: same lengths, uniform bytes.
    rng = np.random.default_rng(42)
    rand_pool = Pool([rng.bytes(int(n)) for n in pool.lens])
    results["checksum_random_data"] = {}
    for model, param in models:
        counts = [run_flips(rand_pool, "checksum", model, param, s, TRIALS)[0] for s in SEEDS]
        results["checksum_random_data"][f"{model}-{param}"] = summarize(counts, TRIALS)
    print("random-data checksum:", {k: f"{v['rate']:.3g}" for k, v in results["checksum_random_data"].items()})

    swap_n = 20_000
    results["swap"] = {}
    for code in CODES:
        out = [run_swaps(pool, code, s, swap_n) for s in SEEDS]
        results["swap"][code] = {"missed": sum(m for m, _ in out), "trials": sum(t for _, t in out)}
    print("swaps:", results["swap"])

    results["verified_trials"] = checked
    results["environment"] = {
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "machine": platform.machine(),
        "processor": platform.processor() or "unknown",
        "runtime_s": round(time.time() - t0, 1),
        "seeds": SEEDS,
        "trials_per_seed": TRIALS,
    }
    out = Path(__file__).with_name("results.json")
    out.write_text(json.dumps(results, indent=1) + "\n")
    print(f"wrote {out.name}; {checked} trials re-checked by the plain receivers; {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
