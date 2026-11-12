#!/usr/bin/env python3
"""Give note images their intrinsic size so the layout does not shift as they load.

Quartz emits ``<img>`` tags without ``width`` and ``height``. This post-build
step reads each PNG or GIF's header (local files and ``data:`` URIs from
notebook output) and adds both attributes; custom.scss sets ``height: auto`` so
images still scale down. Every image after a page's first also gets
``loading="lazy"``, and all get ``decoding="async"``.
"""

from __future__ import annotations

import argparse
import base64
import re
import struct
from pathlib import Path
from urllib.parse import unquote, urlsplit

IMG_TAG = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
SRC_ATTR = re.compile(r'\ssrc="([^"]*)"', re.IGNORECASE)
SKIPPED_DIRS = {"docs", "static"}


def image_size(header: bytes) -> tuple[int, int] | None:
    if header.startswith(b"\x89PNG\r\n\x1a\n") and header[12:16] == b"IHDR":
        return struct.unpack(">II", header[16:24])
    if header[:6] in (b"GIF87a", b"GIF89a"):
        return struct.unpack("<HH", header[6:10])
    return None


def read_header(output_root: Path, html_path: Path, src: str) -> bytes | None:
    if src.startswith("data:"):
        meta, _, data = src.partition(",")
        if not meta.endswith(";base64"):
            return None
        # 32 base64 characters decode to the 24 header bytes needed.
        return base64.b64decode(data[:32] + "=" * (-len(data[:32]) % 4))
    parts = urlsplit(src)
    if parts.scheme or parts.netloc:
        return None
    path = unquote(parts.path)
    file = output_root / path.lstrip("/") if path.startswith("/") else html_path.parent / path
    try:
        with file.open("rb") as handle:
            return handle.read(24)
    except OSError:
        return None


def has_attr(tag: str, name: str) -> bool:
    return re.search(rf"\s{name}=", tag, re.IGNORECASE) is not None


def annotate(output_root: Path, html_path: Path, text: str) -> tuple[str, int]:
    changed = 0
    seen = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal changed, seen
        tag = match.group(0)
        seen += 1
        additions = []
        src = SRC_ATTR.search(tag)
        if src and not has_attr(tag, "width") and not has_attr(tag, "height"):
            header = read_header(output_root, html_path, src.group(1))
            size = image_size(header) if header else None
            if size and all(size):
                additions.append(f'width="{size[0]}" height="{size[1]}"')
        if seen > 1 and not has_attr(tag, "loading"):
            additions.append('loading="lazy"')
        if not has_attr(tag, "decoding"):
            additions.append('decoding="async"')
        if not additions:
            return tag
        changed += 1
        end = -2 if tag.endswith("/>") else -1
        return f"{tag[:end].rstrip()} {' '.join(additions)}{tag[end:]}"

    return IMG_TAG.sub(replace, text), changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("output", type=Path, help="built site directory (public/)")
    args = parser.parse_args()

    images = 0
    for html_path in sorted(args.output.rglob("*.html")):
        if html_path.relative_to(args.output).parts[0] in SKIPPED_DIRS:
            continue
        text = html_path.read_text(encoding="utf-8")
        if "<img" not in text:
            continue
        updated, changed = annotate(args.output, html_path, text)
        if changed:
            html_path.write_text(updated, encoding="utf-8")
            images += changed
    print(f"Annotated {images} images with size and loading hints.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
