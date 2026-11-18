#!/usr/bin/env bash
# Follow-up runs: parallel submitters, guest page-cache reads, and the memory-latency ladder.
set -u
D=${1:-/home/user/fio}; OUT=${2:-/home/user/fio/res2}; mkdir -p "$OUT"
F=$D/test.dat
for r in 1 2 3; do
  for nj in 1 2 4; do
    fio --name=par-nj$nj --filename=$F --size=8G --direct=1 --ioengine=io_uring --rw=randread --bs=4k \
        --iodepth=64 --numjobs=$nj --group_reporting --time_based --runtime=10 --ramp_time=1 --randseed=$r \
        --output-format=json > "$OUT/par-nj$nj.r$r.json" 2>>"$OUT/err.log"
  done
done
# 4 KiB reads served by the guest page cache: read a 1 GiB region once, then read it again buffered.
fio --name=warm --filename=$F --size=1G --rw=read --bs=1m --ioengine=psync --invalidate=0 --output-format=json > /dev/null 2>>"$OUT/err.log"
for r in 1 2 3; do
  fio --name=pagecache --filename=$F --size=1G --rw=randread --bs=4k --ioengine=psync --invalidate=0 \
      --time_based --runtime=10 --ramp_time=1 --randseed=$r --output-format=json > "$OUT/pagecache.r$r.json" 2>>"$OUT/err.log"
done
"$D/h/chase" > "$OUT/chase.txt"
echo done > "$OUT/DONE"
