"""Numpy implementation of the OpenNMT-py Transformer-base en-de model (pre-norm),
with an incremental decoder, so beam search can be run with full control."""
import numpy as np
import ptload

H = 8

def ln(x, g, b, eps=1e-6):
    # onmt.modules.LayerNorm (OpenNMT-py 0.4): unbiased std, eps added to the std
    m = x.mean(-1, keepdims=True)
    sd = x.std(-1, keepdims=True, ddof=1)
    return g * (x - m) / (sd + eps) + b

def lin(x, W, b):
    return x @ W.T + b

def log_softmax(z):
    z = z - z.max(-1, keepdims=True)
    return z - np.log(np.exp(z).sum(-1, keepdims=True))

class Model:
    def __init__(self, ckpt_path):
        ck = ptload.load(ckpt_path)
        self.p = {k: np.ascontiguousarray(v) for k, v in ck["model"].items()}
        self.gW = ck["generator"]["0.weight"]; self.gb = ck["generator"]["0.bias"]
        voc = lambda s: ck["vocab"][s]._state["fields"][0][1]._state["vocab"]._state["itos"]
        self.src_itos, self.tgt_itos = voc("src"), voc("tgt")
        self.src_stoi = {w: i for i, w in enumerate(self.src_itos)}
        self.tgt_stoi = {w: i for i, w in enumerate(self.tgt_itos)}
        self.bos, self.eos = self.tgt_stoi["<s>"], self.tgt_stoi["</s>"]
        self.unk = self.src_stoi["<unk>"]
        self.d = 512
        # pre-transpose for speed
        self.WT = {k: np.ascontiguousarray(v.T) for k, v in self.p.items() if v.ndim == 2 and "emb" not in k}
        self.gWT = np.ascontiguousarray(self.gW.T)

    def L(self, x, name):
        W = self.WT[name + ".weight"]
        y = x.reshape(-1, x.shape[-1]) @ W + self.p[name + ".bias"]
        return y.reshape(x.shape[:-1] + (W.shape[1],))

    def LN(self, x, name):
        return ln(x, self.p[name + ".a_2"], self.p[name + ".b_2"])

    def embed(self, side, ids, pos):
        E = self.p[f"{side}.embeddings.make_embedding.emb_luts.0.weight"]
        pe = self.p[f"{side}.embeddings.make_embedding.pe.pe"][:, 0, :]
        return (E[ids] * np.float32(np.sqrt(self.d)) + pe[pos]).astype(np.float32)

    def mha(self, q_in, k_in, v_in, name, mask=None):
        # q_in: (B,Tq,d) k_in/v_in: (B,Tk,d)
        B, Tq, d = q_in.shape; dh = d // H
        q = self.L(q_in, name + ".linear_query").reshape(B, Tq, H, dh).transpose(0, 2, 1, 3) * np.float32(1.0 / np.sqrt(dh))
        k = self.L(k_in, name + ".linear_keys").reshape(B, -1, H, dh).transpose(0, 2, 3, 1)
        v = self.L(v_in, name + ".linear_values").reshape(B, -1, H, dh).transpose(0, 2, 1, 3)
        return self._attend(q, k, v, name, mask)

    def _attend(self, q, k, v, name, mask=None):
        s = q @ k  # B,H,Tq,Tk
        if mask is not None:
            s = np.where(mask, s, -1e18)
        s = s - s.max(-1, keepdims=True); a = np.exp(s); a /= a.sum(-1, keepdims=True)
        o = (a @ v).transpose(0, 2, 1, 3)
        B, Tq = o.shape[:2]
        return self.L(o.reshape(B, Tq, -1), name + ".final_linear")

    def ffn(self, x, name):
        h = self.LN(x, name + ".layer_norm")
        h = np.maximum(self.L(h, name + ".w_1"), 0)
        return self.L(h, name + ".w_2") + x

    def encode(self, src_pieces):
        ids = np.array([self.src_stoi.get(w, self.unk) for w in src_pieces])[None]
        x = self.embed("encoder", ids, np.arange(ids.shape[1]))
        for i in range(6):
            n = f"encoder.transformer.{i}"
            h = self.LN(x, n + ".layer_norm")
            x = self.mha(h, h, h, n + ".self_attn") + x
            x = self.ffn(x, n + ".feed_forward")
        mem = self.LN(x, "encoder.layer_norm")  # (1,S,d)
        # precompute cross-attention keys/values per layer
        dh = self.d // H
        ckv = []
        for i in range(6):
            n = f"decoder.transformer_layers.{i}.context_attn"
            k = self.L(mem, n + ".linear_keys").reshape(1, -1, H, dh).transpose(0, 2, 3, 1)
            v = self.L(mem, n + ".linear_values").reshape(1, -1, H, dh).transpose(0, 2, 1, 3)
            ckv.append((k, v))
        return ckv

    def init_state(self):
        return [(np.zeros((1, H, 64, 0), np.float32), np.zeros((1, H, 0, 64), np.float32)) for _ in range(6)]

    def step(self, ckv, state, tokens, t):
        """tokens: (B,) last token for each hypothesis, at position t. state: per-layer self K,V
        with batch B. Returns log-probs (B,V) and new state."""
        B = len(tokens); dh = self.d // H
        x = self.embed("decoder", np.asarray(tokens)[:, None], np.array([t]))  # B,1,d
        new = []
        for i in range(6):
            n = f"decoder.transformer_layers.{i}"
            h = self.LN(x, n + ".layer_norm_1")
            q = self.L(h, n + ".self_attn.linear_query").reshape(B, 1, H, dh).transpose(0, 2, 1, 3) * np.float32(1.0 / np.sqrt(dh))
            k = self.L(h, n + ".self_attn.linear_keys").reshape(B, 1, H, dh).transpose(0, 2, 3, 1)
            v = self.L(h, n + ".self_attn.linear_values").reshape(B, 1, H, dh).transpose(0, 2, 1, 3)
            K = np.concatenate([state[i][0], k], axis=3); V = np.concatenate([state[i][1], v], axis=2)
            new.append((K, V))
            x = self._attend(q, K, V, n + ".self_attn") + x
            h = self.LN(x, n + ".layer_norm_2")
            q = self.L(h, n + ".context_attn.linear_query").reshape(B, 1, H, dh).transpose(0, 2, 1, 3) * np.float32(1.0 / np.sqrt(dh))
            ck, cv = ckv[i]
            x = self._attend(q, ck, cv, n + ".context_attn") + x
            x = self.ffn(x, n + ".feed_forward")
        x = self.LN(x, "decoder.layer_norm")[:, 0, :]
        logits = x @ self.gWT + self.gb
        return log_softmax(logits), new

def reorder(state, idx):
    return [(K[idx], V[idx]) for K, V in state]
