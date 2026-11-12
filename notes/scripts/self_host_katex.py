#!/usr/bin/env python3
"""Serve KaTeX's stylesheet, fonts and copy-tex script from this site.

The latex plugin links KaTeX 0.16.11 from jsDelivr on every page, while it
renders math with a newer bundled KaTeX. That stylesheet blocks rendering and
needs a connection to a second origin before any text paints. This post-build
step copies the KaTeX release the plugin renders with into
``static/katex/<version>/`` and points every page at it, so the styles match
the markup and come from the same origin as the page. Only the WOFF2 fonts are
kept, since every browser that runs the site supports them.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

CDN_PREFIX = re.compile(r"https://cdn\.jsdelivr\.net/npm/katex@[^/\"']+/dist/")
LEGACY_FONT_SOURCES = re.compile(r',url\(fonts/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)')
FILES = ("katex.min.css", "contrib/copy-tex.min.js")


def copy_assets(katex_dir: Path, destination: Path) -> int:
    dist = katex_dir / "dist"
    if destination.exists():
        shutil.rmtree(destination)
    (destination / "fonts").mkdir(parents=True)
    (destination / "contrib").mkdir()
    css = (dist / FILES[0]).read_text(encoding="utf-8")
    css, legacy = LEGACY_FONT_SOURCES.subn("", css)
    if legacy == 0:
        raise SystemExit("error: KaTeX stylesheet no longer lists WOFF and TTF fallbacks; update this script")
    (destination / FILES[0]).write_text(css, encoding="utf-8")
    shutil.copy2(dist / FILES[1], destination / FILES[1])
    fonts = sorted((dist / "fonts").glob("*.woff2"))
    for font in fonts:
        shutil.copy2(font, destination / "fonts" / font.name)
    missing = sorted(set(re.findall(r"url\(fonts/([^)]+)\)", css)) - {font.name for font in fonts})
    if missing:
        raise SystemExit(f"error: KaTeX stylesheet references missing fonts: {', '.join(missing)}")
    return len(fonts)


def rewrite_pages(output_root: Path, url_prefix: str) -> int:
    pages = 0
    for html_path in output_root.rglob("*.html"):
        if html_path.relative_to(output_root).parts[0] in {"docs", "static"}:
            continue
        text = html_path.read_text(encoding="utf-8")
        updated, count = CDN_PREFIX.subn(url_prefix, text)
        if count:
            html_path.write_text(updated, encoding="utf-8")
            pages += 1
    return pages


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("katex", type=Path, help="installed katex package directory")
    parser.add_argument("output", type=Path, help="built site directory (public/)")
    args = parser.parse_args()

    version = json.loads((args.katex / "package.json").read_text(encoding="utf-8"))["version"]
    relative = f"static/katex/{version}"
    fonts = copy_assets(args.katex, args.output / relative)
    pages = rewrite_pages(args.output, f"/{relative}/")
    if pages == 0:
        print("error: no page linked KaTeX from jsDelivr; the latex plugin changed how it loads KaTeX")
        return 1
    print(f"Self-hosted KaTeX {version} ({fonts} fonts) on {pages} pages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
