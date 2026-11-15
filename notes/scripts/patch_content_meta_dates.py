#!/usr/bin/env python3
"""Show both the created and the updated date in each note's metadata line.

Upstream ContentMeta renders a single date, chosen by `defaultDateType`. After
a site-wide edit every note would show the same date, so this patch renders
"Created <date>" from frontmatter `date`/`created` and "Updated <date>" from
frontmatter `updated`/`modified`/`lastmod`. A date that only comes from the
filesystem is not shown, since a CI checkout gives every file the same mtime.
A note whose frontmatter has neither date keeps the upstream behaviour.

The Quartz checkout is disposable and refreshed independently of this site, so
this patch deliberately fails when the upstream bundle no longer matches the
version it was written for.
"""

from __future__ import annotations

import argparse
from pathlib import Path


MARKER = "/* Notes site: created and updated dates. */"

OLD = """          const date = getDate(dataWithDefaultDateType);
          if (date) {
            segments.push(/* @__PURE__ */ u2(DateComponent, { date, locale }));
          }"""

NEW = (
    f"          {MARKER}\n"
    """          const fm = fileData.frontmatter ?? {};
          const hasCreated = fm.created != null || fm.date != null;
          const hasUpdated = fm.modified != null || fm.updated != null || fm.lastmod != null;
          const created = hasCreated ? fileData.dates.created : void 0;
          const updated = hasUpdated ? fileData.dates.modified : void 0;
          if (created) {
            segments.push(/* @__PURE__ */ u2("span", { class: "content-meta-date", children: ["Created ", /* @__PURE__ */ u2(DateComponent, { date: created, locale })] }));
          }
          if (updated && (!created || formatDate(updated, locale) !== formatDate(created, locale))) {
            segments.push(/* @__PURE__ */ u2("span", { class: "content-meta-date", children: ["Updated ", /* @__PURE__ */ u2(DateComponent, { date: updated, locale })] }));
          }
          if (!created && !updated) {
            const date = getDate(dataWithDefaultDateType);
            if (date) {
              segments.push(/* @__PURE__ */ u2(DateComponent, { date, locale }));
            }
          }"""
)


def patch(path: Path) -> None:
    source = path.read_text()
    if MARKER in source:
        if NEW not in source:
            raise SystemExit(f"content meta date patch is incomplete in {path}")
        return
    if source.count(OLD) != 1:
        raise SystemExit(f"Quartz content-meta source changed; refusing to patch {path}")
    path.write_text(source.replace(OLD, NEW))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", type=Path, nargs="+")
    args = parser.parse_args()
    for path in args.paths:
        patch(path)


if __name__ == "__main__":
    main()
