#!/bin/sh
# Runs every measurement in the note. From this directory:
#   ./servers.sh start && ./run.sh && ./servers.sh stop && python3 analyze.py
set -e
go build -o fanout .
OUT=${OUT:-runs}
mkdir -p $OUT
for seed in 1 2 3; do
  for k in 1 4 16 64; do
    ./fanout -k $k -seed $seed -reqs 20000 -warm 2000 -out $OUT/k$k-s$seed
  done
done
./fanout -timer 115 > $OUT/timer.txt
# Hedge at the 95th percentile of per-leaf latency measured at the same
# fan-out in the runs above (all three seeds pooled).
for k in 1 16; do
  d=$(python3 analyze.py p95 $OUT $k)
  for seed in 1 2 3; do
    ./fanout -k $k -seed $seed -reqs 20000 -warm 2000 -hedge $d -out $OUT/k$k-h$d-s$seed
  done
done
