"""Control: the same prose windows in the pre-training input format (T5 span
corruption, 15% noise, mean span 3, sentinel tokens) vs plain text. If routing
balance depends on the input format, plain text alone shows more imbalance.
usage: python control.py e8|e64"""
import sys, numpy as np
from switch import Switch
from validate_lib import corrupt
E = sys.argv[1]
z = np.load(f"routes_{E}.npz")
ids = z["prose/ids"]  # 32 x 256 (255 tokens + EOS)
rng = np.random.default_rng(5)
cor = [corrupt(list(w[:-1]), rng)[0] for w in ids]
L = max(map(len, cor)); I = np.zeros((len(cor), L), np.int64); M = np.zeros_like(I, bool)
for k, a in enumerate(cor): I[k, :len(a)] = a; M[k, :len(a)] = True
m = Switch(f"ck/{E}", expert_dtype=np.float16)
for b in range(0, len(I), 8): m.encode(I[b:b+8], M[b:b+8])
for k, v in m.routes.items():
    ch = np.concatenate(v).argmax(1)[M.ravel()]
    N = v[0].shape[1]
    plain = z[f"prose/{k}"].argmax(1)
    print(E, k, "span-corrupted max/mean %.2f" % (N * np.bincount(ch, minlength=N).max() / ch.size),
          " plain %.2f" % (N * np.bincount(plain, minlength=N).max() / plain.size), flush=True)
