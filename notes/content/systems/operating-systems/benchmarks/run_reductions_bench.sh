#!/usr/bin/env bash
# Build and run the reductions benchmark; writes reductions_bench-*.jsonl and
# reductions_bench-machine.txt in the current directory. The published files
# were produced by RUNS=5 with the sweep, scale and dispatch modes in one pass
# and the lines and latency modes in a second pass right after it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
RUNS=${RUNS:-5}
MAXBYTES=${MAXBYTES:-4294967296}   # 4 GiB, past the 260 MiB L3 of the test VM
make -C "$here" -f reductions_bench.mk -s reductions_bench
B="$here/reductions_bench"
{
  echo "date: $(date -u +%FT%TZ)"
  echo "kernel: $(uname -r)"
  echo "gcc: $(gcc --version | head -1)"
  echo "clang: $(clang --version | head -1)"
  grep -m1 'model name' /proc/cpuinfo
  grep -m1 'cpu family' /proc/cpuinfo
  grep -m1 '^model' /proc/cpuinfo
  echo "nproc: $(nproc)"
  for i in /sys/devices/system/cpu/cpu0/cache/index*; do
    echo "cache L$(cat $i/level) $(cat $i/type): $(cat $i/size)"
  done
  echo "thp: $(cat /sys/kernel/mm/transparent_hugepage/enabled)"
  grep MemTotal /proc/meminfo
} > reductions_bench-machine.txt
: > reductions_bench-sweep.jsonl; : > reductions_bench-scale.jsonl; : > reductions_bench-dispatch.jsonl
: > reductions_bench-lines.jsonl; : > reductions_bench-latency.jsonl
"$B" clock > reductions_bench-clock.jsonl
for r in $(seq 1 "$RUNS"); do
  echo "load before run $r: $(cut -d' ' -f1-3 /proc/loadavg)" >> reductions_bench-machine.txt
  "$B" sweep "$r" "$r" "$MAXBYTES" >> reductions_bench-sweep.jsonl
  "$B" scale "$r" 2147483648 >> reductions_bench-scale.jsonl
  "$B" dispatch "$r" >> reductions_bench-dispatch.jsonl
  "$B" lines "$r" 2147483648 >> reductions_bench-lines.jsonl
  if [ "$r" -le 3 ]; then "$B" latency "$r" 2147483648 >> reductions_bench-latency.jsonl; fi
done
"$B" clock >> reductions_bench-clock.jsonl
echo "finished: $(date -u +%FT%TZ)" >> reductions_bench-machine.txt
