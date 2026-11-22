"""Titles for the skip list and treap figure (components/skiplist-treap).

Usage: python3 -I make_fig9.py EN_HOUR_FILE OUTDIR
EN_HOUR_FILE holds the English Wikipedia desktop records of one hourly
pageview file (project page views bytes). Takes the articles (no namespace
prefix, not the Main Page, titles of at most 32 characters with no double
quote) with at least 20 views in that hour, draws 2,000 of
them at random, and writes OUTDIR/titles.json with the titles in sorted order
(Python string order) and the order in which the figure inserts them.
"""
import json
import sys

import numpy as np

NS = {"Special", "File", "Wikipedia", "Portal", "Category", "Template", "Help", "User", "Talk", "Draft",
      "Module", "MediaWiki", "TimedText", "Book", "Image", "WP", "Media"}
titles = []
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    f = line.split(" ")
    if len(f) < 3 or int(f[2]) < 20:
        continue
    t = f[1]
    head = t.split(":", 1)[0]
    if t in ("Main_Page", "-") or (":" in t and (head in NS or head.endswith("_talk"))):
        continue
    t = t.replace("_", " ")
    if len(t) > 32 or '"' in t:
        continue
    titles.append(t)
rng = np.random.default_rng(20261122)
pick = [titles[i] for i in rng.choice(len(titles), 2000, replace=False)]
srt = sorted(pick)
rank = {t: i for i, t in enumerate(srt)}
json.dump({"source": "en, pageviews-20260304-120000", "eligible": len(titles), "titles": srt,
           "order": [rank[t] for t in pick]}, open(f"{sys.argv[2]}/titles.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(titles), len(pick))
