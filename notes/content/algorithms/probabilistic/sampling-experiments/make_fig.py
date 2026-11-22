"""Builds the stream-sampling figure's data from figsample.txt.

Usage: python3 -I make_fig.py figsample.txt projects.tsv OUTDIR
Writes OUTDIR/records.bin.gz (per record, little-endian: u16 project index
into meta.json's names, u8 hour, u16 views) and OUTDIR/meta.json.
"""
import gzip
import json
import struct
import sys

recs = [tuple(map(int, l.split())) for l in open(sys.argv[1]) if l.strip()]
names = {}
for l in open(sys.argv[2]):
    f = l.rstrip("\n").split("\t")
    names[int(f[0])] = f[1]
ids = sorted({p for p, _, _ in recs})
idx = {p: i for i, p in enumerate(ids)}
assert len(ids) < 65536 and max(v for _, _, v in recs) < 65536
buf = b"".join(struct.pack("<HBH", idx[p], h, v) for p, h, v in recs)
open(f"{sys.argv[3]}/records.bin.gz", "wb").write(gzip.compress(buf, 9, mtime=0))
meta = {"records": len(recs), "views": sum(v for _, _, v in recs), "names": [names[p] for p in ids],
        "fullRecords": 160961718, "fullViews": 445961446}
json.dump(meta, open(f"{sys.argv[3]}/meta.json", "w"))
print(meta["records"], meta["views"], len(ids))
