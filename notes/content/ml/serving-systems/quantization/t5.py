"""A numpy forward pass for Google's T5 v1.1 (LM-adapted) checkpoints, with a
hook on every linear layer so quantization can be simulated.

Architecture follows the T5 v1.1 release: RMS layer norm without bias,
gated-GELU feed-forward (tanh GELU), relative position buckets shared across
layers, no 1/sqrt(d) in attention (folded into initialization), untied output
projection. Everything runs in float32.

Every matmul against a weight goes through `Model.linear(name, x)`. A
`Quantizer` (quant.py) can replace the effective weight, quantize the input,
or record statistics, keyed by the linear's name such as "enc.3.ffn.wo".
"""
from __future__ import annotations

import math
import numpy as np


def gelu(x):
    return 0.5 * x * (1.0 + np.tanh(0.7978845608028654 * (x + 0.044715 * x * x * x)))


def rms_norm(x, scale, eps=1e-6):
    var = np.mean(x * x, axis=-1, keepdims=True)
    return x / np.sqrt(var + eps) * scale


def bucket(rel, bidirectional, num_buckets=32, max_distance=128):
    """T5's relative position buckets (rel = key position - query position)."""
    ret = np.zeros_like(rel)
    if bidirectional:
        num_buckets //= 2
        ret += (rel > 0).astype(rel.dtype) * num_buckets
        n = np.abs(rel)
    else:
        n = -np.minimum(rel, 0)
    max_exact = num_buckets // 2
    small = n < max_exact
    with np.errstate(divide="ignore"):
        large = max_exact + (
            np.log(np.maximum(n, 1) / max_exact) / math.log(max_distance / max_exact) * (num_buckets - max_exact)
        ).astype(rel.dtype)
    large = np.minimum(large, num_buckets - 1)
    return ret + np.where(small, n, large)


def softmax(x, axis=-1):
    x = x - x.max(axis=axis, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=axis, keepdims=True)


class Model:
    def __init__(self, npz_path: str):
        z = np.load(npz_path)
        self.p = {k: z[k] for k in z.files}
        self.n_enc = len({k.split("/")[1] for k in self.p if k.startswith("encoder/block_")})
        self.n_dec = len({k.split("/")[1] for k in self.p if k.startswith("decoder/block_")})
        self.d_model = self.p["shared/embedding"].shape[1]
        self.heads = self.p["encoder/block_000/layer_000/SelfAttention/relative_attention_bias"].shape[0]
        self.W = {}  # linear name -> [in, out] weight, as released
        for side, n in (("enc", self.n_enc), ("dec", self.n_dec)):
            pre = "encoder" if side == "enc" else "decoder"
            for i in range(n):
                b = f"{pre}/block_{i:03d}"
                for m in "qkvo":
                    self.W[f"{side}.{i}.attn.{m}"] = self.p[f"{b}/layer_000/SelfAttention/{m}"]
                ffn = "layer_001" if side == "enc" else "layer_002"
                if side == "dec":
                    for m in "qkvo":
                        self.W[f"{side}.{i}.cross.{m}"] = self.p[f"{b}/layer_001/EncDecAttention/{m}"]
                self.W[f"{side}.{i}.ffn.wi_0"] = self.p[f"{b}/{ffn}/DenseReluDense/wi_0/kernel"]
                self.W[f"{side}.{i}.ffn.wi_1"] = self.p[f"{b}/{ffn}/DenseReluDense/wi_1/kernel"]
                self.W[f"{side}.{i}.ffn.wo"] = self.p[f"{b}/{ffn}/DenseReluDense/wo/kernel"]
        self.quant = None  # a quant.Quantizer, or None for the released weights
        self.residual_absmax = 0.0  # largest |value| seen in the residual stream

    # ---- the one place a weight meets an activation -------------------------
    def linear(self, name, x):
        if self.quant is None:
            return x @ self.W[name]
        return self.quant.linear(self, name, x)

    # ---- pieces --------------------------------------------------------------
    def _attn(self, prefix, x_q, x_kv, bias, mask):
        B, Tq, _ = x_q.shape
        Tk = x_kv.shape[1]
        H = self.heads
        q = self.linear(prefix + ".q", x_q).reshape(B, Tq, H, -1).transpose(0, 2, 1, 3)
        k = self.linear(prefix + ".k", x_kv).reshape(B, Tk, H, -1).transpose(0, 2, 1, 3)
        v = self.linear(prefix + ".v", x_kv).reshape(B, Tk, H, -1).transpose(0, 2, 1, 3)
        s = q @ k.transpose(0, 1, 3, 2)
        if bias is not None:
            s = s + bias
        if mask is not None:
            s = np.where(mask, s, -1e9)
        a = softmax(s) @ v
        a = a.transpose(0, 2, 1, 3).reshape(B, Tq, -1)
        return self.linear(prefix + ".o", a)

    def _ffn(self, prefix, x):
        h = gelu(self.linear(prefix + ".wi_0", x)) * self.linear(prefix + ".wi_1", x)
        return self.linear(prefix + ".wo", h)

    def _pos_bias(self, side, Tq, Tk):
        pre = "encoder" if side == "enc" else "decoder"
        table = self.p[f"{pre}/block_000/layer_000/SelfAttention/relative_attention_bias"]  # [H, 32]
        rel = np.arange(Tk)[None, :] - np.arange(Tq)[:, None]
        idx = bucket(rel, bidirectional=(side == "enc"))
        return table[:, idx][None]  # [1, H, Tq, Tk]

    def _track(self, x):
        m = float(np.abs(x).max())
        if m > self.residual_absmax:
            self.residual_absmax = m

    def encode(self, ids):
        p = self.p
        x = p["shared/embedding"][ids]
        bias = self._pos_bias("enc", ids.shape[1], ids.shape[1])
        for i in range(self.n_enc):
            b = f"encoder/block_{i:03d}"
            x = x + self._attn(f"enc.{i}.attn", *(2 * [rms_norm(x, p[f"{b}/layer_000/layer_norm/scale"])]), bias, None)
            self._track(x)
            x = x + self._ffn(f"enc.{i}.ffn", rms_norm(x, p[f"{b}/layer_001/layer_norm/scale"]))
            self._track(x)
        return rms_norm(x, p["encoder/final_layer_norm/scale"])

    def decode(self, enc, dec_ids):
        p = self.p
        x = p["shared/embedding"][dec_ids]
        T = dec_ids.shape[1]
        bias = self._pos_bias("dec", T, T)
        causal = np.tril(np.ones((T, T), dtype=bool))[None, None]
        for i in range(self.n_dec):
            b = f"decoder/block_{i:03d}"
            h = rms_norm(x, p[f"{b}/layer_000/layer_norm/scale"])
            x = x + self._attn(f"dec.{i}.attn", h, h, bias, causal)
            self._track(x)
            x = x + self._attn(f"dec.{i}.cross", rms_norm(x, p[f"{b}/layer_001/layer_norm/scale"]), enc, None, None)
            self._track(x)
            x = x + self._ffn(f"dec.{i}.ffn", rms_norm(x, p[f"{b}/layer_002/layer_norm/scale"]))
            self._track(x)
        x = rms_norm(x, p["decoder/final_layer_norm/scale"])
        return x @ p["decoder/logits/kernel"]  # the output head stays unquantized

    def nll(self, inputs, targets):
        """Per-token negative log-likelihood of targets given inputs (prefix LM).

        inputs: [B, Ti] token ids (prefix, ending in EOS), targets: [B, Tt].
        Returns [B, Tt] float64 nats."""
        enc = self.encode(inputs)
        dec_in = np.concatenate([np.zeros((targets.shape[0], 1), dtype=targets.dtype), targets[:, :-1]], axis=1)
        logits = self.decode(enc, dec_in).astype(np.float64)
        logits -= logits.max(-1, keepdims=True)
        lse = np.log(np.exp(logits).sum(-1))
        tok = np.take_along_axis(logits, targets[..., None], axis=-1)[..., 0]
        return lse - tok
