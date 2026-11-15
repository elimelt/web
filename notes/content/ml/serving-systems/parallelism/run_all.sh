#!/bin/sh
# Runs every measurement for the note; from notes/: sh content/ml/serving-systems/parallelism/run_all.sh
set -e
D=content/ml/serving-systems/parallelism
export OMP_NUM_THREADS=1
python3 -m torch.distributed.run --nproc_per_node 4 $D/collective_bytes.py
for seed in 1 2 3; do
  for s in dp zero1 zero2 zero3; do
    python3 -m torch.distributed.run --nproc_per_node 4 $D/zero_measure.py --strategy $s --seed $seed
  done
done
python3 $D/zero_summarize.py
