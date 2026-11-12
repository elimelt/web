#!/usr/bin/env python3
"""Give every sitemap entry a lastmod that reflects when its content changed.

Quartz writes each note's lastmod from its created date and stamps tag and
folder listings with the build time, so every deploy claims that hundreds of
unchanged pages just changed. Search engines learn to ignore a lastmod like
that. This post-build step rewrites the sitemap instead:

- a note uses its ``updated`` frontmatter date, falling back to ``date``;
- a tag page uses the newest date among the notes that carry the tag (or a
  tag nested under it);
- a folder page, the home page and ``/tags/`` use the newest date among the
  notes they list.

An entry with no known date loses its lastmod rather than keeping a wrong one.
"""

from __future__ import annotations

import argparse
import re
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlsplit

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.DOTALL)
DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
URL_RE = re.compile(r"<url>\s*<loc>([^<]*)</loc>.*?</url>", re.DOTALL)


def slug_segment(segment: str) -> str:
    """Mirror Quartz's slugifyFilePath for one path segment."""
    segment = re.sub(r"\s", "-", segment)
    segment = segment.replace("&", "-and-").replace("%", "-percent")
    segment = re.sub(r'[?#<>:"|*]', "", segment)
    return segment.lower()


def slug_tag(tag: str) -> str:
    return "/".join(slug_segment(part) for part in tag.strip().split("/")).strip("/")


def note_path(relative: Path) -> str:
    """The URL path a content file is published at."""
    parts = [slug_segment(part) for part in relative.with_suffix("").parts]
    if parts[-1] == "index":
        return "/" + "".join(f"{part}/" for part in parts[:-1])
    return "/" + "/".join(parts)


def parse_frontmatter(text: str) -> dict[str, str | list[str]]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}
    data: dict[str, str | list[str]] = {}
    key: str | None = None
    for line in match.group(1).splitlines():
        item = re.match(r"^\s+-\s+(.*)$", line)
        if item and key is not None:
            value = data.setdefault(key, [])
            if isinstance(value, list):
                value.append(item.group(1).strip().strip("\"'"))
            continue
        field = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if not field:
            continue
        key, raw = field.group(1), field.group(2).strip()
        if raw.startswith("[") and raw.endswith("]"):
            data[key] = [v.strip().strip("\"'") for v in raw[1:-1].split(",") if v.strip()]
        elif raw:
            data[key] = raw.strip("\"'")
        else:
            data[key] = []
    return data


def parse_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    match = DATE_RE.search(value)
    if not match:
        return None
    try:
        return date(*(int(group) for group in match.groups()))
    except ValueError:
        return None


def collect_notes(content_dir: Path) -> dict[str, tuple[date | None, list[str]]]:
    """Map each note's URL path to its content date and tag slugs."""
    notes: dict[str, tuple[date | None, list[str]]] = {}
    for path in sorted(content_dir.rglob("*.md")):
        relative = path.relative_to(content_dir)
        if any(part.startswith(".") for part in relative.parts):
            continue
        data = parse_frontmatter(path.read_text(encoding="utf-8", errors="ignore"))
        changed = parse_date(data.get("updated")) or parse_date(data.get("date"))
        tags = data.get("tags", [])
        tag_slugs = [slug_tag(tag) for tag in tags] if isinstance(tags, list) else [slug_tag(tags)]
        notes[note_path(relative)] = (changed, [tag for tag in tag_slugs if tag])
    return notes


def lastmod_for(path: str, notes: dict[str, tuple[date | None, list[str]]]) -> date | None:
    if path in notes and not path.endswith("/"):
        return notes[path][0]
    if path == "/tags/":
        candidates = [changed for changed, tags in notes.values() if tags]
    elif path.startswith("/tags/"):
        tag = path.removeprefix("/tags/").strip("/")
        candidates = [
            changed
            for changed, tags in notes.values()
            if any(t == tag or t.startswith(f"{tag}/") for t in tags)
        ]
    else:
        folder = path if path.endswith("/") else f"{path}/"
        candidates = [changed for note, (changed, _) in notes.items() if note.startswith(folder)]
    dates = [changed for changed in candidates if changed is not None]
    return max(dates) if dates else None


def rewrite_sitemap(xml: str, notes: dict[str, tuple[date | None, list[str]]]) -> tuple[str, int]:
    missing = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal missing
        loc = match.group(1)
        path = unquote(urlsplit(loc).path) or "/"
        changed = lastmod_for(path, notes)
        if changed is None:
            missing += 1
            return f"<url>\n    <loc>{loc}</loc>\n  </url>"
        return f"<url>\n    <loc>{loc}</loc>\n    <lastmod>{changed.isoformat()}</lastmod>\n  </url>"

    return URL_RE.sub(replace, xml), missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("output", type=Path, help="built site directory (public/)")
    parser.add_argument("content", type=Path, help="content directory Quartz built from")
    args = parser.parse_args()

    sitemap = args.output / "sitemap.xml"
    notes = collect_notes(args.content)
    xml, missing = rewrite_sitemap(sitemap.read_text(encoding="utf-8"), notes)
    sitemap.write_text(xml, encoding="utf-8")
    total = len(URL_RE.findall(xml))
    print(f"Set sitemap lastmod on {total - missing} of {total} URLs from content dates.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
