#!/bin/bash
# Reproduces results/*.jsonl and roofline-summary.json for performance-modeling.mdx.
# Needs gcc with OpenMP, Python 3 with NumPy, an x86-64 CPU with AVX-512, and ~3 GB of free memory.
# Takes about 15 minutes on a four-core VM. Run nothing else meanwhile.
set -euo pipefail
cd "$(dirname "$0")"
B=$(mktemp -d)
gcc -O3 -march=native -fopenmp roofline.c -o "$B/roofline"
gcc -O3 -march=native -fopenmp skinny.c -o "$B/skinny" -lm
"$B/skinny" check
mkdir -p results
rm -f results/*.jsonl
export OMP_PROC_BIND=close
for t in 4 1; do OMP_NUM_THREADS=$t "$B/roofline" peak >> results/peak.jsonl; done
for t in 4 1; do
  # L1 and L2 sizes are per thread; the L3 and DRAM working sets are totals.
  for b in $((32*1024*t)) $((1024*1024*t)) $((64*1024*1024)) $((2*1024*1024*1024)); do
    OMP_NUM_THREADS=$t "$B/roofline" sweep $b >> results/sweep.jsonl
    OMP_NUM_THREADS=$t "$B/roofline" read $b >> results/read.jsonl
  done
done
for t in 4 1; do for k in 16384 4096; do
  OPENBLAS_NUM_THREADS=$t python3 gemm_batch.py $k >> results/gemm.jsonl
  OMP_NUM_THREADS=$t "$B/skinny" $k >> results/skinny.jsonl
done; done
python3 summarize.py
