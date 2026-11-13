# Cut a window of consecutive references from the middle of each full trace,
# renumber its pages by first touch, and write it as gzipped uint16.
import gzip, json, sys, numpy as np
W = 1_000_000
out = sys.argv[1]
meta = {}
for name in ['sort200k', 'gzip9', 'bzip2', 'cc1_lopcodes']:
    full = np.fromfile(f'{name}.u32', dtype=np.uint32)
    start = len(full) // 2 - W // 2
    w = full[start:start + W]
    u, first, inv = np.unique(w, return_index=True, return_inverse=True)
    order = np.argsort(first); rank = np.empty(len(u), dtype=np.int64); rank[order] = np.arange(len(u))
    ids = rank[inv].astype(np.uint16)
    ids.astype(np.uint32).tofile(f'win_{name}.u32')
    open(f'{out}/{name}.u16.gz', 'wb').write(gzip.compress(ids.tobytes(), compresslevel=9, mtime=0))
    meta[name] = {'full_refs': int(len(full)), 'full_pages': int(full.max() + 1), 'window_start': int(start), 'window_refs': int(W), 'window_pages': int(len(u))}
    print(name, meta[name])
json.dump(meta, open('windows.json', 'w'), indent=1)
