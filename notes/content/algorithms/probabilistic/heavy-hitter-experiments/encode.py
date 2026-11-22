"""Encodes sample.txt (written by sample.c) for the figure.

Pages are numbered by their views over the day, most viewed first, ties by the
decimal text of the key hash. stream.u16.gz holds the T records in file order as T uint16 page
numbers followed by T uint16 view counts, little-endian. meta.json holds the
counts, the first record of each hour and the 20 most viewed pages.

Usage: python3 encode.py sample.txt
"""
import gzip
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
recs = []
for line in open(sys.argv[1], encoding="utf-8"):
    hour, h, c, project, title = line.rstrip("\n").split(" ", 4)
    recs.append((int(hour), int(h), int(c), project + " " + title))
total, name = {}, {}
for _, h, c, n in recs:
    total[h] = total.get(h, 0) + c
    name[h] = n
order = sorted(total, key=lambda h: (-total[h], str(h)))
num = {h: i for i, h in enumerate(order)}
assert len(order) < 65536 and max(c for _, _, c, _ in recs) < 65536
keys = np.array([num[h] for _, h, _, _ in recs], dtype="<u2")
counts = np.array([c for _, _, c, _ in recs], dtype="<u2")
hour_start = [0] * 25
for i, (hr, _, _, _) in enumerate(recs):
    hour_start[hr + 1] = i + 1
for k in range(1, 25):
    hour_start[k] = max(hour_start[k], hour_start[k - 1])
with gzip.GzipFile(os.path.join(HERE, "stream.u16.gz"), "wb", compresslevel=9, mtime=0) as f:
    f.write(keys.tobytes() + counts.tobytes())
meta = {"records": len(recs), "keys": len(order), "views": int(sum(total.values())),
        "hourStart": hour_start, "top": [name[h] for h in order[:20]]}
json.dump(meta, open(os.path.join(HERE, "meta.json"), "w"), ensure_ascii=False, separators=(",", ":"))
