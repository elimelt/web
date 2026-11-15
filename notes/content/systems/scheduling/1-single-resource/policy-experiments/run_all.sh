#!/bin/sh
# Every configuration in the note, four at a time (about 15 minutes on 4 cores).
# usage: sh run_all.sh path/to/trace.npy results_dir
T=$1; OUT=$2; D=$(dirname "$0")
{
for rho in 0.9 0.7 0.5; do
  for p in mlfq_boost1s fifo sjf srpt ps fb mlfq mlfq16 srpt_est1 srpt_bounce1; do
    echo "--mode replay --rho $rho --seed 1 --policy $p"
    for seed in 1 2 3 4 5; do echo "--mode poisson --rho $rho --seed $seed --policy $p"; done
  done
done
} | xargs -P 4 -I{} sh -c "python3 $D/run_trace.py --trace $T --out $OUT {}"
