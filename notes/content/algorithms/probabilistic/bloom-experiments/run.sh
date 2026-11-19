#!/bin/sh
# Reproduces every number in the Bloom filter note. Run it in the directory
# where the HyperLogLog and Count-Min harness (../sketch-experiments) left
# distinct.bin, the 60,974,808 distinct 64-bit key hashes of the benchmark in
# order of first appearance; the first 5,843,219 are the keys of hour 0.
set -e
here=$(cd "$(dirname "$0")" && pwd)
gcc -O2 -march=native -fopenmp -o bloom "$here/bloom.c" -lm
gcc -O2 -march=native -o speed "$here/speed.c"
gcc -O2 -o ldb_probe3 "$here/ldb_probe3.c"
OMP_NUM_THREADS=4 ./bloom B 5 > "$here/B.txt"   # layouts at k = round(b ln 2), all negatives (~10 min)
OMP_NUM_THREADS=4 ./bloom A 5 > "$here/A.txt"   # standard filter, b x k grid (~10 min)
OMP_NUM_THREADS=4 ./bloom C 10 > "$here/C.txt"  # counting filter
OMP_NUM_THREADS=4 ./bloom D 3 > "$here/D.txt"   # k sweep of the blocked layouts
taskset -c 1 ./speed 12 28 3 > "$here/speed.txt"   # timing, one core, nothing else running (~35 min)
./ldb_probe3 > "$here/ldb_probe3.txt"           # exhaustive over 2^32 (~4 min)
python3 "$here/analyze.py"
python3 "$here/figure_ref.py"
