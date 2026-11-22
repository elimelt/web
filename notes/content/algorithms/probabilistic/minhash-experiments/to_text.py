"""Converts each fetched row group's HTML to visible text and deletes the HTML.

For each page: parse with lxml, drop script, style, noscript, template, svg and
head elements, take the text content, collapse whitespace. Keeps pages with at
least 50 words. Writes txt/tx_N.parquet with rank, domain, text.

Usage: python3 -I to_text.py N
"""
import os
import re
import sys

import lxml.html
import pyarrow as pa
import pyarrow.parquet as pq

i = int(sys.argv[1])
t = pq.read_table(f"rg/rg_{i}.parquet").to_pylist()
ranks, domains, texts = [], [], []
WS = re.compile(r"\s+")
for row in t:
    c = row["content"]
    if not c:
        continue
    try:
        doc = lxml.html.document_fromstring(c.decode("utf-8", "replace"))
    except Exception:
        continue
    try:
        for bad in doc.xpath("//script|//style|//noscript|//template|//svg|//head"):
            bad.drop_tree()
        s = WS.sub(" ", doc.text_content()).strip()
    except ValueError:
        # Text lxml cannot hold (control characters); the page is skipped.
        continue
    if len(s.split()) < 50:
        continue
    ranks.append(row["rank"]); domains.append(row["domain"].decode("utf-8", "replace")); texts.append(s)
pq.write_table(pa.table({"rank": ranks, "domain": domains, "text": texts}), f"txt/tx_{i}.parquet", compression="zstd")
os.remove(f"rg/rg_{i}.parquet")
print(i, len(t), len(texts), flush=True)
