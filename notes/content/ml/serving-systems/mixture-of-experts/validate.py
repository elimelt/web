"""Check the numpy Switch forward pass: T5 span-corruption loss on held-out-ish
real text (Go blog). A correct implementation of a converged checkpoint scores
low NLL; a wrong activation or attention scaling scores far worse."""
import sys, json, glob, re, numpy as np, sentencepiece as spm
from switch import Switch
sp = spm.SentencePieceProcessor(model_file="ck/sentencepiece.model")
from validate_lib import corrupt
texts = []
for f in sorted(glob.glob("src/gowebsite/_content/blog/*.md"))[:40]:
    t = re.sub(r"```.*?```", "", open(f).read(), flags=re.S)
    t = re.sub(r"\s+", " ", re.sub(r"[#*`<>\[\]]", " ", t))
    texts.append(sp.encode(t)[200:200 + 100])
rng = np.random.default_rng(0)
pairs = [corrupt(t, rng) for t in texts if len(t) == 100]
Li = max(len(a) for a, b in pairs); Lt = max(len(b) for a, b in pairs)
I = np.zeros((len(pairs), Li), np.int64); M = np.zeros_like(I, bool); Tg = np.zeros((len(pairs), Lt), np.int64); TM = np.zeros_like(Tg, bool)
for k, (a, b) in enumerate(pairs):
    I[k, :len(a)] = a; M[k, :len(a)] = True; Tg[k, :len(b)] = b; TM[k, :len(b)] = True
CK = sys.argv[1] if len(sys.argv) > 1 else "ck/e8"
for act, sc in [("relu", False)]:
    m = Switch(CK, act=act, scale_attn=sc, expert_dtype=np.float16)  # fp16 experts: e64 encoder+decoder fit in 15 GB
    enc = m.encode(I, M)
    din = np.concatenate([np.zeros((len(Tg), 1), np.int64), Tg[:, :-1]], 1)
    lg = m.decode(enc, din, M).astype(np.float64)
    lg -= lg.max(-1, keepdims=True); lse = np.log(np.exp(lg).sum(-1))
    nll = lse - np.take_along_axis(lg, Tg[..., None], -1)[..., 0]
    acc = (lg.argmax(-1) == Tg)[TM].mean()
    nonsent = TM & (Tg < 32000) & (Tg != 1); print("content-only NLL %.3f acc %.3f" % (nll[nonsent].mean(), (lg.argmax(-1) == Tg)[nonsent].mean())); print(act, "scale" if sc else "noscale", "NLL/token %.3f  top1 acc %.3f  (n=%d)" % (nll[TM].mean(), acc, TM.sum()), flush=True)
    del m
