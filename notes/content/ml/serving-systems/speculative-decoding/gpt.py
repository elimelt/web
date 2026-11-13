"""A small GPT with a KV cache that can be rolled back.

Shared by train.py (training) and measure.py (decoding experiments). The cache
is the part speculative decoding cares about: the target appends a whole block
of drafted tokens in one forward pass, then truncates the cache back to the
last accepted token.
"""

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class Config:
    vocab: int
    n_layer: int
    d_model: int
    n_head: int
    context: int = 256


class Block(nn.Module):
    def __init__(self, cfg: Config):
        super().__init__()
        self.n_head = cfg.n_head
        self.ln1 = nn.LayerNorm(cfg.d_model)
        self.qkv = nn.Linear(cfg.d_model, 3 * cfg.d_model)
        self.proj = nn.Linear(cfg.d_model, cfg.d_model)
        self.ln2 = nn.LayerNorm(cfg.d_model)
        self.fc = nn.Linear(cfg.d_model, 4 * cfg.d_model)
        self.out = nn.Linear(4 * cfg.d_model, cfg.d_model)

    def forward(self, x, cache=None, pos=0):
        B, T, C = x.shape
        h = self.n_head
        q, k, v = self.qkv(self.ln1(x)).split(C, dim=2)
        q, k, v = (t.view(B, T, h, C // h).transpose(1, 2) for t in (q, k, v))
        if cache is None:
            a = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        else:
            # cache = [K, V] with shape (B, h, context, C/h); positions [0, pos) are valid.
            cache[0][:, :, pos : pos + T] = k
            cache[1][:, :, pos : pos + T] = v
            k = cache[0][:, :, : pos + T]
            v = cache[1][:, :, : pos + T]
            # Each new query i sits at absolute position pos+i and may see keys 0..pos+i.
            mask = torch.ones(T, pos + T, dtype=torch.bool).tril(diagonal=pos)
            a = F.scaled_dot_product_attention(q, k, v, attn_mask=mask)
        x = x + self.proj(a.transpose(1, 2).reshape(B, T, C))
        return x + self.out(F.gelu(self.fc(self.ln2(x))))


class GPT(nn.Module):
    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        self.tok = nn.Embedding(cfg.vocab, cfg.d_model)
        self.pos = nn.Embedding(cfg.context, cfg.d_model)
        self.blocks = nn.ModuleList(Block(cfg) for _ in range(cfg.n_layer))
        self.ln = nn.LayerNorm(cfg.d_model)
        self.head = nn.Linear(cfg.d_model, cfg.vocab, bias=False)
        self.head.weight = self.tok.weight  # tied embeddings
        self.apply(self._init)

    @staticmethod
    def _init(m):
        if isinstance(m, (nn.Linear, nn.Embedding)):
            nn.init.normal_(m.weight, std=0.02)
        if isinstance(m, nn.Linear) and m.bias is not None:
            nn.init.zeros_(m.bias)

    def forward(self, idx, cache=None, pos=0):
        T = idx.shape[1]
        x = self.tok(idx) + self.pos(torch.arange(pos, pos + T))
        for i, block in enumerate(self.blocks):
            x = block(x, None if cache is None else cache[i], pos)
        return self.head(self.ln(x))

    def new_cache(self, batch=1):
        c = self.cfg
        shape = (batch, c.n_head, c.context, c.d_model // c.n_head)
        return [[torch.zeros(shape), torch.zeros(shape)] for _ in range(c.n_layer)]

    def n_params(self):
        # Count tied embedding once; leave out position embeddings.
        return sum(p.numel() for p in self.parameters()) - self.pos.weight.numel()


SIZES = {
    "target": Config(vocab=4096, n_layer=4, d_model=256, n_head=4),
    "draft": Config(vocab=4096, n_layer=1, d_model=96, n_head=2),
}
