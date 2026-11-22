#!/bin/bash
# Downloads the 100 hits partitions one at a time, keeps the nonzero
# ResponseStartTiming values of each in parts/rst_N.npz, and deletes the
# partition. Then concatenates the parts in order into all.i32 and sites.i32.
set -e
mkdir -p dl parts
for i in $(seq 0 99); do
  f=dl/hits_$i.parquet
  [ -f parts/rst_$i.npz ] && continue
  curl -sS --retry 4 -o "$f" "https://clickhouse-public-datasets.s3.amazonaws.com/hits_compatible/athena_partitioned/hits_$i.parquet"
  python3 -I "$(dirname "$0")/extract_all.py" $i "$f"
  rm -f "$f"
done
python3 -I - <<'PY'
import numpy as np
z = [np.load(f"parts/rst_{i}.npz") for i in range(100)]
np.concatenate([p["v"] for p in z]).astype(np.int32).tofile("all.i32")
np.concatenate([p["c"] for p in z]).astype(np.int32).tofile("sites.i32")
PY
