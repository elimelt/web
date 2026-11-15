#!/usr/bin/env bash
# Runs the memory-level parallelism benchmark and writes every sample to
# mlp_bench-results.txt beside this script.
#
#   ./run_mlp_bench.sh                 # defaults below, pinned to CPU 1
#   CPU=3 ./run_mlp_bench.sh 4096 8000000 3
#
# Arguments: array size in MiB (a power of two), accesses per run, and blocks
# per process. Eight processes run in the page-size order 2m 4k 4k 2m 2m 4k 4k
# 2m, each with its own seed (so its own allocation and permutation), and each
# configuration gets 4 x blocks samples per page size.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
compiler=${CC:-gcc}
mib=${1:-4096}
accesses=${2:-8000000}
blocks=${3:-3}
cpu=${CPU:-1}
chains=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,20,24,28,32
out=${OUT:-$script_dir/mlp_bench-results.txt}

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo "This benchmark requires Linux on x86-64." >&2
  exit 2
fi

binary=$(mktemp "${TMPDIR:-/tmp}/mlp_bench.XXXXXX")
trap 'rm -f -- "$binary"' EXIT
flags='-O2 -std=gnu11 -Wall -Wextra'
# shellcheck disable=SC2086
"$compiler" $flags "$script_dir/mlp_bench.c" -o "$binary"

{
  printf 'measured_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source_sha256=%s\n' "$(sha256sum "$script_dir/mlp_bench.c" | awk '{ print $1 }')"
  printf 'cpu_model=%s\n' "$(awk -F': ' '/^model name/ { print $2; exit }' /proc/cpuinfo)"
  printf 'cpu_family_model_stepping=%s/%s/%s\n' \
    "$(awk -F': ' '/^cpu family/ { print $2; exit }' /proc/cpuinfo)" \
    "$(awk -F': ' '/^model\t/ { print $2; exit }' /proc/cpuinfo)" \
    "$(awk -F': ' '/^stepping/ { print $2; exit }' /proc/cpuinfo)"
  printf 'hypervisor=%s\n' "$(lscpu | awk -F': *' '/Hypervisor vendor/ { print $2 }')"
  for i in /sys/devices/system/cpu/cpu"$cpu"/cache/index*; do
    printf 'cache_L%s_%s=%s\n' "$(cat "$i/level")" "$(cat "$i/type")" "$(cat "$i/size")"
  done
  printf 'kernel=%s\n' "$(uname -srm)"
  printf 'compiler=%s\n' "$("$compiler" --version | head -n1)"
  printf 'build_flags=%s\n' "$flags"
  printf 'thp_enabled=%s\n' "$(cat /sys/kernel/mm/transparent_hugepage/enabled)"
  printf 'timer=CLOCK_MONOTONIC_RAW, one interval per run, no baseline subtraction\n'
  seed=1
  for pages in 2m 4k 4k 2m 2m 4k 4k 2m; do
    printf 'process=%s pages=%s\n' "$seed" "$pages"
    printf 'loadavg_before=%s\n' "$(cut -d' ' -f1-3 /proc/loadavg)"
    ps -eo pcpu=,psr=,comm= --sort=-pcpu | head -n 3 | sed 's/^ */top_process=/'
    taskset --cpu-list "$cpu" "$binary" "$mib" "$accesses" "$blocks" "$seed" "$pages" "$chains"
    seed=$((seed + 1))
  done
  printf 'loadavg_after=%s\n' "$(cut -d' ' -f1-3 /proc/loadavg)"
} | tee "$out"
