#!/bin/bash
# Batch-size sweep: preload N keys in large batches, then U random overwrites
# grouped B per transaction / WriteBatch. Usage: run_batch.sh BIN ENGINE OUTDIR
mkdir -p ${DBS:-./dbs}; BIN=$1; ENG=$2; OUT=$3; N=${N:-1000000}; U=${U:-200000}
for seed in 1 2 3; do for b in 1 10 100 1000 10000 100000; do
  rm -rf ${DBS:-./dbs}/b-$ENG
  $BIN --engine $ENG --dir ${DBS:-./dbs}/b-$ENG --n $N --load-batch 100000 --updates $U --batch $b --reads 0 --seed $seed > $OUT/$ENG-b$b-s$seed.json 2>>$OUT/$ENG.log
done; done
rm -rf ${DBS:-./dbs}/b-$ENG
