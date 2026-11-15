"""Fetch and parse the packet captures the experiment uses.

Four small captures from Wireshark's test suite, pinned to one commit and
checked by SHA-256: a TLS session over TCP, two HTTP/2 transfers and a QUIC
connection. All hold whole Ethernet frames from real hosts. They are
downloaded into ./data/ and not committed.

Some frames are larger than an Ethernet frame can be, because the capturing
host recorded them before its network card split them (TCP segmentation
offload). `wire_frames()` keeps only frames of at most 1514 bytes, the size
that actually crosses an Ethernet link without its 4-byte FCS.
"""

from __future__ import annotations

import hashlib
import struct
import urllib.request
from pathlib import Path

COMMIT = "6815438ec3f069454764c9806228cf5705ecb849"
NAMES = [
    "rsasnakeoil2.pcap",
    "http2-data-reassembly.pcap",
    "http2_follow_multistream.pcapng",
    "quic-with-secrets.pcapng",
]
SHA256 = [
    "f3f74008e2585d35479b7a234010a584803c240d82723f1f857bac0eb8a8db57",
    "beaad9c9505c4381bcf2e03d614c2e761a8a499c952be47be6e24346e479afe2",
    "e0a782d9abdf01c20fcf6040a4093d48eb9001207edea422cb1e314ad2796a9d",
    "b7c9de1238aef44d53dbe1add125a7b9e344e9063b98850c78dec23632b83942",
]
DATA = Path(__file__).parent / "data"


def fetch() -> list[Path]:
    DATA.mkdir(exist_ok=True)
    paths = []
    for name, sha in zip(NAMES, SHA256):
        path = DATA / name
        if not path.exists():
            url = f"https://raw.githubusercontent.com/wireshark/wireshark/{COMMIT}/test/captures/{name}"
            path.write_bytes(urllib.request.urlopen(url).read())
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != sha:
            raise SystemExit(f"{name}: sha256 {digest} does not match {sha}")
        paths.append(path)
    return paths


def read_pcapng(path: Path) -> list[bytes]:
    """Frames from the Enhanced Packet Blocks of a little-endian pcapng file."""
    raw = path.read_bytes()
    frames, links, off = [], [], 0
    while off < len(raw):
        btype, blen = struct.unpack_from("<II", raw, off)
        if btype == 0x0A0D0D0A:
            if struct.unpack_from("<I", raw, off + 8)[0] != 0x1A2B3C4D:
                raise ValueError(f"{path}: not little-endian pcapng")
        elif btype == 1:  # interface description
            links.append(struct.unpack_from("<H", raw, off + 8)[0])
        elif btype == 6:  # enhanced packet
            iface, _, _, cap, orig = struct.unpack_from("<IIIII", raw, off + 8)
            if links[iface] != 1 or cap != orig:
                raise ValueError(f"{path}: non-Ethernet or truncated frame")
            frames.append(raw[off + 28:off + 28 + cap])
        off += blen
    return frames


def read_pcap(path: Path) -> list[bytes]:
    """Frames from a classic little-endian pcap file, or a pcapng file."""
    if path.suffix == ".pcapng":
        return read_pcapng(path)
    raw = path.read_bytes()
    magic, = struct.unpack_from("<I", raw, 0)
    if magic != 0xA1B2C3D4:
        raise ValueError(f"{path}: not a little-endian microsecond pcap")
    linktype, = struct.unpack_from("<I", raw, 20)
    if linktype != 1:
        raise ValueError(f"{path}: link type {linktype}, expected Ethernet")
    frames, off = [], 24
    while off < len(raw):
        _, _, incl, orig = struct.unpack_from("<IIII", raw, off)
        off += 16
        if incl != orig:
            raise ValueError(f"{path}: truncated frame")
        frames.append(raw[off:off + incl])
        off += incl
    return frames


def frames() -> list[bytes]:
    out = []
    for path in fetch():
        out += read_pcap(path)
    return out


def wire_frames() -> list[bytes]:
    return [f for f in frames() if len(f) <= 1514]
