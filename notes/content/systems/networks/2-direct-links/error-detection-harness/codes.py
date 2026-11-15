"""Reference implementations of the codes in the error detection note.

Each one is checked by `test_codes.py` against an independent reference:
the Internet checksum against real IPv4 and TCP checksums in packet captures,
the CRCs against Python's zlib and binascii and the published check values,
and the Hamming code against brute-force nearest-codeword decoding.
"""

from __future__ import annotations


# --- Parity ---------------------------------------------------------------

def parity_bit(data: bytes) -> int:
    """Even parity: 1 if data holds an odd number of 1 bits."""
    return sum(bin(b).count("1") for b in data) & 1


# --- Internet checksum (RFC 1071) ------------------------------------------

def ones_complement_sum(data: bytes) -> int:
    """16-bit ones' complement sum of big-endian words, odd length zero-padded."""
    if len(data) % 2:
        data += b"\x00"
    total = 0
    for i in range(0, len(data), 2):
        total += (data[i] << 8) | data[i + 1]
    while total > 0xFFFF:  # end-around carry
        total = (total & 0xFFFF) + (total >> 16)
    return total


def internet_checksum(data: bytes) -> int:
    """The value a sender puts in the checksum field (field zeroed first)."""
    return ~ones_complement_sum(data) & 0xFFFF


def checksum_ok(data_with_checksum: bytes) -> bool:
    """Receiver check: summing everything, checksum included, gives 0xFFFF."""
    return ones_complement_sum(data_with_checksum) == 0xFFFF


# --- CRCs, bit by bit ------------------------------------------------------

def crc32_ieee(data: bytes) -> int:
    """CRC-32 as Ethernet uses it: generator 0x04C11DB7, reflected,
    register preset to all ones and complemented at the end."""
    reg = 0xFFFFFFFF
    for byte in data:
        reg ^= byte
        for _ in range(8):
            # 0xEDB88320 is 0x04C11DB7 with its bits reversed.
            reg = (reg >> 1) ^ (0xEDB88320 if reg & 1 else 0)
    return reg ^ 0xFFFFFFFF


def crc16_ccitt(data: bytes, init: int = 0x0000) -> int:
    """CRC-16 with generator x^16 + x^12 + x^5 + 1 (0x1021), not reflected.
    With init 0 this is the variant often called CRC-16/XMODEM."""
    reg = init
    for byte in data:
        reg ^= byte << 8
        for _ in range(8):
            reg = ((reg << 1) ^ 0x1021) & 0xFFFF if reg & 0x8000 else (reg << 1) & 0xFFFF
    return reg


def crc16_kermit(data: bytes) -> int:
    """The same generator 0x1021, reflected (bits taken least significant
    first, as Ethernet sends them), register preset to zero. Sent low byte
    first. Often called CRC-16/KERMIT."""
    reg = 0
    for byte in data:
        reg ^= byte
        for _ in range(8):
            reg = (reg >> 1) ^ (0x8408 if reg & 1 else 0)
    return reg


def poly_mod(bits: list[int], gen: list[int]) -> list[int]:
    """Remainder of a GF(2) polynomial division, highest power first.
    This is the long division the note's CRC figure steps through."""
    work = list(bits)
    k = len(gen) - 1
    for i in range(len(work) - k):
        if work[i]:
            for j, g in enumerate(gen):
                work[i + j] ^= g
    return work[-k:]


def crc_bits(message: list[int], gen: list[int]) -> list[int]:
    """Check bits: the remainder of message * x^k divided by the generator."""
    return poly_mod(message + [0] * (len(gen) - 1), gen)


# --- Hamming codes ---------------------------------------------------------

def hamming_encode(data: list[int]) -> list[int]:
    """Classic Hamming code: check bits at positions 1, 2, 4, 8, ...
    (1-based), data bits everywhere else, each check bit the even parity of
    the positions whose index has that bit set."""
    k = 0
    while (1 << k) < len(data) + k + 1:
        k += 1
    n = len(data) + k
    code = [0] * (n + 1)  # index 0 unused
    it = iter(data)
    for pos in range(1, n + 1):
        if pos & (pos - 1):  # not a power of two
            code[pos] = next(it)
    for i in range(k):
        p = 1 << i
        code[p] = sum(code[pos] for pos in range(1, n + 1) if pos & p and pos != p) & 1
    return code[1:]


def hamming_syndrome(word: list[int]) -> int:
    """XOR of the 1-based positions of every 1 bit. Zero for a codeword;
    for a single flipped bit, it is that bit's position."""
    s = 0
    for pos, bit in enumerate(word, start=1):
        if bit:
            s ^= pos
    return s


def hamming_correct(word: list[int]) -> tuple[list[int], int]:
    """Flip the bit the syndrome points at. Returns (word, syndrome)."""
    s = hamming_syndrome(word)
    out = list(word)
    if 0 < s <= len(out):
        out[s - 1] ^= 1
    return out, s


def hamming_data(word: list[int]) -> list[int]:
    return [b for pos, b in enumerate(word, start=1) if pos & (pos - 1)]
