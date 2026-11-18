#!/usr/bin/env bash
# fio sweeps for the I/O systems note. Usage: run.sh <dir-on-disk-under-test> <out-dir>
set -u
D=${1:-/home/user/fio}; OUT=${2:-/home/user/fio/res}; R=${REPS:-3}; T=${RUNTIME:-10}
mkdir -p "$OUT"
F=$D/test.dat            # 8 GiB, fully written (not fallocated) before the run
common="--filename=$F --size=8G --direct=1 --ioengine=io_uring --time_based --runtime=$T --ramp_time=1 --randseed=REP --output-format=json"
job() { # name rep args...
  local n=$1 r=$2; shift 2
  fio --name=$n ${common//REP/$r} "$@" > "$OUT/$n.r$r.json" 2>> "$OUT/err.log"
}
for r in $(seq 1 $R); do
  # A: block-size sweep at queue depth 1, sequential vs random reads
  for bs in 4k 16k 64k 256k 1m; do
    job read-bs$bs $r --rw=read --bs=$bs --iodepth=1
    job randread-bs$bs $r --rw=randread --bs=$bs --iodepth=1
  done
  # B: queue-depth sweep, 4 KiB random reads and writes
  for qd in 1 2 4 8 16 32 64 128 256; do
    job randread-qd$qd $r --rw=randread --bs=4k --iodepth=$qd
    job randwrite-qd$qd $r --rw=randwrite --bs=4k --iodepth=$qd
  done
  # C: durability. 4 KiB writes; overwrite = inside the written test file, append = fresh file
  ow="--filename=$F --size=1G --offset=4G --bs=4k --rw=write --iodepth=1 --time_based --runtime=$T --ramp_time=1 --output-format=json"
  fio --name=ow-buffered $ow --ioengine=psync > "$OUT/ow-buffered.r$r.json" 2>>"$OUT/err.log"
  fio --name=ow-direct $ow --ioengine=psync --direct=1 > "$OUT/ow-direct.r$r.json" 2>>"$OUT/err.log"
  fio --name=ow-fdatasync $ow --ioengine=psync --fdatasync=1 > "$OUT/ow-fdatasync.r$r.json" 2>>"$OUT/err.log"
  fio --name=ow-fsync $ow --ioengine=psync --fsync=1 > "$OUT/ow-fsync.r$r.json" 2>>"$OUT/err.log"
  fio --name=ow-direct-fdatasync $ow --ioengine=psync --direct=1 --fdatasync=1 > "$OUT/ow-direct-fdatasync.r$r.json" 2>>"$OUT/err.log"
  for s in fdatasync fsync; do
    rm -f $D/append.dat
    fio --name=ap-$s --filename=$D/append.dat --size=1G --fallocate=none --bs=4k --rw=write --iodepth=1 \
        --ioengine=psync --$s=1 --runtime=$T --ramp_time=1 --output-format=json > "$OUT/ap-$s.r$r.json" 2>>"$OUT/err.log"
  done
  rm -f $D/append.dat
done
# D: 60 s at queue depth 64 with a 1 s IOPS log, to look for a rate limiter's burst bucket
for rw in randread randwrite; do
  fio --name=ts-$rw ${common//REP/1} --runtime=60 --rw=$rw --bs=4k --iodepth=64 \
      --write_iops_log=$OUT/ts-$rw --log_avg_msec=1000 > "$OUT/ts-$rw.json" 2>>"$OUT/err.log"
done
echo done > "$OUT/DONE"
