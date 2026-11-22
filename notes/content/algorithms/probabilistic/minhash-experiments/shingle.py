"""Word 5-shingles of each page's text, hashed to 64 bits.

Tokens are maximal runs of Unicode word characters, lowercased. A page's set
is the distinct 64-bit hashes (first 8 bytes of BLAKE2b) of its 5-token
windows. Pages with fewer than 50 distinct shingles are dropped; pages whose
domain appears twice keep the first.

Usage: python3 -I shingle.py OUTDIR TXT_FILES...
Writes OUTDIR/sets.u64 (each set sorted), OUTDIR/offsets.i64 (n+1 offsets),
OUTDIR/docs.tsv (index, rank, domain, words).
"""
import hashlib
import re
import sys

import numpy as np
import pyarrow.parquet as pq

W = 5
TOK = re.compile(r"\w+")
out = sys.argv[1]
seen = set()
sets, rows = [], []
for path in sys.argv[2:]:
    for r in pq.read_table(path).to_pylist():
        if r["domain"] in seen:
            continue
        toks = TOK.findall(r["text"].lower())
        hs = {int.from_bytes(hashlib.blake2b(" ".join(toks[i:i + W]).encode(), digest_size=8).digest(), "little")
              for i in range(len(toks) - W + 1)}
        if len(hs) < 50:
            continue
        seen.add(r["domain"])
        sets.append(np.array(sorted(hs), dtype=np.uint64))
        rows.append((len(rows), r["rank"], r["domain"], len(toks)))
off = np.zeros(len(sets) + 1, dtype=np.int64)
off[1:] = np.cumsum([len(s) for s in sets])
np.concatenate(sets).tofile(f"{out}/sets.u64")
off.tofile(f"{out}/offsets.i64")
with open(f"{out}/docs.tsv", "w") as f:
    for row in rows:
        f.write("\t".join(map(str, row)) + "\n")
print(len(sets), int(off[-1]))
