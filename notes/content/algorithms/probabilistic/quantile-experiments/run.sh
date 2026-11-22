#!/bin/bash
# Run from a directory holding all.i32 and sites.i32 (from fetch_all.sh).
set -e
H="$(dirname "$0")"
gcc -O2 -o gk "$H/gk.c" -lm
gcc -O2 -o tdigest "$H/tdigest.c" -lm
python3 -I "$H/quant.py" . 10
python3 -I "$H/tables.py" quant.json > tables.txt
