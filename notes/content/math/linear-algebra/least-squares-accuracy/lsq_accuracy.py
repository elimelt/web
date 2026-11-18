"""Accuracy of three least-squares solvers on matrices of prescribed condition.

For each condition number kappa, residual size tan(theta) and seed, build
A = U diag(sigma) V^T (m x n, singular values log-spaced from 1 to 1/kappa) and
b = A x + r with r orthogonal to col(A) and ||r|| = tan(theta) ||A x||. Then
solve min ||Ax - b|| in double precision by

  normal  Cholesky on A^T A x = A^T b        (scipy cho_factor / cho_solve)
  qr      Householder QR, LAPACK dgels        (scipy.linalg.lapack.dgels)
  svd     SVD, LAPACK dgelsd                  (numpy.linalg.lstsq, rcond=None)
  svd0    dgelsd with no singular values truncated (rcond=0)

and compare each with the exact solution of the *stored* A and b, computed by
Householder QR in 80-digit arithmetic (mpmath.qr_solve).

Run:  python3 lsq_accuracy.py --m 60 --n 8 --seeds 20 --out accuracy-60x8.json
"""
import argparse, json, math, os, platform, sys, time
from multiprocessing import Pool

import mpmath as mp
import numpy as np
import scipy
from scipy.linalg import cho_factor, cho_solve, LinAlgError
from scipy.linalg import lapack


def _lwork(A):
    # scipy's default workspace for dgels is the minimum, which makes LAPACK
    # fall back to unblocked Householder QR (about 3x slower at n = 400).
    m, n = A.shape
    return int(lapack.dgels_lwork(m, n, 1)[0])

TAN_THETAS = [0.0, 1e-8, 1e-4, 1.0]
LOG_KAPPAS = [k / 2 for k in range(0, 33)]  # 10^0 .. 10^16


def problem(m, n, kappa, tan_theta, seed):
    rng = np.random.default_rng(seed)
    U, _ = np.linalg.qr(rng.standard_normal((m, n)))
    V, _ = np.linalg.qr(rng.standard_normal((n, n)))
    sigma = np.logspace(0, -math.log10(kappa), n) if kappa > 1 else np.ones(n)
    A = (U * sigma) @ V.T
    c = rng.standard_normal(n)
    x = V @ (c / np.linalg.norm(c))
    z = rng.standard_normal(m)
    r = z - U @ (U.T @ z)
    r /= np.linalg.norm(r)
    Ax = A @ x
    b = Ax + tan_theta * np.linalg.norm(Ax) * r
    return A, b


def reference(A, b):
    mp.mp.dps = 80
    Am = mp.matrix(A.tolist())
    bm = mp.matrix(b.tolist())
    x, _ = mp.qr_solve(Am, bm)
    return x, Am, bm


def rel_err(xhat, xref):
    if xhat is None or not np.all(np.isfinite(xhat)):
        return None
    num = mp.norm(mp.matrix(xhat.tolist()) - xref)
    return float(num / mp.norm(xref))


def solve_all(A, b):
    out = {}
    try:
        c = cho_factor(A.T @ A, lower=False)
        out["normal"] = cho_solve(c, A.T @ b)
    except LinAlgError:
        out["normal"] = None  # Cholesky breakdown: A^T A not numerically SPD
    n = A.shape[1]
    _, xq, info = lapack.dgels(A, b[:, None], lwork=_lwork(A))
    out["qr"] = xq[:n, 0] if info == 0 else None
    out["svd"] = np.linalg.lstsq(A, b, rcond=None)[0]
    out["svd0"] = np.linalg.lstsq(A, b, rcond=0.0)[0]
    return out


def one(task):
    m, n, logk, tan_theta, seed = task
    kappa = 10.0 ** logk
    A, b = problem(m, n, kappa, tan_theta, seed)
    xref, Am, bm = reference(A, b)
    rref = bm - Am * xref
    Axref = Am * xref
    # Exact quantities of the stored problem (80 digits).
    sv = mp.svd_r(Am, compute_uv=False)
    kappa_true = float(max(sv) / min(sv))
    tan_true = float(mp.norm(rref) / mp.norm(Axref))
    eta = float(max(sv) * mp.norm(xref) / mp.norm(Axref))
    rec = dict(m=m, n=n, logk=logk, kappa=sig(kappa_true), tan_theta=tan_theta,
               tan_true=sig(tan_true), eta=sig(eta), seed=seed, err={})
    for name, xh in solve_all(A, b).items():
        rec["err"][name] = sig(rel_err(xh, xref))
    return rec


def sig(x):
    # Four significant digits are plenty for errors and keep the files small.
    return None if x is None else float(f"{x:.4g}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--m", type=int, default=60)
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--seeds", type=int, default=20)
    ap.add_argument("--procs", type=int, default=3)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    tasks = [(a.m, a.n, lk, t, s) for t in TAN_THETAS for lk in LOG_KAPPAS
             for s in range(a.seeds)]
    t0 = time.time()
    with Pool(a.procs) as p:
        recs = p.map(one, tasks, chunksize=8)
    meta = dict(python=sys.version.split()[0], numpy=np.__version__,
                scipy=scipy.__version__, mpmath=mp.__version__,
                machine=platform.machine(), processor=platform.processor(),
                cpu=open("/proc/cpuinfo").read().split("model name")[1].split("\n")[0].strip(": \t"),
                kernel=platform.release(), eps=float(np.finfo(float).eps),
                blas=np.show_config(mode="dicts")["Build Dependencies"]["lapack"],
                seconds=round(time.time() - t0, 1))
    json.dump(dict(meta=meta, records=recs), open(a.out, "w"), separators=(",", ":"))
    print("wrote", a.out, len(recs), "records in", meta["seconds"], "s")


if __name__ == "__main__":
    main()
