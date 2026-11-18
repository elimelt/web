"""Reference values for the PruneLab figure's test: the figure's layer pruned
with prune.py (the same code that prunes the whole model) under several
settings, using numpy instead of the figure's TypeScript.

usage: python3 figure_check.py  -> figure-check.json
"""
import base64
import json
import os

import numpy as np

import prune

HERE = os.path.dirname(os.path.abspath(__file__))
Q = json.load(open(os.path.join(HERE, "..", "quantization", "outlier-layer.json")))
P = json.load(open(os.path.join(HERE, "prune-layer.json")))


def dec(b64, kind):
    raw = np.frombuffer(base64.b64decode(b64), dtype="<u2")
    if kind == "f16":
        return raw.view(np.float16).astype(np.float64)
    return (raw.astype(np.uint32) << 16).view(np.float32).astype(np.float64)


N = Q["n_in"]
X = dec(Q["x_f16"], "f16").reshape(-1, N)
W = dec(Q["w_bf16"], "bf16").reshape(N, -1)
rms = np.array(P["rms_f16"], dtype=np.float64)
Y = X @ W

cases = []
for method in ("magnitude", "wanda"):
    S = np.abs(W) * (rms[:, None] if method == "wanda" else 1)
    for level in (0, 4, 10, 16, 19):
        s = P["grid"][level]
        for group in ("output", "layer"):
            if group == "layer":
                keep = S > P["layer_threshold"][method][level]
            else:
                keep = prune.mask_from_score(S, s, "output")
            Wp = np.where(keep, W, 0)
            cases.append({"method": method, "group": group, "pattern": "unstructured", "level": level,
                          "relErr": float(np.linalg.norm(X @ Wp - Y) / np.linalg.norm(Y)),
                          "sparsity": float(1 - keep.mean()), "kept888": int(keep[888].sum())})
    for pat in ("2:4", "4:8"):
        keep = prune.mask_from_score(S, pat)
        Wp = np.where(keep, W, 0)
        cases.append({"method": method, "group": "output", "pattern": pat, "level": 10,
                      "relErr": float(np.linalg.norm(X @ Wp - Y) / np.linalg.norm(Y)),
                      "sparsity": float(1 - keep.mean()), "kept888": int(keep[888].sum())})
json.dump({"cases": cases}, open(os.path.join(HERE, "figure-check.json"), "w"), indent=1)
for c in cases:
    print(c)
