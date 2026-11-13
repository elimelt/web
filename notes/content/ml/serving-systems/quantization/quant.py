"""Simulated ("fake") quantization: values are rounded to the grid of a
low-precision format and immediately mapped back to float32, so the forward
pass sees exactly the numbers an integer or FP8 kernel would multiply. Speed
is not modeled, only accuracy.

Weights are [in, out]. "Per-channel" means one scale per output channel;
"group g" means one scale (and zero point) per g consecutive input weights of
one output channel, as in GPTQ and AWQ's INT4 formats.
"""
from __future__ import annotations

import numpy as np


# ---- grids -------------------------------------------------------------------
def quant_sym(x, bits, axis=None):
    """Symmetric absmax: scale = max|x| / (2^(b-1)-1), zero point 0."""
    qmax = 2 ** (bits - 1) - 1
    amax = np.max(np.abs(x), axis=axis, keepdims=axis is not None)
    scale = np.where(amax > 0, amax / qmax, 1.0)
    return np.clip(np.rint(x / scale), -qmax - 1, qmax) * scale


def quant_asym(x, bits, axis=None):
    """Asymmetric min-max with an integer zero point."""
    qmax = 2**bits - 1
    lo = np.minimum(np.min(x, axis=axis, keepdims=axis is not None), 0)
    hi = np.maximum(np.max(x, axis=axis, keepdims=axis is not None), 0)
    scale = np.where(hi > lo, (hi - lo) / qmax, 1.0)
    zero = np.rint(-lo / scale)
    return (np.clip(np.rint(x / scale) + zero, 0, qmax) - zero) * scale


def round_e4m3(x):
    """Round to the nearest FP8 E4M3 value (max 448, subnormals below 2^-6)."""
    a = np.abs(x)
    e = np.floor(np.log2(np.maximum(a, 2.0**-9)))
    e = np.maximum(e, -6)  # subnormal range shares the 2^-6 exponent
    step = 2.0 ** (e - 3)  # 3 mantissa bits
    return np.sign(x) * np.minimum(np.rint(a / step) * step, 448.0)


def quant_fp8(x, axis=None):
    """Scale so max|x| maps to 448, round to E4M3, scale back."""
    amax = np.max(np.abs(x), axis=axis, keepdims=axis is not None)
    scale = np.where(amax > 0, amax / 448.0, 1.0)
    return round_e4m3(x / scale) * scale


def quant_weight(W, bits, gran, sym=True):
    """gran: 'tensor', 'channel' or an int group size along the input dim."""
    f = quant_sym if sym else quant_asym
    if gran == "tensor":
        return f(W, bits)
    if gran == "channel":
        return f(W, bits, axis=0)
    g = int(gran)
    n_in, n_out = W.shape
    Wg = W.reshape(n_in // g, g, n_out)
    return f(Wg, bits, axis=1).reshape(n_in, n_out)


def quant_act(x, bits, gran, static_amax=None):
    """Activation quantization: 'tensor' (dynamic), 'token' (dynamic, one scale
    per row) or 'static' (one scale from calibration)."""
    if bits == "fp8":
        return quant_fp8(x, axis=-1 if gran == "token" else None)
    if gran == "token":
        return quant_sym(x, bits, axis=-1)
    if gran == "static":
        qmax = 2 ** (bits - 1) - 1
        s = static_amax / qmax
        return np.clip(np.rint(x / s), -qmax - 1, qmax) * s
    return quant_sym(x, bits)


# ---- groups of linears that read the same input ------------------------------
def input_groups(model):
    groups = []
    for side, n in (("enc", model.n_enc), ("dec", model.n_dec)):
        for i in range(n):
            groups += [[f"{side}.{i}.attn.q", f"{side}.{i}.attn.k", f"{side}.{i}.attn.v"], [f"{side}.{i}.attn.o"]]
            if side == "dec":
                groups += [[f"dec.{i}.cross.q"], [f"dec.{i}.cross.k", f"dec.{i}.cross.v"], [f"dec.{i}.cross.o"]]
            groups += [[f"{side}.{i}.ffn.wi_0", f"{side}.{i}.ffn.wi_1"], [f"{side}.{i}.ffn.wo"]]
    return groups


# ---- the hook ------------------------------------------------------------------
class Quantizer:
    """Holds effective weights and activation rules; the model calls linear()."""

    def __init__(self):
        self.W = {}  # name -> effective (dequantized) weight
        self.smooth = {}  # name -> per-input-channel divisor s applied to x
        self.act = None  # (bits, gran) or None
        self.act_skip = set()  # names whose input stays unquantized
        self.static_amax = {}
        self.int8_threshold = None  # LLM.int8() outlier threshold
        self.int8_cols = []  # fraction of input columns kept in FP per call
        self.record = None  # Recorder

    def linear(self, model, name, x):
        if self.record is not None:
            self.record.see(name, x)
        W = self.W.get(name, model.W[name])
        if self.int8_threshold is not None:
            return self._llm_int8(model, name, x)
        if name in self.smooth:
            x = x / self.smooth[name]
        if self.act is not None and name not in self.act_skip:
            x = quant_act(x, self.act[0], self.act[1], self.static_amax.get(name))
        return x @ W

    def _llm_int8(self, model, name, x):
        W = model.W[name]
        flat = x.reshape(-1, x.shape[-1])
        cols = np.any(np.abs(flat) >= self.int8_threshold, axis=0)
        self.int8_cols.append(cols.mean())
        keep = ~cols
        out = flat[:, cols] @ W[cols]  # outlier features stay in float
        if keep.any():
            xq = quant_sym(flat[:, keep], 8, axis=-1)  # per token
            wq = quant_sym(W[keep], 8, axis=0)  # per output channel
            out = out + xq @ wq
        return out.reshape(*x.shape[:-1], W.shape[1])


class Recorder:
    """Collects per-linear input statistics during a calibration pass."""

    def __init__(self, hessian=False, keep_rows=0, seed=0):
        self.absmax, self.absmean, self.count = {}, {}, {}
        self.sumsq, self.maxtok = {}, {}
        self.H = {} if hessian else None
        self.keep_rows = keep_rows
        self.rows = {}
        self.rng = np.random.default_rng(seed)

    def see(self, name, x):
        f = x.reshape(-1, x.shape[-1]).astype(np.float64)
        a = np.abs(f)
        self.absmax[name] = np.maximum(self.absmax.get(name, 0), a.max(0))
        self.absmean[name] = self.absmean.get(name, 0) + a.sum(0)
        self.sumsq[name] = self.sumsq.get(name, 0) + (f * f).sum(0)
        self.count[name] = self.count.get(name, 0) + f.shape[0]
        if self.H is not None:
            self.H[name] = self.H.get(name, 0) + f.T @ f
        if self.keep_rows:
            take = f[self.rng.choice(f.shape[0], size=min(self.keep_rows, f.shape[0]), replace=False)]
            prev = self.rows.get(name)
            self.rows[name] = take if prev is None else np.concatenate([prev, take])

    def mean_abs(self, name):
        return self.absmean[name] / self.count[name]


# ---- methods -------------------------------------------------------------------
def rtn(model, bits, gran, sym=True):
    q = Quantizer()
    for name, W in model.W.items():
        q.W[name] = quant_weight(W, bits, gran, sym)
    return q


def awq(model, rec, bits, group, grid=20):
    """AWQ's activation-aware scaling, simplified: for each group of linears
    sharing an input, search s = mean|x|^alpha (alpha on a grid in [0, 1]) to
    minimize the error of those linears' outputs on calibration rows, then
    quantize W*s. The 1/s goes into the input (in a real kernel it is folded
    into the previous op)."""
    q = Quantizer()
    alphas = {}
    for names in input_groups(model):
        X = rec.rows[names[0]].astype(np.float32)
        W = np.concatenate([model.W[n] for n in names], axis=1)
        ref = X @ W
        m = rec.mean_abs(names[0]).astype(np.float32)
        best = (np.inf, None, None)
        for k in range(grid + 1):
            a = k / grid
            s = np.maximum(m, 1e-8) ** a
            s = s / np.sqrt(s.max() * s.min())
            Wq = quant_weight(W * s[:, None], bits, group, sym=False) / s[:, None]
            err = float(np.mean((X @ Wq - ref) ** 2))
            if err < best[0]:
                best = (err, a, Wq)
        _, a, Wq = best
        col = 0
        for n in names:
            w = model.W[n].shape[1]
            q.W[n] = Wq[:, col : col + w]
            col += w
            alphas[n] = a
    q.alphas = alphas
    return q


def gptq_one(W, H, bits, group, blocksize=128, percdamp=0.01):
    assert blocksize % group == 0
    """GPTQ (Frantar et al. 2022) for one linear. W is [in, out]; GPTQ works on
    input columns of the [out, in] matrix, so we transpose. Follows the
    reference implementation: dampened Hessian, Cholesky of its inverse, lazy
    block updates, group scales computed on the not-yet-quantized weights."""
    W = W.T.astype(np.float64).copy()  # [out, in]
    H = H.copy()
    n = H.shape[0]
    dead = np.diag(H) == 0
    H[dead, dead] = 1
    W[:, dead] = 0
    H[np.diag_indices(n)] += percdamp * np.mean(np.diag(H))
    Hinv = np.linalg.cholesky(np.linalg.inv(H)).T  # upper Cholesky factor
    Q = np.zeros_like(W)
    qmax = 2**bits - 1
    scale = zero = None
    for i1 in range(0, n, blocksize):
        i2 = min(i1 + blocksize, n)
        W1 = W[:, i1:i2].copy()
        Q1 = np.zeros_like(W1)
        Err1 = np.zeros_like(W1)
        Hinv1 = Hinv[i1:i2, i1:i2]
        for i in range(i2 - i1):
            col = i1 + i
            if col % group == 0:  # new group: scale from the weights as updated so far
                g = W1[:, i : i + group]
                lo = np.minimum(g.min(1), 0)
                hi = np.maximum(g.max(1), 0)
                scale = np.where(hi > lo, (hi - lo) / qmax, 1.0)
                zero = np.rint(-lo / scale)
            w = W1[:, i]
            d = Hinv1[i, i]
            qv = (np.clip(np.rint(w / scale) + zero, 0, qmax) - zero) * scale
            Q1[:, i] = qv
            err = (w - qv) / d
            W1[:, i:] -= np.outer(err, Hinv1[i, i:])
            Err1[:, i] = err
        Q[:, i1:i2] = Q1
        W[:, i2:] -= Err1 @ Hinv[i1:i2, i2:]
    return Q.T.astype(np.float32)


def gptq(model, rec, bits, group):
    q = Quantizer()
    for name, W in model.W.items():
        q.W[name] = gptq_one(W, rec.H[name], bits, group)
    return q


def smoothquant(model, rec, alpha, act=(8, "tensor")):
    """W8A8 with SmoothQuant's per-channel migration
    s_j = max|X_j|^alpha / max|W_j|^(1-alpha), shared by linears that read the
    same input. Weights: INT8 per output channel after scaling."""
    q = Quantizer()
    q.act = act
    for names in input_groups(model):
        xmax = np.maximum(rec.absmax[names[0]], 1e-5)
        wmax = np.maximum(np.max(np.abs(np.concatenate([model.W[n] for n in names], axis=1)), axis=1), 1e-5)
        s = (xmax**alpha / wmax ** (1 - alpha)).astype(np.float32) if alpha > 0 else np.ones_like(xmax, np.float32)
        for n in names:
            q.smooth[n] = s
            q.W[n] = quant_weight(model.W[n] * s[:, None], 8, "channel")
    return q


def w8a8_fp8(model):
    """FP8 E4M3 weights (per output channel scale) and activations (per tensor,
    dynamic)."""
    q = Quantizer()
    q.act = ("fp8", "tensor")
    for name, W in model.W.items():
        q.W[name] = quant_fp8(W, axis=0)
    return q
