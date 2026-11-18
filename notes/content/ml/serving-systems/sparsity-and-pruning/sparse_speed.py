"""Unstructured sparsity on a CPU: time y = x W with W stored dense (numpy,
OpenBLAS) and in CSR (scipy.sparse), for LLaMA-7B-sized layers, at several
sparsities and batch sizes. Weights are float32, the mask is uniform random
(the speed of a CSR product depends on the count and layout of nonzeros, not
on which weights a pruning method chose). Each timed call multiplies by
COPIES independent matrices in turn, so that the weights, like a whole
model's during decoding, do not stay in the last-level cache between uses;
the reported time is per matrix.

usage: OPENBLAS_NUM_THREADS=1 python3 sparse_speed.py OUT.json
"""
import json
import os
import platform
import sys
import time

import numpy as np
import scipy
import scipy.sparse as sp

SHAPES = [(4096, 11008)]  # [in, out]: LLaMA-7B's MLP up-projection
SPARSITY = [0.0, 0.5, 0.7, 0.8, 0.9, 0.95]
BATCH = [1, 64]
REPS = 15
COPIES = int(os.environ.get("COPIES", "6"))  # 6 x 180 MB dense, above the 480 MiB L3 of the test machine


def bench(f):
    f()
    ts = []
    for _ in range(REPS):
        t = time.perf_counter()
        f()
        ts.append(time.perf_counter() - t)
    return [float(np.median(ts)), float(np.percentile(ts, 10)), float(np.percentile(ts, 90))]


def main(out):
    rng = np.random.default_rng(0)
    rows = []
    for d_in, d_out in SHAPES:
        for s in SPARSITY:
            Ws, Wts = [], []
            for _ in range(COPIES):
                W = rng.standard_normal((d_in, d_out), dtype=np.float32)
                W[rng.random(W.shape, dtype=np.float32) < s] = 0
                Ws.append(W)
                # CSR of W^T, so that y^T = W^T x^T is a sparse-times-dense product
                Wts.append(sp.csr_matrix(W.T))
            Wt = Wts[0]
            csr_bytes = Wt.data.nbytes + Wt.indices.nbytes + Wt.indptr.nbytes
            for b in BATCH:
                x = rng.standard_normal((b, d_in), dtype=np.float32)
                assert np.allclose(x @ Ws[0], (Wt @ x.T).T, rtol=1e-3, atol=1e-2)
                dense = [t / COPIES for t in bench(lambda: [x @ W for W in Ws])]
                csr = [t / COPIES for t in bench(lambda: [(T @ x.T).T for T in Wts])]
                rows.append({"d_in": d_in, "d_out": d_out, "sparsity": s, "batch": b,
                             "dense_s": dense, "csr_s": csr, "speedup": dense[0] / csr[0],
                             "dense_bytes": Ws[0].nbytes, "csr_bytes": int(csr_bytes)})
                print(rows[-1], flush=True)
            del Ws, Wts
    env = {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__,
           "openblas_threads": os.environ.get("OPENBLAS_NUM_THREADS"), "copies": COPIES,
           "cpu": platform.processor() or platform.machine()}
    json.dump({"env": env, "rows": rows}, open(out, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
