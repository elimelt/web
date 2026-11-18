"""One-shot pruning of every linear layer of a T5 v1.1 checkpoint.

Weights are stored [in, out] (x @ W). Masks are boolean arrays of the same
shape, True = keep. The token embedding and the output head are never pruned,
matching the Wanda and SparseGPT setups, which prune only the linear layers
inside transformer blocks.

Scores and comparison groups
  magnitude   |W_ij|
  wanda       |W_ij| * ||X_i||_2   (X_i: input feature i over calibration tokens)
  sparsegpt   OBS saliency w^2 / [H^-1]_ii^2 with the remaining weights of the
              row updated to compensate (Frantar & Alistarh 2023)

  group "layer"  : the lowest-scoring fraction of the whole matrix is removed
  group "output" : the lowest-scoring fraction of each output's inputs is removed
  pattern "n:m"  : in every run of m consecutive inputs of one output, keep n
                   (the layout of NVIDIA's 2:4 sparse tensor cores, where the
                   groups run along the reduction dimension)
"""
from __future__ import annotations

import numpy as np


def _parse(sparsity):
    """'0.5' -> (0.5, None); '2:4' -> (0.5, (2, 4))."""
    if isinstance(sparsity, str) and ":" in sparsity:
        n, m = (int(v) for v in sparsity.split(":"))
        return 1 - n / m, (n, m)
    return float(sparsity), None


def mask_from_score(S, sparsity, group="output"):
    """S: [in, out] scores, higher = more important."""
    s, nm = _parse(sparsity)
    n_in, n_out = S.shape
    if nm is not None:
        n, m = nm
        Sg = S.reshape(n_in // m, m, n_out)
        # rank within each group of m inputs; drop the m - n smallest
        order = np.argsort(Sg, axis=1, kind="stable")
        keep = np.zeros_like(Sg, dtype=bool)
        np.put_along_axis(keep, order[:, m - n :, :], True, axis=1)
        return keep.reshape(n_in, n_out)
    if group == "layer":
        k = int(S.size * s)
        if k == 0:
            return np.ones_like(S, dtype=bool)
        thresh = np.partition(S.ravel(), k - 1)[k - 1]
        keep = S > thresh
        # ties at the threshold: drop exactly k
        ties = np.flatnonzero((S == thresh).ravel())
        n_drop_ties = k - int((S < thresh).sum())
        keep.ravel()[ties[n_drop_ties:]] = True
        return keep
    k = int(n_in * s)  # per output column
    keep = np.ones_like(S, dtype=bool)
    if k:
        idx = np.argsort(S, axis=0, kind="stable")[:k]
        np.put_along_axis(keep, idx, False, axis=0)
    return keep


def score(method, W, sumsq=None):
    if method == "magnitude":
        return np.abs(W)
    if method == "wanda":
        return np.abs(W) * np.sqrt(sumsq)[:, None]
    raise ValueError(method)


def sparsegpt_one(W, H, sparsity, blocksize=128, percdamp=0.01):
    """SparseGPT for one linear, following the reference implementation
    (github.com/IST-DASLab/sparsegpt, sparsegpt.py: fasterprune): dampened
    Hessian H = X^T X, upper Cholesky factor of H^-1, mask chosen per block of
    `blocksize` input columns by w^2 / [H^-1]_cc^2 (n:m: within each m columns
    per row), and OBS error propagation to the not-yet-visited columns.
    Returns the pruned [in, out] weight and its mask."""
    s, nm = _parse(sparsity)
    W = W.T.astype(np.float64).copy()  # [out, in]: columns = inputs
    H = np.array(H, dtype=np.float64)  # a copy; accumulated in float32 for large
    n = H.shape[0]
    dead = np.diag(H) == 0
    H[dead, dead] = 1
    W[:, dead] = 0
    H[np.diag_indices(n)] += percdamp * np.mean(np.diag(H))
    Hinv = np.linalg.cholesky(np.linalg.inv(H)).T
    M = np.ones_like(W, dtype=bool)
    for i1 in range(0, n, blocksize):
        i2 = min(i1 + blocksize, n)
        W1 = W[:, i1:i2].copy()
        Err1 = np.zeros_like(W1)
        Hinv1 = Hinv[i1:i2, i1:i2]
        d = np.diag(Hinv1)
        if nm is None:
            tmp = W1**2 / d[None, :] ** 2
            k = int(tmp.size * s)
            mask1 = np.zeros_like(W1, dtype=bool)  # True = prune
            if k:
                flat = np.argsort(tmp, axis=None, kind="stable")[:k]
                mask1.ravel()[flat] = True
        else:
            mask1 = np.zeros_like(W1, dtype=bool)
        for i in range(i2 - i1):
            w = W1[:, i]
            if nm is not None and i % nm[1] == 0:
                nn, mm = nm
                tmp = W1[:, i : i + mm] ** 2 / d[i : i + mm][None, :] ** 2
                idx = np.argsort(tmp, axis=1, kind="stable")[:, : mm - nn]
                np.put_along_axis(mask1[:, i : i + mm], idx, True, axis=1)
            q = w.copy()
            q[mask1[:, i]] = 0
            err = (w - q) / Hinv1[i, i]
            W1[:, i:] -= np.outer(err, Hinv1[i, i:])
            W1[:, i] = q  # exactly zero where pruned
            Err1[:, i] = err
        W[:, i1:i2] = W1
        M[:, i1:i2] = ~mask1
        W[:, i2:] -= Err1 @ Hinv[i1:i2, i2:]
    return W.T.astype(np.float32), M.T


def prune_all(model, method, sparsity, group="output", rec=None):
    """Return {linear name: pruned [in, out] weight} for every linear layer."""
    out = {}
    for name, W in model.W.items():
        if method == "sparsegpt":
            out[name], _ = sparsegpt_one(W, rec.H[name], sparsity)
        else:
            S = score(method, W, None if rec is None else rec.sumsq[name])
            out[name] = np.where(mask_from_score(S, sparsity, group), W, 0).astype(W.dtype)
    return out


def density(weights):
    nz = sum(int(np.count_nonzero(w)) for w in weights.values())
    tot = sum(w.size for w in weights.values())
    return nz / tot
