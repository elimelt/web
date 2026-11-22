"""Usage: python3 -I extract_all.py N hits_N.parquet

Extracts nonzero ResponseStartTiming, with EventTime and CounterID, from one
hits partition into parts/rst_N.npz."""
import sys
import numpy as np
import pyarrow.parquet as pq
i = int(sys.argv[1])
t = pq.read_table(sys.argv[2], columns=["ResponseStartTiming", "EventTime", "CounterID"])
v = t["ResponseStartTiming"].to_numpy().astype(np.int64)
m = v > 0
np.savez(f"parts/rst_{i}.npz", v=v[m].astype(np.int32), t=t["EventTime"].to_numpy()[m].astype(np.int64), c=t["CounterID"].to_numpy()[m].astype(np.int32))
print(i, len(v), int(m.sum()), flush=True)
