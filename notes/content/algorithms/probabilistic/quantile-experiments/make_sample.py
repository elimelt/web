"""Writes the figure's sample: 100,000 values drawn uniformly without
replacement from all.i32 (the response-start timings in partition order),
kept in that order, as little-endian uint16 in stream.u16.gz.

Usage: python3 make_sample.py all.i32
"""
import gzip
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
x = np.fromfile(sys.argv[1], dtype=np.int32)
rng = np.random.default_rng(20261122)
idx = np.sort(rng.choice(len(x), size=100_000, replace=False))
s = x[idx]
assert s.min() >= 1 and s.max() < 65536
with gzip.GzipFile(os.path.join(HERE, "stream.u16.gz"), "wb", compresslevel=9, mtime=0) as f:
    f.write(s.astype("<u2").tobytes())
json.dump({"records": int(len(s)), "population": int(len(x)), "max": int(s.max()),
           "atMax": int((s == s.max()).sum())}, open(os.path.join(HERE, "meta.json"), "w"), separators=(",", ":"))
