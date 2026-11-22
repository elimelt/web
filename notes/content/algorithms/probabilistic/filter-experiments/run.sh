#!/bin/sh
# Reproduces every number in the note on cuckoo, quotient, xor and ribbon
# filters. Run it in the directory where the HyperLogLog and Count-Min harness
# (../sketch-experiments) left distinct.bin, the 60,974,808 distinct 64-bit key
# hashes of the benchmark in order of first appearance; the first 5,843,219 are
# the keys of hour 0.
set -e
here=$(cd "$(dirname "$0")" && pwd)
gcc -O2 -march=native -o selftest "$here/selftest.c" -lm
gcc -O2 -march=native -fopenmp -o exp "$here/exp.c" -lm
gcc -O2 -march=native -o speed "$here/speed.c" -lm
./selftest                                # no false negatives; rates against theory
OMP_NUM_THREADS=4 ./exp F 3 > "$here/F.txt"     # space and false-positive rate
OMP_NUM_THREADS=4 ./exp G 3 > "$here/G.txt"     # ribbon filters at full scale
OMP_NUM_THREADS=4 ./exp L 10 > "$here/L.txt"    # cuckoo load at the first failed insertion
OMP_NUM_THREADS=4 ./exp Q 5 > "$here/Q.txt"     # quotient filter probes and clusters
OMP_NUM_THREADS=4 ./exp X > "$here/X.txt"       # xor and binary fuse construction success
OMP_NUM_THREADS=4 ./exp R > "$here/R.txt"       # ribbon construction success
OMP_NUM_THREADS=4 ./exp J 400 > "$here/J.txt"   # the figure's six layouts at 4096 slots
taskset -c 3 ./speed 3 > "$here/speed.txt"      # timing, one core, nothing else running
(cd "$here" && python3 analyze.py > analyze.txt)   # writes summary.json
python3 "$here/figure_ref.py" > "$here/figure-check.json"
