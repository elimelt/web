#!/bin/sh
# Reproduces summary.json, lattice.json and figure-trace.json.
# Takes about four minutes on a 4-vCPU VM; runs write to ./runs/ (not committed).
set -e
here=$(dirname "$0")
mkdir -p runs
for r in 100 1000 10000 0; do
  for s in 1 2 3; do
    python3 "$here/snapshot_bench.py" --procs 4 --rate $r --duration 4 --snapshots 50 --seed $s --out runs/r$r-s$s.json
  done
done
python3 "$here/analyze.py" runs/r*.json > "$here/summary.json"
python3 "$here/analyze.py" --lattice --window 25 runs/r100-s*.json runs/r1000-s*.json > "$here/lattice.json"
# The figure's window. Timing differs on every run, so the window will too:
# pick a snapshot whose uncoordinated cut is inconsistent (the entries of
# analyze.analyze(run)["naive"] with consistent false) and pass its id. The committed trace used seed 3, snapshot 36.
python3 "$here/snapshot_bench.py" --procs 3 --rate 3000 --duration 4 --snapshots 150 --seed 3 --out runs/fig-s3.json
python3 "$here/figure_trace.py" runs/fig-s3.json 36 6 8 > "$here/figure-trace.json"
