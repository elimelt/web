"""A numpy forward pass for Google's released Switch Transformer checkpoints
(T5X, gs://t5-data/pretrained_models/t5x/moe/switch_classic/base/eN), with every
router decision recorded.

Architecture as released: T5 1.0-style blocks (RMS norm without bias, ReLU
feed-forward, relative position buckets shared across layers, no 1/sqrt(d) in
attention), every other feed-forward layer (layers 1, 3, ..., 11) replaced by a
switch layer. A switch layer computes router logits x @ W_r, p = softmax(logits),
sends the token to argmax p, and scales that expert's output by p[argmax].
Here every token reaches its chosen expert (no capacity limit), so the recorded
routing is what the router asks for; capacity and dropping are simulated
afterward on the recorded decisions. Output logits are tied to the input
embedding and divided by sqrt(d_model).
"""
from __future__ import annotations

import math
import numpy as np
import ckpt

ACT = {"relu": lambda x: np.maximum(x, 0.0),
       "gelu": lambda x: 0.5 * x * (1.0 + np.tanh(0.7978845608028654 * (x + 0.044715 * x ** 3)))}


def rms_norm(x, scale, eps=1e-6):
    return x / np.sqrt(np.mean(x * x, axis=-1, keepdims=True) + eps) * scale


def softmax(x, axis=-1):
    x = x - x.max(axis=axis, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=axis, keepdims=True)


def bucket(rel, bidirectional, num_buckets=32, max_distance=128):
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
        large = max_exact + (np.log(np.maximum(n, 1) / max_exact) / math.log(max_distance / max_exact)
                             * (num_buckets - max_exact)).astype(rel.dtype)
    large = np.minimum(large, num_buckets - 1)
    return ret + np.where(small, n, large)


class Switch:
    def __init__(self, ckdir, act="relu", scale_attn=False, expert_dtype=np.float32):
        self.p = ckpt.load(ckdir, expert_dtype)
        self.act = ACT[act]
        self.scale_attn = scale_attn
        self.emb = self.p["token_embedder.embedding"]
        self.d = self.emb.shape[1]
        self.n_enc = len({k.split(".")[1] for k in self.p if k.startswith("encoder.layers_")})
        self.has_dec = any(k.startswith("decoder.") for k in self.p)
        self.n_dec = len({k.split(".")[1] for k in self.p if k.startswith("decoder.layers_")})
        self.routes = {}  # "enc.L" -> list of (logits [T, E]) arrays, one per call

    def _attn(self, pre, xq, xkv, bias, mask):
        p = self.p
        B, Tq, _ = xq.shape
        Tk = xkv.shape[1]
        H = bias.shape[1] if bias is not None else 12
        q = (xq @ p[pre + ".query.kernel"]).reshape(B, Tq, H, -1).transpose(0, 2, 1, 3)
        k = (xkv @ p[pre + ".key.kernel"]).reshape(B, Tk, H, -1).transpose(0, 2, 1, 3)
        v = (xkv @ p[pre + ".value.kernel"]).reshape(B, Tk, H, -1).transpose(0, 2, 1, 3)
        s = q @ k.transpose(0, 1, 3, 2)
        if self.scale_attn:
            s = s / math.sqrt(q.shape[-1])
        if bias is not None:
            s = s + bias
        if mask is not None:
            s = np.where(mask, s, -1e9)
        a = (softmax(s) @ v).transpose(0, 2, 1, 3).reshape(B, Tq, -1)
        return a @ p[pre + ".out.kernel"]

    def _mlp(self, pre, x, key):
        p = self.p
        if pre + ".wi.kernel" in p:
            return self.act(x @ p[pre + ".wi.kernel"]) @ p[pre + ".wo.kernel"]
        W_r = p[pre + ".router.router_weights.w.kernel"]
        wi, wo = p[pre + ".expert.wi.kernel"], p[pre + ".expert.wo.kernel"]
        B, T, D = x.shape
        flat = x.reshape(-1, D)
        logits = flat.astype(np.float32) @ W_r
        self.routes.setdefault(key, []).append(logits.astype(np.float32))
        probs = softmax(logits)
        choice = probs.argmax(-1)
        out = np.zeros_like(flat)
        for e in range(W_r.shape[1]):
            idx = np.nonzero(choice == e)[0]
            if idx.size:
                h = self.act(flat[idx] @ wi[e].astype(np.float32)) @ wo[e].astype(np.float32)
                out[idx] = h * probs[idx, e][:, None]
        return out.reshape(B, T, D)

    def _bias(self, side, Tq, Tk):
        table = self.p[f"{side}.relpos_bias.rel_embedding"]  # [H, 32]
        rel = np.arange(Tk)[None, :] - np.arange(Tq)[:, None]
        return table[:, bucket(rel, bidirectional=(side == "encoder"))][None]

    def encode(self, ids, mask=None):
        p = self.p
        x = self.emb[ids]
        bias = self._bias("encoder", ids.shape[1], ids.shape[1])
        am = None if mask is None else mask[:, None, None, :]
        for i in range(self.n_enc):
            b = f"encoder.layers_{i}"
            h = rms_norm(x, p[b + ".pre_attention_layer_norm.scale"])
            x = x + self._attn(b + ".attention", h, h, bias, am)
            x = x + self._mlp(b + ".mlp", rms_norm(x, p[b + ".pre_mlp_layer_norm.scale"]), f"enc.{i}")
        return rms_norm(x, p["encoder.encoder_norm.scale"])

    def decode(self, enc, dec_ids, enc_mask=None):
        p = self.p
        x = self.emb[dec_ids]
        T = dec_ids.shape[1]
        bias = self._bias("decoder", T, T)
        causal = np.tril(np.ones((T, T), dtype=bool))[None, None]
        em = None if enc_mask is None else enc_mask[:, None, None, :]
        for i in range(self.n_dec):
            b = f"decoder.layers_{i}"
            h = rms_norm(x, p[b + ".pre_self_attention_layer_norm.scale"])
            x = x + self._attn(b + ".self_attention", h, h, bias, causal)
            h = rms_norm(x, p[b + ".pre_cross_attention_layer_norm.scale"])
            x = x + self._attn(b + ".encoder_decoder_attention", h, enc, np.zeros((1, 12, 1, 1), np.float32), em)
            x = x + self._mlp(b + ".mlp", rms_norm(x, p[b + ".pre_mlp_layer_norm.scale"]), f"dec.{i}")
        x = rms_norm(x, p["decoder.decoder_norm.scale"])
        return (x @ self.emb.T) / math.sqrt(self.d)
