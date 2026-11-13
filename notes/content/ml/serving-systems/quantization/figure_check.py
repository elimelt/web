"""Independent numpy reference for the OutlierLab figure: decodes
outlier-layer.json and computes, for a set of settings, the numbers the figure
shows. The figure's test (quartz-site/plugins/mdx/test/outlier-lab.test.mjs)
compares its TypeScript model against figure-check.json.

usage: python3 figure_check.py   (run from this directory)
"""
import base64, json
import numpy as np
from quant import quant_sym, round_e4m3

d = json.load(open("outlier-layer.json"))
u = lambda k: np.frombuffer(base64.b64decode(d[k]), "<u2")
f16 = lambda k: u(k).view("<f2").astype(np.float64)
bf16 = lambda k: (u(k).astype(np.uint32) << 16).view(np.float32).astype(np.float64)
N = d["n_in"]
X = f16("x_f16").reshape(-1, N)
W = bf16("w_bf16").reshape(N, -1)
wrow = bf16("w_rowmax_bf16")
cal = f16("cal_absmax_f16")
Y = X @ W


def wq(Wm, bits):
    if bits == "fp8":
        amax = np.abs(Wm).max(0, keepdims=True)
        return round_e4m3(Wm / (amax / 448)) * (amax / 448)
    return quant_sym(Wm, bits, axis=0)


def run(method, bits=8, alpha=0.5, threshold=6.0):
    keep = np.ones(N, bool)
    Xs, Ws = X, W
    if method == "smooth":
        s = np.maximum(cal, 1e-5) ** alpha / np.maximum(wrow, 1e-5) ** (1 - alpha)
        Xs, Ws = X / s, W * s[:, None]
    if method in ("tensor", "smooth"):
        Xq = quant_sym(Xs, bits)
    elif method == "fp8":
        sc = np.abs(Xs).max() / 448
        Xq = round_e4m3(Xs / sc) * sc
    elif method == "token":
        Xq = quant_sym(Xs, bits, axis=-1)
    else:  # LLM.int8()
        keep = ~np.any(np.abs(X) >= threshold, axis=0)
        Xq = X.copy()
        Xq[:, keep] = quant_sym(X[:, keep], bits, axis=-1)
    Wq = W.copy()
    Wq[keep] = wq(Ws[keep], "fp8" if method == "fp8" else bits)
    Yq = Xq @ Wq
    nz = (X[:, keep] != 0)
    zero = (Xq[:, keep] == 0) & nz
    tok = np.sqrt(((Yq - Y) ** 2).sum(1) / (Y**2).sum(1))
    rel = float(np.sqrt(((Yq - Y) ** 2).sum() / (Y**2).sum()))
    return {"method": method, "bits": bits, "alpha": alpha, "threshold": threshold, "relErr": rel,
            "zeroFrac": float(zero.sum() / nz.sum()), "floatCols": int((~keep).sum()), "tokenErr": tok.tolist()}


cases = [run("tensor", 8), run("tensor", 4), run("token", 8), run("token", 4), run("fp8"),
         run("smooth", 8, 0.5), run("smooth", 8, 0.8), run("smooth", 4, 0.65),
         run("int8", 8, threshold=6.0), run("int8", 8, threshold=20.0)]
json.dump(cases, open("figure-check.json", "w"), indent=1)
for c in cases:
    print(f"{c['method']:7s} b{c['bits']} a{c['alpha']} t{c['threshold']}: rel {c['relErr']:.4f} zero {c['zeroFrac']:.3f} fpcols {c['floatCols']}")
