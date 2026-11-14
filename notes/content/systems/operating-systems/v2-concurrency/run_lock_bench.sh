#!/usr/bin/env bash
# Runs lock_bench for every lock and thread count, REPS times each, in an
# interleaved order so slow drift in the machine spreads over all locks.
# Usage: ./run_lock_bench.sh [millis] [reps] > lock_bench-results.csv
set -euo pipefail
cd "$(dirname "$0")"
MILLIS=${1:-1000}
REPS=${2:-5}
gcc -O2 -Wall -Wextra -pthread -o /tmp/lock_bench lock_bench.c
echo "# $(uname -sr), $(ldd --version | head -1), $(gcc --version | head -1)"
echo "# $(nproc) CPUs: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | sed 's/^ //')"
echo "rep,lock,threads,millis,total_ops,ops_per_sec,min_thread_ops,max_thread_ops,final_counter"
for rep in $(seq 1 "$REPS"); do
  for t in 1 2 3 4 6 8 12 16; do
    for lock in racy atomic tas ttas ticket mcs mutex; do
      echo "$rep,$(/tmp/lock_bench "$lock" "$t" "$MILLIS")"
    done
  done
done
