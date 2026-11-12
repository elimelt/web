#!/usr/bin/env python3
"""Hand .mdx notes to Quartz, which only reads .md files.

Runs on the build's copy of content/. Each ``note.mdx`` becomes ``note.md``
with ``mdx: true`` added to its frontmatter, so the mdx plugin
(quartz-site/plugins/mdx) knows to turn its component tags into markup. The
published URL is the same as for a .md note at that path.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|\Z)", re.DOTALL)
MDX_KEY_RE = re.compile(r"(?m)^mdx\s*:")


def prepare(path: Path) -> Path:
    """Rename one .mdx note to .md and mark it. Returns the new path."""
    target = path.with_suffix(".md")
    if target.exists():
        raise SystemExit(f"error: {path} and {target.name} would publish at the same URL; keep one")
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER_RE.match(text)
    if not match:
        raise SystemExit(f"error: {path} needs frontmatter (at least a title)")
    if MDX_KEY_RE.search(match.group(1)):
        raise SystemExit(f"error: {path} sets mdx in its frontmatter; the build sets it")
    newline = "\r\n" if text.startswith("---\r\n") else "\n"
    target.write_text(f"---{newline}mdx: true{newline}{text[len('---') + len(newline):]}", encoding="utf-8")
    path.unlink()
    return target


def check_markdown(content_dir: Path) -> None:
    """Only .mdx notes may opt in, so a stray `mdx: true` can't change a .md note."""
    for path in content_dir.rglob("*.md"):
        match = FRONTMATTER_RE.match(path.read_text(encoding="utf-8", errors="ignore"))
        if match and MDX_KEY_RE.search(match.group(1)):
            raise SystemExit(f"error: {path} sets mdx in its frontmatter; rename it to .mdx instead")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("content_dir", type=Path)
    args = parser.parse_args()

    check_markdown(args.content_dir)
    notes = [prepare(path) for path in sorted(args.content_dir.rglob("*.mdx"))]
    if notes:
        print(f"Prepared {len(notes)} MDX note(s).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
