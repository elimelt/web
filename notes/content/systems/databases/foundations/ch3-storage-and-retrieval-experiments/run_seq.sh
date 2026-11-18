#!/bin/bash
# Ascending-order load of N keys (no updates, no reads), one seed.
# Usage: run_seq.sh BIN ENGINE OUTDIR [N]
BIN=$1; ENG=$2; OUT=$3; N=${4:-4000000}; D=${DBS:-./dbs}/seq-$ENG
mkdir -p "$OUT" "${DBS:-./dbs}"; rm -rf "$D"
$BIN --engine $ENG --dir "$D" --n $N --updates 0 --reads 0 --seed 1 --order seq > "$OUT/$ENG-n$N.json" 2>>"$OUT/seq.log"
rm -rf "$D"
