#!/bin/sh
# Builds bandwidth_bench.c, records the machine, and runs the sweep once per
# seed. Usage: ./run_bandwidth_bench.sh OUTDIR [seeds...]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:?usage: run_bandwidth_bench.sh OUTDIR [seeds...]}
shift
seeds=${*:-1 2 3}
mkdir -p "$out"

CFLAGS="-O3 -march=native -mprefer-vector-width=512 -fopenmp -fno-tree-loop-distribute-patterns -Wall -Wextra"
gcc $CFLAGS -o "$out/bandwidth_bench" "$here/bandwidth_bench.c"

{
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "kernel: $(uname -r)"
  echo "compiler: $(gcc --version | head -1)"
  echo "cflags: $CFLAGS"
  grep -m1 'model name' /proc/cpuinfo
  grep -m1 '^cpu family' /proc/cpuinfo
  grep -m1 '^model[[:space:]]' /proc/cpuinfo
  echo "nproc: $(nproc)"
  for i in /sys/devices/system/cpu/cpu0/cache/index*; do
    echo "cache L$(cat $i/level) $(cat $i/type): $(cat $i/size)"
  done
  echo "thp: $(cat /sys/kernel/mm/transparent_hugepage/enabled)"
  grep MemTotal /proc/meminfo
} > "$out/machine.txt"

for s in $seeds; do
  echo "load before seed $s: $(cut -d' ' -f1-3 /proc/loadavg)" >> "$out/machine.txt"
  OMP_PROC_BIND=close OMP_PLACES=cores "$out/bandwidth_bench" "$s" > "$out/seed$s.jsonl"
done
echo "finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$out/machine.txt"
