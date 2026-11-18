"""Wall time of the three least-squares solvers on one core.

Run:  OPENBLAS_NUM_THREADS=1 taskset -c 3 python3 lsq_timing.py --out timing.json
"""
import argparse, json, sys, time
import numpy as np
import scipy
from scipy.linalg import cho_factor, cho_solve, lapack


def _lwork(A):
    # scipy's default workspace for dgels is the minimum, which makes LAPACK
    # fall back to unblocked Householder QR (about 3x slower at n = 400).
    m, n = A.shape
    return int(lapack.dgels_lwork(m, n, 1)[0])


def normal(A, b):
    c = cho_factor(A.T @ A, lower=False)
    return cho_solve(c, A.T @ b)


def qr(A, b):
    _, x, info = lapack.dgels(A, b[:, None], lwork=_lwork(A))
    return x[: A.shape[1], 0]


def qr_minwork(A, b):
    _, x, info = lapack.dgels(A, b[:, None])  # scipy's default lwork
    return x[: A.shape[1], 0]


def svd(A, b):
    return np.linalg.lstsq(A, b, rcond=None)[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--m", type=int, default=20000)
    ap.add_argument("--ns", default="25,50,100,200,400,800")
    ap.add_argument("--reps", type=int, default=7)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rng = np.random.default_rng(1)
    rows = []
    for n in map(int, a.ns.split(",")):
        A = np.asfortranarray(rng.standard_normal((a.m, n)))
        b = rng.standard_normal(a.m)
        for name, f in [("normal", normal), ("qr", qr), ("qr_minwork", qr_minwork), ("svd", svd)]:
            f(A, b)  # warm-up
            ts = []
            for _ in range(a.reps):
                t0 = time.perf_counter()
                f(A, b)
                ts.append(time.perf_counter() - t0)
            ts.sort()
            rows.append(dict(m=a.m, n=n, method=name, median=ts[len(ts) // 2],
                             min=ts[0], max=ts[-1]))
            print(n, name, "%.4f" % ts[len(ts) // 2], flush=True)
    meta = dict(python=sys.version.split()[0], numpy=np.__version__,
                scipy=scipy.__version__, reps=a.reps,
                cpu=open("/proc/cpuinfo").read().split("model name")[1].split("\n")[0].strip(": \t"),
                threads="OPENBLAS_NUM_THREADS=1, pinned to one core")
    json.dump(dict(meta=meta, rows=rows), open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
