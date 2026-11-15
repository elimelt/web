#!/usr/bin/env bash
# Starts a fresh three-member etcd cluster on loopback, optionally with a
# fixed one-way delay on all traffic between members, records histories with
# the recorder, and stops the cluster.
#
#   ETCD_DIR=/path/to/etcd-v3.7.3-linux-amd64 ./run.sh READS DELAY_MS RUN HISTORIES SEED
#
#   READS       linearizable | serializable
#   DELAY_MS    one-way delay between members, in ms (0 = no proxy at all)
#   RUN         label; output goes to data/RUN.jsonl
#   SPREAD=1    give every client all three endpoints instead of one
#
# Get etcd with:
#   curl -LO https://github.com/etcd-io/etcd/releases/download/v3.7.3/etcd-v3.7.3-linux-amd64.tar.gz
#   tar xzf etcd-v3.7.3-linux-amd64.tar.gz
# Build the recorder with: (cd recorder && go build -o recorder .)
#
# Everything runs pinned to two CPUs (CPUS, default 2,3), because the machine
# is shared. Ports 23101-23303 are used, not etcd's defaults.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
reads=$1 delay=$2 run=$3 histories=$4 seed=$5
cpus=${CPUS:-2,3}
etcd="$ETCD_DIR/etcd"
work=$(mktemp -d)
mkdir -p "$here/data"
pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

cluster=""
for i in 1 2 3; do
  if [ "$delay" = "0" ]; then adv=$((23200 + i)); else adv=$((23300 + i)); fi
  cluster+="m$i=http://127.0.0.1:$adv,"
done
cluster=${cluster%,}

if [ "$delay" != "0" ]; then
  taskset -c "$cpus" python3 "$here/delayproxy.py" "$delay" 23301:23201 23302:23202 23303:23203 &
  pids+=($!)
  sleep 0.5
fi

for i in 1 2 3; do
  if [ "$delay" = "0" ]; then adv=$((23200 + i)); else adv=$((23300 + i)); fi
  taskset -c "$cpus" "$etcd" --name "m$i" --data-dir "$work/m$i" \
    --listen-client-urls "http://127.0.0.1:$((23100 + i))" \
    --advertise-client-urls "http://127.0.0.1:$((23100 + i))" \
    --listen-peer-urls "http://127.0.0.1:$((23200 + i))" \
    --initial-advertise-peer-urls "http://127.0.0.1:$adv" \
    --initial-cluster "$cluster" --initial-cluster-token "ctest-$run" \
    --initial-cluster-state new --log-level error >"$work/m$i.log" 2>&1 &
  pids+=($!)
done

eps=127.0.0.1:23101,127.0.0.1:23102,127.0.0.1:23103
for _ in $(seq 1 100); do
  if "$ETCD_DIR/etcdctl" --endpoints="$eps" endpoint health >/dev/null 2>&1; then break; fi
  sleep 0.2
done
"$ETCD_DIR/etcdctl" --endpoints="$eps" endpoint status -w table >&2

taskset -c "$cpus" "$here/recorder/recorder" record -endpoints "$eps" -reads "$reads" \
  -histories "$histories" -ops 8 -seed "$seed" -run "$run" -out "$here/data/$run.jsonl" \
  ${SPREAD:+-spread}
echo "wrote data/$run.jsonl" >&2
