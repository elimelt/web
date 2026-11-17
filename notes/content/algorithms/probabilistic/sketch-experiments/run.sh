#!/bin/bash
# Reproduces every measurement in hyperloglog-count-min.mdx.
# Needs gcc with OpenMP, zlib, Python 3 with NumPy, about 4 GB of disk for the
# intermediate binaries and 15 GB of RAM.  Run from an empty working directory:
#   bash path/to/run.sh path/to/sketch-experiments
set -euo pipefail
SRC=${1:?directory holding these sources}
bash "$SRC/download.sh"                       # 24 hourly pageview files, about 1.1 GB
for p in prep hll hashq coll split cms cu; do gcc -O2 -fopenmp -I"$SRC" -o $p "$SRC/$p.c" -lm -lz; done
zcat pageviews-20260304-*.gz | ./prep          # stream.bin, distinct.bin, agg.bin, meta.txt
./hll 2000 > hll.log                          # HyperLogLog, 2000 trials: about 25 minutes on 4 cores
python3 "$SRC/analyze_hll.py"                 # hll_summary.json and the tables
for f in pageviews-20260304-*.gz; do echo "#H"; zcat "$f"; done | ./hashq > hashq.txt   # hash functions, hour by hour
zcat pageviews-20260304-000000.gz | ./coll    # collisions and register-load chi-square, hour 0
zcat pageviews-20260304-000000.gz | ./split   # index bits and rho bits from different hashes
./cms 8 2> cms.log                            # Count-Min and Count Sketch, 8 trials
python3 "$SRC/analyze_cms.py"
./cu 4 2> cu.log                              # conservative update, 4 trials
python3 "$SRC/analyze_cu.py"
# The Count-Min figure's data: views per page for English Wikipedia (desktop),
# hour ending 13:00 UTC, as (views, number of pages with that many views).
zcat pageviews-20260304-130000.gz | awk '$1=="en"{c[$3]++} END{for(k in c) print k, c[k]}' | sort -k1,1nr > en13_counts.txt
