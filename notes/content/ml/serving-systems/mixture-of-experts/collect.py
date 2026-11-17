"""Run the Switch-Base encoder on four kinds of real text and save every
router logit. usage: python collect.py e8|e64"""
import sys, glob, json, re, pathlib, numpy as np, sentencepiece as spm
sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__file__), "../quantization"))
from prep_text import clean_markdown
from switch import Switch
E = sys.argv[1]
WIN, PER = 255, 32  # 255 tokens + EOS per window, 32 windows per domain
sp = spm.SentencePieceProcessor(model_file="ck/sentencepiece.model")
def docs_prose():
    for p in sorted(glob.glob("src/gowebsite/_content/blog/*.md")):
        paras = clean_markdown(open(p).read())
        if sum(len(x.split()) for x in paras) >= 300: yield p, " ".join(paras)
def docs_code():
    for p in sorted(glob.glob("src/gowebsite/**/*.go", recursive=True)):
        t = open(p).read()
        if len(t) > 3000: yield p, t
def docs_shakes():
    t = open("src/tinyshakespeare.txt").read()
    for k in range(0, len(t), 20000): yield f"shakes@{k}", t[k:k + 20000]
def docs_math():
    for p in sorted(glob.glob("../../../math/**/*.md", recursive=True)):
        t = re.sub(r"\A---\n.*?\n---\n", "", open(p).read(), flags=re.S)
        if t.count("$") > 40: yield p, t
DOMAINS = {"prose": docs_prose, "code": docs_code, "shakespeare": docs_shakes, "math": docs_math}
rng = np.random.default_rng(2026)
wins, meta = {}, {}
for d, gen in DOMAINS.items():
    cand = []
    for name, text in gen():
        ids = sp.encode(text)
        cand += [(name, ids[s:s + WIN]) for s in range(0, len(ids) - WIN + 1, WIN)]
    pick = sorted(rng.choice(len(cand), PER, replace=False))
    wins[d] = np.array([c[1] + [1] for c in [cand[i] for i in pick]], np.int64)
    meta[d] = {"candidates": len(cand), "sources": sorted({cand[i][0].split("/")[-1] for i in pick})[:40]}
    print(d, len(cand), "windows available, picked", PER, flush=True)
m = Switch(f"ck/{E}")
out = {}
for d, I in wins.items():
    m.routes = {}
    for b in range(0, len(I), 8):
        m.encode(I[b:b + 8])
    for k, v in m.routes.items():
        out[f"{d}/{k}"] = np.concatenate(v).astype(np.float32)
    out[f"{d}/ids"] = I
    print(d, "done", flush=True)
np.savez_compressed(f"routes_{E}.npz", **out)
json.dump(meta, open(f"routes_{E}_meta.json", "w"), indent=1)
