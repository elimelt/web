import sys, numpy as np
a = np.fromfile(sys.argv[1], dtype=np.uint64)
u, first_idx, inv = np.unique(a, return_index=True, return_inverse=True)
order = np.argsort(first_idx); rank = np.empty(len(u), dtype=np.int64); rank[order] = np.arange(len(u))
rank[inv].astype(np.uint32).tofile(sys.argv[2])
# keep the real page addresses in first-touch order, to label regions later
np.save(sys.argv[2].replace('.u32', '.addrs.npy'), u[order])
