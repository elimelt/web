#!/bin/bash
# Scale sweep (write phases only): random-order load of N keys, then U random
# overwrites, batch 1000. Keeps seed 1's database for the read runs.
# Usage: run_scale.sh BIN ENGINE OUTDIR "N1 N2 ..." SEEDS
mkdir -p ${DBS:-./dbs}; BIN=$1; ENG=$2; OUT=$3; NS=$4; SEEDS=${5:-"1 2 3"}
for n in $NS; do for seed in $SEEDS; do
  u=$n; [ $n -gt 4000000 ] && u=4000000
  d=${DBS:-./dbs}/$ENG-$n-s$seed; rm -rf $d
  $BIN --engine $ENG --dir $d --n $n --updates $u --reads 0 --seed $seed > $OUT/$ENG-n$n-s$seed.json 2>>$OUT/$ENG.log
  [ $seed != 1 ] && rm -rf $d
  [ $n -ge 16000000 ] && [ $seed == 1 ] && [ $ENG == rocksdb ] && [ $n -gt 16000000 ] && rm -rf $d
done; done
echo DONE >> $OUT/$ENG.log
