"""Size of the top-p nucleus in the translation model's next-token distributions.

    OPENBLAS_NUM_THREADS=2 python3 nucleus.py > nucleus.json

Greedy-decodes the first 50 sentences of the sweep's sample and, at every
step, records the probability of the most likely token and how many tokens the
nucleus holds for p = 0.9 and p = 0.95 (the smallest set whose probability
reaches p, as Holtzman et al. define it).
"""
import json
import numpy as np
import sentencepiece as spm
import nmt_numpy as N

sp = spm.SentencePieceProcessor(model_file="data/sentencepiece.model")
m = N.Model("data/averaged-10-epoch.pt")
src = [l.rstrip("\n") for l in open("data/newstest2021.en-de.src.en", encoding="utf-8")]
order = np.random.default_rng(0).permutation(len(src))[:50]
top1, n90, n95 = [], [], []
for i in order:
    pieces = sp.encode(src[i], out_type=str)
    ckv = m.encode(pieces); st = m.init_state(); w = m.bos
    for t in range(2 * len(pieces) + 10):
        lp, st = m.step(ckv, st, [w], t)
        p = np.sort(np.exp(lp[0].astype(np.float64)))[::-1]
        c = np.cumsum(p)
        top1.append(float(p[0]))
        n90.append(int(np.searchsorted(c, 0.9) + 1)); n95.append(int(np.searchsorted(c, 0.95) + 1))
        w = int(np.argmax(lp[0]))
        if w == m.eos:
            break
q = lambda a, x: float(np.percentile(a, x))
out = {"steps": len(top1)}
for name, a in [("top1_prob", top1), ("nucleus_0.9", n90), ("nucleus_0.95", n95)]:
    out[name] = {"median": q(a, 50), "p90": q(a, 90), "p99": q(a, 99), "max": float(np.max(a)),
                 "frac_eq_1": float(np.mean(np.array(a) == 1)) if name != "top1_prob" else None}
json.dump(out, __import__("sys").stdout, indent=1)
