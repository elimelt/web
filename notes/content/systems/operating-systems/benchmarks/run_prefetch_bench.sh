#!/usr/bin/env bash
# Runs the software prefetch benchmark and writes every sample to
# prefetch_bench-results.txt beside this script.
#
#   ./run_prefetch_bench.sh                 # defaults below, pinned to CPU 1
#   CPU=3 ./run_prefetch_bench.sh 4096 4000000 3
#
# Arguments: array size in MiB, gather accesses per run, and blocks per
# process. Eight processes run in the page-size order 2m 4k 4k 2m 2m 4k 4k 2m,
# each with its own seed (so its own array contents and index stream), and
# each configuration gets 4 x blocks samples per page size. The configuration
# list below is documented at the top of prefetch_bench.c.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
compiler=${CC:-gcc}
mib=${1:-4096}
accesses=${2:-4000000}
blocks=${3:-3}
cpu=${CPU:-1}
configs=g:0:0:3,g:0:1:3,g:0:2:3,g:0:4:3,g:0:8:3,g:0:16:3,g:0:32:3,g:0:64:3,g:0:128:3,g:0:256:3,g:0:512:3,g:0:1024:3,g:0:4096:3,g:4:0:3,g:4:1:3,g:4:2:3,g:4:4:3,g:4:8:3,g:4:16:3,g:4:32:3,g:4:64:3,g:4:128:3,g:4:256:3,g:4:512:3,g:4:1024:3,g:4:4096:3,g:16:0:3,g:16:1:3,g:16:2:3,g:16:4:3,g:16:8:3,g:16:16:3,g:16:32:3,g:16:64:3,g:16:128:3,g:16:256:3,g:16:512:3,g:16:1024:3,g:16:4096:3,g:64:0:3,g:64:1:3,g:64:2:3,g:64:4:3,g:64:8:3,g:64:16:3,g:64:32:3,g:64:64:3,g:64:128:3,g:64:256:3,g:64:512:3,g:64:1024:3,g:64:4096:3,g:0:4:0,g:0:4:1,g:0:4:2,g:0:8:0,g:0:8:1,g:0:8:2,g:0:16:0,g:0:16:1,g:0:16:2,g:0:32:0,g:0:32:1,g:0:32:2,g:0:64:0,g:0:64:1,g:0:64:2,g:0:128:0,g:0:128:1,g:0:128:2,g:0:256:0,g:0:256:1,g:0:256:2,g:0:512:0,g:0:512:1,g:0:512:2,g:0:1024:0,g:0:1024:1,g:0:1024:2,g:16:64:0,g:16:64:1,g:16:64:2,g:64:64:0,g:64:64:1,g:64:64:2,hot:0,hot:4,hot:16,hot:64,s:0:3,s:64:3,s:64:2,s:64:0,s:128:3,s:128:2,s:128:0,s:256:3,s:256:2,s:256:0,s:512:3,s:512:2,s:512:0,s:1024:3,s:1024:2,s:1024:0,s:2048:3,s:2048:2,s:2048:0,s:4096:3,s:4096:2,s:4096:0,s:8192:3,s:8192:2,s:8192:0,s:16384:3,s:16384:2,s:16384:0
out=${OUT:-$script_dir/prefetch_bench-results.txt}

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo "This benchmark requires Linux on x86-64." >&2
  exit 2
fi

binary=$(mktemp "${TMPDIR:-/tmp}/prefetch_bench.XXXXXX")
trap 'rm -f -- "$binary"' EXIT
flags='-O2 -std=gnu11 -Wall -Wextra'
# shellcheck disable=SC2086
"$compiler" $flags "$script_dir/prefetch_bench.c" -o "$binary"

{
  printf 'measured_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source_sha256=%s\n' "$(sha256sum "$script_dir/prefetch_bench.c" | awk '{ print $1 }')"
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
    taskset --cpu-list "$cpu" "$binary" "$mib" "$accesses" "$blocks" "$seed" "$pages" "$configs"
    seed=$((seed + 1))
  done
  printf 'loadavg_after=%s\n' "$(cut -d' ' -f1-3 /proc/loadavg)"
} | tee "$out"
