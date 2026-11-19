#!/bin/bash
# Reproduces every measurement in hashing-for-sketches.mdx.
# Run in the working directory of ../sketch-experiments/run.sh after it has
# finished, so that the 24 hourly pageview files, distinct.bin and agg.bin are
# present:
#   bash path/to/run.sh path/to/hashing-experiments
set -euo pipefail
SRC=${1:?directory holding these sources}
gcc -O2 -march=native -fopenmp -I"$SRC" -o fam "$SRC/fam.c" -lm
gcc -O2 -march=native -I"$SRC" -o strq "$SRC/strq.c" -lm
gcc -O2 -march=native -I"$SRC" -o speed "$SRC/speed.c" -lm -lz
gcc -O2 -march=native -I"$SRC" -o check7 "$SRC/check7.c" -lm
./fam 200 > fam.txt 2> fam.log                 # 7 families x 2 key sets x 200 trials: about 15 minutes on 4 cores
python3 "$SRC/analyze_fam.py" > fam_analysis.txt   # also writes fam_summary.json
for f in pageviews-20260304-*.gz; do echo "#H"; zcat "$f"; done | ./strq > strq.txt   # string hashes, hour by hour and the day
zcat pageviews-20260304-000000.gz | ./speed > speed.txt    # single-threaded; run with the machine otherwise idle
zcat pageviews-20260304-000000.gz | ./check7 > check7.txt
# The figure's reference cases (NumPy):
(cd "$SRC" && python3 figure_check.py)       # rewrites figure-check.json
