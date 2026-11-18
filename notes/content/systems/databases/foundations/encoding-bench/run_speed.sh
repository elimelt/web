#!/bin/sh
# Five fresh processes, each pinned to CPU 2, seven timed reps each.
# Usage: sh run_speed.sh pypi_files.jsonl.gz > speed.json
set -e
DATA=${1:-pypi_files.jsonl.gz}
echo "["
for i in 1 2 3 4 5; do
  taskset -c 2 python3 bench_speed.py "$DATA" 7
  [ $i -lt 5 ] && echo ","
done
echo "]"
