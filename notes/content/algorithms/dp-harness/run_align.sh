#!/bin/sh
# Timing sweep for align.c. Writes one line per run to align_runs.txt.
#   sh run_align.sh
set -e
cd "$(dirname "$0")"
gcc -O2 -o ./align.bin align.c
: > align_runs.txt
for seed in 1 2 3; do
  for n in 10000 30000; do ./align.bin full $n $seed >> align_runs.txt; done
  for n in 10000 30000 100000; do
    ./align.bin rows $n $seed >> align_runs.txt
    ./align.bin hirsch $n $seed >> align_runs.txt
  done
done
rm -f ./align.bin
