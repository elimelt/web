#!/bin/sh
# Reproduces every number in the note on skip lists and treaps. Run it in the
# directory where the HyperLogLog and Count-Min harness (../sketch-experiments)
# left distinct.bin, the 60,974,808 distinct 64-bit key hashes of the benchmark
# in order of first appearance, and the 24 hourly pageview files.
set -e
here=$(cd "$(dirname "$0")" && pwd)
g++ -O2 -march=native -o bench "$here/bench.cc"
python3 -I "$here/theory9.py" > "$here/theory.txt"            # exact expectations
./bench shape 1000000 10 0.5 > "$here/shape_1e6.txt"            # search cost, levels, treap depth
./bench shape 1000000 10 0.25 >> "$here/shape_1e6.txt"
./bench shape 10000000 3 0.5 > "$here/shape_1e7.txt"
# Timing, one core, nothing else running.
for N in 1000000 10000000; do for p in 0.5 0.25; do for o in hash sorted; do
  taskset -c 3 ./bench time $N $p $o
done; done; done > "$here/time.txt"
# The figure's 2,000 titles, from the English Wikipedia desktop records of the
# hour ending 12:00 UTC, and the reference its tests use.
mkdir -p fig
zcat pageviews-20260304-120000.gz | grep '^en ' > fig/en12.txt
python3 -I "$here/make_fig9.py" fig/en12.txt "$here"
python3 -I "$here/figure_ref.py" "$here"
