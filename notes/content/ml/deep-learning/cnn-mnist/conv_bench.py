"""Time three ways to compute the same convolution layer in NumPy.

Backs the "How convolution is computed" section of the "Convolutional Neural
Networks" note. The layer is conv2 of the note's MNIST network: a batch of
128 images, 8 input channels at 14x14, 16 filters of 5x5, same padding.

1. loops: the note's teaching version, one dot product per output pixel.
2. im2col: copy every 5x5x8 patch into a row of a matrix, then do one matrix
   multiply (Chellapilla et al. 2006).
3. fft: multiply in the frequency domain (Mathieu et al. 2013).

All three must agree before anything is timed. Run from notes/:

    python3 content/ml/deep-learning/cnn-mnist/conv_bench.py
"""

from __future__ import annotations

import json
import os
import platform
import statistics
import time
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

HERE = Path(__file__).resolve().parent
N, C, H, O, K = 128, 8, 14, 16, 5
P = K // 2


def loops(x, w):
    xp = np.pad(x, ((0, 0), (0, 0), (P, P), (P, P)))
    out = np.zeros((N, O, H, H), dtype=x.dtype)
    for n in range(N):
        for o in range(O):
            for i in range(H):
                for j in range(H):
                    out[n, o, i, j] = np.sum(xp[n, :, i : i + K, j : j + K] * w[o])
    return out


def im2col(x, w):
    xp = np.pad(x, ((0, 0), (0, 0), (P, P), (P, P)))
    cols = sliding_window_view(xp, (K, K), axis=(2, 3)).transpose(0, 2, 3, 1, 4, 5).reshape(N * H * H, C * K * K)
    return (cols @ w.reshape(O, -1).T).reshape(N, H, H, O).transpose(0, 3, 1, 2)


def fft(x, w):
    # Correlation is convolution with a flipped kernel. Zero-pad both to the
    # full linear size so the circular product equals the linear one.
    size = H + K - 1
    fx = np.fft.rfft2(x, s=(size, size))  # N, C, f, f
    fw = np.fft.rfft2(w[:, :, ::-1, ::-1], s=(size, size))  # O, C, f, f
    full = np.fft.irfft2(np.einsum("ncij,ocij->noij", fx, fw), s=(size, size))
    return full[:, :, P : P + H, P : P + H].astype(x.dtype)


def timed(fn, x, w, repeats):
    times = []
    for _ in range(repeats):
        start = time.perf_counter()
        fn(x, w)
        times.append(time.perf_counter() - start)
    return times


def main() -> None:
    rng = np.random.default_rng(0)
    x = rng.random((N, C, H, H), dtype=np.float32)
    w = rng.standard_normal((O, C, K, K), dtype=np.float32)
    reference = loops(x, w)
    for fn in (im2col, fft):
        assert np.allclose(fn(x, w), reference, atol=1e-3), fn.__name__

    macs = N * O * H * H * C * K * K
    results = {}
    for fn, repeats in ((loops, 3), (im2col, 31), (fft, 31)):
        fn(x, w)  # warm up
        times = timed(fn, x, w, repeats)
        seconds = statistics.median(times)
        results[fn.__name__] = {
            "median_ms": round(seconds * 1000, 2),
            "min_ms": round(min(times) * 1000, 2),
            "max_ms": round(max(times) * 1000, 2),
            "repeats": repeats,
            "gmacs_per_s": round(macs / seconds / 1e9, 3),
        }
        print(f"{fn.__name__:7s} {seconds * 1000:10.2f} ms  ({results[fn.__name__]['gmacs_per_s']} GMAC/s)")

    record = {
        "environment": {
            "cpu": next((l.split(":", 1)[1].strip() for l in Path("/proc/cpuinfo").read_text().splitlines() if l.startswith("model name")), platform.processor()),
            "cores": os.cpu_count(),
            "python": platform.python_version(),
            "numpy": np.__version__,
        },
        "layer": f"batch {N}, {C}->{O} channels, {H}x{H}, {K}x{K} kernel, same padding, float32",
        "macs": macs,
        "method": "wall-clock of repeated calls after one warm-up call (median, min, max); outputs checked against the loop version first; single process on an otherwise idle machine",
        "results": results,
    }
    out = HERE / "conv_bench_results.json"
    out.write_text(json.dumps(record, indent=2) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
