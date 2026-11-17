import os, numpy as np, tensorstore as ts
def load(d, expert_dtype=np.float32):
    """Reads a T5X checkpoint directory (one zarr array per parameter).
    expert_dtype=np.float16 halves the memory of the expert weights; the
    router logits saved for the note were computed with float32."""
    out = {}
    for name in sorted(os.listdir(d)):
        p = os.path.join(d, name)
        if not os.path.isdir(p): continue
        spec = {'driver': 'zarr', 'kvstore': {'driver': 'file', 'path': p}}
        a = ts.open(spec).result().read().result()
        out[name.replace('target.', '')] = np.asarray(a, dtype=expert_dtype if '.expert.' in name else np.float32)
        del a
    return out
