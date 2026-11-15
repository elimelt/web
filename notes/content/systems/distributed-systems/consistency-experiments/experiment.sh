#!/usr/bin/env bash
# The full experiment: three client configurations, three inter-member
# delays, five fresh clusters each, 100 histories per cluster. It took 19
# minutes on two pinned CPUs of a shared VM. Then:
#   gzip data/*.jsonl
#   python3 classify.py --porcupine recorder/recorder data/*.jsonl.gz > results.txt
#   python3 latency.py data/*.jsonl.gz >> results.txt
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
for delay in 10 2 0; do
  for seed in 1 2 3 4 5; do
    "$here/run.sh" linearizable "$delay" "lin-sticky-d${delay}-s${seed}" 100 "$seed"
    "$here/run.sh" serializable "$delay" "ser-sticky-d${delay}-s${seed}" 100 "$seed"
    SPREAD=1 "$here/run.sh" serializable "$delay" "ser-spread-d${delay}-s${seed}" 100 "$seed"
  done
done
