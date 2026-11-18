#!/bin/bash
# Point reads on the seed-1 databases that run_scale.sh kept: 200,000 gets of
# present keys, then 200,000 of absent keys, in a fresh process each time (so the
# engine's 32 MiB cache starts empty). One discarded pass warms the OS page
# cache, then REPS measured passes; with COLD=1 (needs root) one more pass runs
# after dropping the page cache.
# Usage: run_reads.sh BIN ENGINE OUTDIR "N1 N2 ..."
BIN=$1; ENG=$2; OUT=$3; NS=$4; REPS=${REPS:-3}; R=${R:-200000}
mkdir -p "$OUT"
for n in $NS; do
  d=${DBS:-./dbs}/$ENG-$n-s1
  [ -d "$d" ] || { echo "missing $d" >&2; continue; }
  $BIN --engine $ENG --dir "$d" --n $n --reads $R --seed 1 --reads-only 1 > /dev/null 2>>"$OUT/$ENG.log"
  for rep in $(seq 1 $REPS); do
    $BIN --engine $ENG --dir "$d" --n $n --reads $R --seed 1 --reads-only 1 > "$OUT/$ENG-n$n-r$rep.json" 2>>"$OUT/$ENG.log"
  done
  if [ "${COLD:-0}" = 1 ]; then
    sync; echo 3 > /proc/sys/vm/drop_caches
    $BIN --engine $ENG --dir "$d" --n $n --reads $R --seed 1 --reads-only 1 2>>"$OUT/$ENG.log" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); d["cold"]=1; print(json.dumps(d))' > "$OUT/$ENG-n$n-cold.json"
  fi
done
