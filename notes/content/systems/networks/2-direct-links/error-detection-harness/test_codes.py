"""Checks codes.py against independent references. Run: python3 test_codes.py"""

from __future__ import annotations

import binascii
import itertools
import random
import struct
import zlib

import captures
import codes


def test_rfc1071_example():
    # RFC 1071, section 3: the words 0001 f203 f4f5 f6f7 sum to 2ddf0,
    # which folds to ddf2.
    data = bytes.fromhex("0001f203f4f5f6f7")
    assert codes.ones_complement_sum(data) == 0xDDF2
    assert codes.internet_checksum(data) == 0x220D


def test_checksum_against_real_packets():
    """Every IPv4 header checksum the senders computed must verify, and our
    computation must reproduce the value in the header field."""
    ip_ok = tcp_ok = tcp_total = 0
    for f in captures.frames():
        ethertype = struct.unpack_from(">H", f, 12)[0]
        if ethertype == 0x86DD:  # IPv6 has no header checksum; check L4
            ip = f[14:]
            plen, nxt = struct.unpack_from(">HB", ip, 4)
            if nxt in (6, 17):
                seg = ip[40:40 + plen]
                pseudo = ip[8:40] + struct.pack(">IxxxB", len(seg), nxt)
                tcp_total += 1
                tcp_ok += codes.checksum_ok(pseudo + seg)
            continue
        if ethertype != 0x0800:
            continue
        ip = f[14:]
        ihl = (ip[0] & 15) * 4
        assert codes.checksum_ok(ip[:ihl])
        zeroed = ip[:10] + b"\x00\x00" + ip[12:ihl]
        assert codes.internet_checksum(zeroed) == struct.unpack_from(">H", ip, 10)[0]
        ip_ok += 1
        total = struct.unpack_from(">H", ip, 2)[0]
        if ip[9] in (6, 17):
            seg = ip[ihl:total]
            pseudo = ip[12:20] + bytes([0, ip[9]]) + struct.pack(">H", len(seg))
            tcp_total += 1
            tcp_ok += codes.checksum_ok(pseudo + seg)
    assert ip_ok > 290
    # Many TCP and UDP checksums in these captures don't verify, for reasons
    # that have nothing to do with errors: packets the capturing host sent
    # carry a placeholder because its network card fills in the real value
    # (checksum offload), and one capture had its addresses rewritten, which
    # changes the pseudo-header the checksum covers. The rest must verify.
    assert tcp_ok >= 100
    print(f"  {ip_ok} IPv4 headers verify; {tcp_ok} of {tcp_total} TCP/UDP checksums verify")


def test_crc32_matches_zlib():
    assert codes.crc32_ieee(b"123456789") == 0xCBF43926  # published check value
    rng = random.Random(1)
    for f in captures.wire_frames()[:50]:
        assert codes.crc32_ieee(f) == zlib.crc32(f)
    for _ in range(200):
        data = rng.randbytes(rng.randrange(0, 300))
        assert codes.crc32_ieee(data) == zlib.crc32(data)


def test_crc16_matches_binascii():
    assert codes.crc16_ccitt(b"123456789") == 0x31C3  # CRC-16/XMODEM check value
    rng = random.Random(2)
    for _ in range(200):
        data = rng.randbytes(rng.randrange(0, 300))
        assert codes.crc16_ccitt(data) == binascii.crc_hqx(data, 0)


def test_crc16_kermit():
    assert codes.crc16_kermit(b"123456789") == 0x2189  # published check value
    rng = random.Random(6)
    gen16 = [1] + [int(b) for b in f"{0x1021:016b}"]
    for _ in range(100):
        data = rng.randbytes(rng.randrange(1, 40))
        # Reflected means: read each byte least significant bit first, divide,
        # and read the remainder back in reverse.
        bits = [(byte >> i) & 1 for byte in data for i in range(8)]
        r = codes.crc_bits(bits, gen16)
        assert int("".join(map(str, reversed(r))), 2) == codes.crc16_kermit(data)


def _poly_mod_int(m: int, g: int) -> int:
    """GF(2) remainder on Python ints, a second implementation."""
    dg = g.bit_length() - 1
    while m.bit_length() - 1 >= dg:
        m ^= g << (m.bit_length() - 1 - dg)
    return m


def test_long_division():
    rng = random.Random(3)
    gen16 = [1] + [int(b) for b in f"{0x1021:016b}"]
    for _ in range(100):
        msg = [rng.randrange(2) for _ in range(rng.randrange(1, 60))]
        for gen in ([1, 0, 1, 1], [1, 0, 0, 1, 1], [1, 1]):
            r = codes.crc_bits(msg, gen)
            g = int("".join(map(str, gen)), 2)
            m = int("".join(map(str, msg)), 2) << (len(gen) - 1)
            assert int("".join(map(str, r)), 2) == _poly_mod_int(m, g)
            # The codeword divides evenly.
            assert not any(codes.poly_mod(msg + r, gen))
        # Bytes as bits, generator 0x11021: the same as the CRC-16 above.
        data = rng.randbytes(8)
        bits = [int(b) for byte in data for b in f"{byte:08b}"]
        r = codes.crc_bits(bits, gen16)
        assert int("".join(map(str, r)), 2) == codes.crc16_ccitt(data)
    # x + 1 as the generator is a parity bit.
    for _ in range(100):
        msg = [rng.randrange(2) for _ in range(rng.randrange(1, 40))]
        assert codes.crc_bits(msg, [1, 1]) == [sum(msg) & 1]


def test_hamming_7_4():
    words = [codes.hamming_encode(list(d)) for d in itertools.product([0, 1], repeat=4)]
    assert all(len(w) == 7 for w in words)
    # Minimum distance 3, by brute force over all pairs.
    dist = min(sum(a != b for a, b in zip(x, y)) for x, y in itertools.combinations(words, 2))
    assert dist == 3
    for w in words:
        assert codes.hamming_syndrome(w) == 0
        for i in range(7):
            bad = list(w)
            bad[i] ^= 1
            fixed, s = codes.hamming_correct(bad)
            assert s == i + 1 and fixed == w
        # Every double error points at a third bit, and "correcting" it
        # produces a different valid codeword: a silent miscorrection.
        for i, j in itertools.combinations(range(7), 2):
            bad = list(w)
            bad[i] ^= 1
            bad[j] ^= 1
            fixed, s = codes.hamming_correct(bad)
            assert s not in (0, i + 1, j + 1)
            assert fixed in words and fixed != w


def test_hamming_longer():
    rng = random.Random(4)
    for n in (1, 4, 11, 26, 57, 100):
        data = [rng.randrange(2) for _ in range(n)]
        w = codes.hamming_encode(data)
        assert codes.hamming_data(w) == data
        assert codes.hamming_syndrome(w) == 0
        for i in range(len(w)):
            bad = list(w)
            bad[i] ^= 1
            assert codes.hamming_correct(bad)[0] == w
    # 2^k - k - 1 data bits fit under k check bits.
    for k in range(2, 8):
        n = 2**k - k - 1
        assert len(codes.hamming_encode([0] * n)) == 2**k - 1


def _old_note_sketch(data):
    # The encoder the note printed before this rewrite, kept to check it.
    n = len(data)
    k, acc = 0, 1
    while acc < n + k + 1:
        k += 1
        acc *= 2
    code = [0] * (n + k)
    j = 0
    for i in range(1, n + k + 1):
        if i & (i - 1) == 0:
            code[i - 1] = 0
        else:
            code[i - 1] = data[j]
            j += 1
    for i in range(k):
        j = 2**i
        for l in range(j, n + k + 1):
            if l & j:
                code[j - 1] ^= code[l - 1]
    return code


def test_old_hamming_sketch_was_right():
    rng = random.Random(5)
    for n in range(1, 40):
        data = [rng.randrange(2) for _ in range(n)]
        assert _old_note_sketch(data) == codes.hamming_encode(data)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
