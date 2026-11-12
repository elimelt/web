#!/usr/bin/env python3
"""Turn old note and tag URLs into Cloudflare Pages 301 redirects.

Quartz's alias-redirects plugin writes a small HTML page for every frontmatter
alias. Each page carries a meta refresh and ``noindex``, so search engines
report the old URL as an excluded page instead of following a redirect. This
script replaces those pages with real 301s in ``_redirects`` and removes them.

It also redirects URLs that the older, pre-Quartz site published and that no
longer serve a page: tag pages such as ``/tags/graph theory.html``, and note
pages such as ``/networks/3-network/ARP.html`` whose current path differs only
in case from an alias or page.

Cloudflare Pages applies ``_redirects`` before it serves a matching file, so a
source that is also a real page would hide that page; such sources are skipped.
"""

from __future__ import annotations

import argparse
import posixpath
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

# Cloudflare Pages accepts at most 2,000 static redirects per project.
MAX_STATIC_REDIRECTS = 2000
SAFE_PATH_CHARS = "/-_.~!$&'()*+,;=:@"


class RefreshParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.refresh: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "meta" and (values.get("http-equiv") or "").lower() == "refresh":
            self.refresh = values.get("content")


def slug_tag(tag: str) -> str:
    """Mirror Quartz's slugTag: per path segment, whitespace to '-', lowercase."""
    segments = []
    for segment in tag.split("/"):
        segment = re.sub(r"\s", "-", segment)
        segment = segment.replace("&", "-and-").replace("%", "-percent")
        segment = re.sub(r'[?#<>:"|*]', "", segment)
        segments.append(segment.lower())
    return "/".join(segments).rstrip("/")


def url_path(output_root: Path, html_path: Path) -> str:
    """The extensionless URL path Cloudflare Pages serves a file at."""
    relative = html_path.relative_to(output_root).as_posix()
    if relative == "index.html":
        return "/"
    if relative.endswith("/index.html"):
        return "/" + relative.removesuffix("index.html")
    return "/" + relative.removesuffix(".html")


def encode(path: str) -> str:
    return quote(path, safe=SAFE_PATH_CHARS)


def page_exists(output_root: Path, path: str) -> bool:
    relative = unquote(path).strip("/")
    if not relative:
        return (output_root / "index.html").is_file()
    candidates = [f"{relative}.html", f"{relative}/index.html"]
    if relative.endswith(".html"):
        candidates.append(relative)
    return any((output_root / candidate).is_file() for candidate in candidates)


def alias_target(output_root: Path, html_path: Path) -> str | None:
    parser = RefreshParser()
    parser.feed(html_path.read_text(encoding="utf-8", errors="ignore"))
    if not parser.refresh:
        return None
    match = re.search(r"url=(.+)$", parser.refresh, re.IGNORECASE)
    if not match:
        return None
    target = match.group(1).strip().strip("'\"")
    parts = urlsplit(target)
    if parts.scheme or parts.netloc:
        path = parts.path or "/"
    else:
        base = posixpath.dirname(url_path(output_root, html_path).rstrip("/") or "/")
        path = posixpath.normpath(posixpath.join(base, unquote(parts.path)))
        if parts.path.endswith("/") and not path.endswith("/"):
            path += "/"
    return encode(unquote(path)) + (f"#{parts.fragment}" if parts.fragment else "")


def alias_sources(output_root: Path, html_path: Path) -> list[str]:
    path = url_path(output_root, html_path)
    if path.endswith("/"):
        return [path, path.rstrip("/"), f"{path}index.html"]
    return [path, f"{path}.html"]


def legacy_page_paths(legacy_site: Path) -> list[str]:
    """Note URLs of the old generated site mirrored in docs/ (tags handled separately)."""
    paths = []
    for html_path in sorted(legacy_site.rglob("*.html")):
        relative = html_path.relative_to(legacy_site).as_posix()
        if relative == "index.html" or relative.startswith(("tags/", "categories/")):
            continue
        paths.append("/" + relative)
    return paths


def build_redirects(
    output_root: Path, legacy_tags: list[str], legacy_pages: list[str] | tuple[str, ...] = ()
) -> tuple[list[tuple[str, str]], list[Path]]:
    redirects: dict[str, str] = {}
    stubs: list[Path] = []

    for html_path in sorted(output_root.rglob("*.html")):
        text = html_path.read_text(encoding="utf-8", errors="ignore")
        if 'http-equiv="refresh"' not in text or 'name="robots" content="noindex"' not in text:
            continue
        target = alias_target(output_root, html_path)
        if target is None:
            continue
        stubs.append(html_path)
        for source in alias_sources(output_root, html_path):
            redirects.setdefault(encode(source), target)

    for tag in legacy_tags:
        # Old tag URLs that still name a page need nothing: Pages serves them.
        if page_exists(output_root, f"/tags/{tag}"):
            continue
        slug = slug_tag(tag)
        target = f"/tags/{encode(slug)}" if page_exists(output_root, f"/tags/{slug}") else "/tags/"
        sources = [f"/tags/{tag}.html"]
        if tag != slug:
            # The old site's pages were also reachable without .html.
            sources.append(f"/tags/{tag}")
        for source in sources:
            redirects.setdefault(encode(source), target)

    # Old note URLs that differ from a current alias or page only in case.
    by_lowercase = {unquote(source).lower(): target for source, target in redirects.items()}
    stub_set = set(stubs)
    for html_path in output_root.rglob("*.html"):
        relative = html_path.relative_to(output_root).as_posix()
        if html_path not in stub_set and not relative.startswith("docs/"):
            path = url_path(output_root, html_path)
            by_lowercase.setdefault(path.lower(), encode(path))
    for old in legacy_pages:
        stem = old.removesuffix(".html")
        if page_exists(output_root, stem) or encode(old) in redirects:
            continue
        target = by_lowercase.get(stem.lower()) or by_lowercase.get(old.lower())
        if target is None:
            continue
        for source in (old, stem):
            redirects.setdefault(encode(source), target)

    kept: list[tuple[str, str]] = []
    for source, target in redirects.items():
        if source == target.split("#")[0]:
            continue
        # Never hide a real page behind a redirect. Alias stubs are removed below,
        # so they do not count as pages.
        relative = unquote(source).strip("/")
        shadowed = [
            output_root / f"{relative}.html",
            output_root / relative / "index.html",
            output_root / relative,
        ]
        if any(path.is_file() and path not in stub_set for path in shadowed if relative):
            continue
        kept.append((source, target))
    return kept, stubs


def read_legacy_tags(path: Path) -> list[str]:
    tags = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            tags.append(line)
    return tags


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("output", type=Path, help="built site directory (public/)")
    parser.add_argument("--legacy-tags", type=Path, required=True)
    parser.add_argument("--legacy-site", type=Path, help="old generated site (docs/)")
    args = parser.parse_args()

    legacy_pages = legacy_page_paths(args.legacy_site) if args.legacy_site else []
    redirects, stubs = build_redirects(
        args.output, read_legacy_tags(args.legacy_tags), legacy_pages
    )
    redirects_file = args.output / "_redirects"
    existing = redirects_file.read_text(encoding="utf-8") if redirects_file.exists() else ""
    existing_count = sum(1 for line in existing.splitlines() if line.strip() and not line.startswith("#"))
    if existing_count + len(redirects) > MAX_STATIC_REDIRECTS:
        print(
            f"error: {existing_count + len(redirects)} redirects exceed Cloudflare Pages' "
            f"limit of {MAX_STATIC_REDIRECTS}"
        )
        return 1

    lines = [existing.rstrip("\n")] if existing.strip() else []
    lines.append("# Generated by scripts/write_redirects.py: old note aliases and tag URLs.")
    lines.extend(f"{source} {target} 301" for source, target in redirects)
    redirects_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for stub in stubs:
        stub.unlink()
    print(f"Wrote {len(redirects)} redirects and removed {len(stubs)} alias pages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
