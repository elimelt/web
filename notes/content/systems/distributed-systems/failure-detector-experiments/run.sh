#!/bin/sh
# Records the heartbeat traces used in the note: for each seed, a 10-minute
# run with the allocation workload on from minute 3 to minute 7.
# Usage: sh run.sh OUTDIR
set -e
out=${1:-traces}; mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
javac -d "$out" "$here/Sender.java"
for seed in 1 2 3; do
  python3 "$here/receiver.py" 47001 "$out/run$seed.csv" 605 &
  sleep 0.5
  java -Xms2g -Xmx2g -XX:+UseParallelGC -Xlog:gc:file="$out/run$seed-gc.log" \
    -cp "$out" Sender 600 100 churn $seed 47001 400000 180 420
  wait
done
