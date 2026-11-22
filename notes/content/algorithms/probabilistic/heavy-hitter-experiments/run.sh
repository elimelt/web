#!/bin/sh
# Reproduces every number in the note on heavy hitters. Run it in the
# directory where the HyperLogLog and Count-Min harness (../sketch-experiments)
# left stream.bin (the 160,961,718 records as packed {64-bit key hash, 32-bit
# views} in file order) and agg.bin (each key's total views), next to the 24
# hourly pageview files it downloaded.
set -e
here=$(cd "$(dirname "$0")" && pwd)
gcc -O2 -march=native -o selftest "$here/selftest.c" -lm
gcc -O2 -march=native -fopenmp -o hh "$here/hh.c" -lm
gcc -O2 -march=native -o speed "$here/speed.c" -lm
gcc -O2 -march=native -o sample "$here/sample.c"
./selftest                                       # summaries and sketches against direct versions
for s in 1 2 3 4; do OMP_NUM_THREADS=4 ./hh 0 $s rec_$s.bin; done    # recorded order, sketch seeds 1 to 4
for s in 1 2 3 4; do OMP_NUM_THREADS=4 ./hh 1 $s shuf_$s.bin; done   # permutation and sketch seed s
python3 "$here/analyze.py" > "$here/analyze.txt" && mv summary.json "$here/"
taskset -c 3 ./speed > "$here/speed.txt"         # timing, one core, nothing else running
# The figure's substream and its reference outputs.
for f in pageviews-20260304-*.gz; do echo "#H"; zcat "$f"; done | ./sample > sample.txt
python3 "$here/encode.py" sample.txt             # stream.u16.gz and meta.json
python3 "$here/figure_ref.py"                    # figure-check.json and initial.json
