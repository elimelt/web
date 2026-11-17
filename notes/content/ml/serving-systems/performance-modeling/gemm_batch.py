"""Batched GEMM throughput vs batch size on the CPU, for the roofline in performance-modeling.

Y = X @ W with W of shape [K, N] (a weight matrix) and X of shape [M, K] (M tokens).
Minimum traffic is 4 * (M*K + K*N + M*N) bytes in FP32; work is 2*M*K*N FLOPs.
Run with OPENBLAS_NUM_THREADS set; prints one JSON object per line.

    OPENBLAS_NUM_THREADS=4 python3 gemm_batch.py 16384
"""
import json
import os
import sys
import time

import numpy as np

REPS = 7


def bench(M, W, rng):
    K, N = W.shape
    X = rng.standard_normal((M, K), dtype=np.float32)
    Y = np.empty((M, N), dtype=np.float32)
    np.matmul(X, W, out=Y)  # warm up
    calls = 1
    while True:  # calls per sample so a sample lasts >= ~0.2 s
        t0 = time.perf_counter()
        for _ in range(calls):
            np.matmul(X, W, out=Y)
        if time.perf_counter() - t0 > 0.2:
            break
        calls *= 2
    g = []
    for _ in range(REPS):
        t0 = time.perf_counter()
        for _ in range(calls):
            np.matmul(X, W, out=Y)
        g.append(2.0 * M * K * N * calls / (time.perf_counter() - t0) / 1e9)
    g.sort()
    ai = 2.0 * M * K * N / (4.0 * (M * K + K * N + M * N))
    return dict(kind="gemm", K=K, N=N, M=M, threads=int(os.environ.get("OPENBLAS_NUM_THREADS", "0")),
                intensity=round(ai, 4), gflops_median=round(g[REPS // 2], 2), gflops_min=round(g[0], 2),
                gflops_max=round(g[-1], 2), numpy=np.__version__)


def main():
    K = N = int(sys.argv[1])
    rng = np.random.default_rng(0)
    W = rng.standard_normal((K, N), dtype=np.float32)
    for M in [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]:
        print(json.dumps(bench(M, W, rng)), flush=True)


if __name__ == "__main__":
    main()
