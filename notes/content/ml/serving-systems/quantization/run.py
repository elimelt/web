"""Experiments for the quantization note. Each stage writes its own JSON file
in OUT_DIR; merge.py combines them into results.json beside the note.

usage:
  python3 run.py outliers SIZE      # activation statistics of a model size
  python3 run.py weights            # weight-only RTN grid (base)
  python3 run.py calibrated         # RTN vs AWQ vs GPTQ, 3 calibration seeds (base)
  python3 run.py w8a8               # W8A8: per-tensor, per-token, SmoothQuant, LLM.int8(), FP8 (base)
  python3 run.py figure             # one layer's real activations and weights for the figure
  python3 run.py rows               # which tokens carry the giant wo inputs (base)

Environment: MODEL_DIR (the .npz files from convert.py), TEXT_DIR (prep_text.py
output), SPM (T5's sentencepiece model), OUT_DIR.
"""
from __future__ import annotations

import json
import os
import platform
import sys
import time

import numpy as np

import data
import quant
import t5

MODEL_DIR = os.environ.get("MODEL_DIR", "/home/claude/qwork")
TEXT_DIR = os.environ.get("TEXT_DIR", "/home/claude/qwork/text")
SPM = os.environ.get("SPM", "/home/claude/qwork/ckpt/spm.model")
OUT = os.environ.get("OUT_DIR", "/home/claude/qwork/out")
BATCH = 16
N_CAL = 64  # calibration windows: 64 x 129 encoder + 64 x 64 decoder tokens


def model(size):
    return t5.Model(f"{MODEL_DIR}/{size}.npz")


def window_nll(m, inputs, targets):
    out = []
    for s in range(0, len(inputs), BATCH):
        out.append(m.nll(inputs[s : s + BATCH], targets[s : s + BATCH]).mean(1))
    return np.concatenate(out)


def summarize(nll, base=None, n_boot=2000):
    r = {"ppl": float(np.exp(nll.mean()))}
    if base is not None:
        d = nll - base  # paired by window
        rng = np.random.default_rng(0)
        boots = np.array([d[rng.integers(0, len(d), len(d))].mean() for _ in range(n_boot)])
        r["dppl_pct"] = float((np.exp(d.mean()) - 1) * 100)
        r["dppl_pct_ci"] = [float((np.exp(np.percentile(boots, q)) - 1) * 100) for q in (2.5, 97.5)]
    return r


def calibrate(m, d, seed, hessian=False, keep_rows=0):
    rec = quant.Recorder(hessian=hessian, keep_rows=keep_rows, seed=seed)
    m.quant = quant.Quantizer()
    m.quant.record = rec
    ci, ct = data.calibration(d, N_CAL, seed)
    window_nll(m, ci, ct)
    m.quant = None
    return rec


def evaluate(m, q, d, base, sets=("eval",)):
    m.quant = q
    out = {}
    for s in sets:
        inp, tgt = d[s]
        out[s] = summarize(window_nll(m, inp, tgt), base.get(s))
    m.quant = None
    return out


def baseline(m, d, sets=("eval", "shakespeare")):
    m.quant = None
    m.residual_absmax = 0.0
    base = {s: window_nll(m, *d[s]) for s in sets}
    return base, {s: summarize(base[s]) for s in sets}, m.residual_absmax


def save(name, obj):
    os.makedirs(OUT, exist_ok=True)
    obj["env"] = {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "cpu": platform.processor() or platform.machine(),
        "threads": os.cpu_count(),
        "finished": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(f"{OUT}/{name}.json", "w") as f:
        json.dump(obj, f, indent=1)
    print("wrote", f"{OUT}/{name}.json", flush=True)


SKIPS = {
    "ffn.wo": lambda n: n.endswith(".ffn.wo"),
    "ffn.wi": lambda n: n.endswith((".wi_0", ".wi_1")),
    "attn.o": lambda n: n.endswith((".attn.o", ".cross.o")),
    "attn.qkv": lambda n: n.split(".")[2] in ("attn", "cross") and n.split(".")[3] in ("q", "k", "v"),
}


def kind(name):
    side, _, block, sub = name.split(".")
    return f"{side}.{block}.{sub}"


# ---- stages ------------------------------------------------------------------
def stage_outliers(size):
    d = data.load(TEXT_DIR, SPM)
    m = model(size)
    t = time.time()
    rec = calibrate(m, d, seed=0)
    res = {"size": size, "d_model": m.d_model, "n_enc": m.n_enc, "n_dec": m.n_dec, "linears": {}}
    for name, amax in rec.absmax.items():
        med = float(np.median(amax))
        rms = np.sqrt(rec.sumsq[name] / rec.count[name])
        order = np.argsort(-amax)
        res["linears"][name] = {
            "absmax": float(amax.max()),
            "median_channel_absmax": med,
            "ratio": float(amax.max() / med),
            "channels_ge6": int((amax >= 6).sum()),
            "n_channels": int(amax.size),
            "top_channels": [int(i) for i in order[:5]],
            "top_absmax": [float(amax[i]) for i in order[:5]],
            "rms": float(np.sqrt(np.mean(rms**2))),
        }
    m.residual_absmax = 0.0
    m.nll(*[a[:8] for a in d["eval"]])
    res["residual_absmax"] = m.residual_absmax
    res["seconds"] = time.time() - t
    save(f"outliers-{size}", res)


def stage_weights():
    d = data.load(TEXT_DIR, SPM)
    m = model("base")
    base, fp, resid = baseline(m, d)
    res = {"fp": fp, "residual_absmax": resid, "n_eval": len(d["eval"][0]), "n_shakespeare": len(d["shakespeare"][0]),
           "eval_docs": d["n_eval_docs"], "cal_docs": d["n_cal_docs"], "runs": []}
    grid = [(8, "tensor", True), (8, "channel", True), (4, "tensor", True), (4, "channel", True),
            (4, "channel", False), (4, 128, False), (4, 32, False), (3, "channel", False), (3, 128, False),
            (3, 32, False), (2, 32, False)]
    for bits, gran, sym in grid:
        t = time.time()
        r = evaluate(m, quant.rtn(m, bits, gran, sym), d, base, sets=("eval", "shakespeare"))
        res["runs"].append({"bits": bits, "gran": gran, "sym": sym, **r, "seconds": time.time() - t})
        print(bits, gran, sym, r, flush=True)
        save("weights", res)


def stage_calibrated():
    d = data.load(TEXT_DIR, SPM)
    m = model("base")
    base, fp, _ = baseline(m, d, sets=("eval",))
    res = {"fp": fp, "runs": []}
    for bits in (4, 3):
        r = evaluate(m, quant.rtn(m, bits, 128, sym=False), d, base)
        res["runs"].append({"method": "rtn", "bits": bits, "group": 128, "seed": None, **r})
        print("rtn", bits, r, flush=True)
    for seed in (0, 1, 2):
        rec = calibrate(m, d, seed, hessian=True, keep_rows=256)
        for bits in (4, 3):
            t = time.time()
            q = quant.awq(m, rec, bits, 128)
            r = evaluate(m, q, d, base)
            alphas = list(q.alphas.values())
            res["runs"].append({"method": "awq", "bits": bits, "group": 128, "seed": seed, **r,
                                "alpha_mean": float(np.mean(alphas)), "seconds": time.time() - t})
            print("awq", bits, seed, r, flush=True)
            t = time.time()
            q = quant.gptq(m, rec, bits, 128)
            r = evaluate(m, q, d, base)
            res["runs"].append({"method": "gptq", "bits": bits, "group": 128, "seed": seed, **r,
                                "seconds": time.time() - t})
            print("gptq", bits, seed, r, flush=True)
            save("calibrated", res)
        del rec


def stage_w8a8():
    d = data.load(TEXT_DIR, SPM)
    m = model("base")
    base, fp, _ = baseline(m, d, sets=("eval",))
    res = {"fp": fp, "runs": []}

    def run(label, q, **extra):
        t = time.time()
        r = evaluate(m, q, d, base)
        res["runs"].append({"label": label, **extra, **r, "seconds": time.time() - t})
        print(label, extra, r, flush=True)
        save("w8a8", res)

    # activation granularity without any outlier handling
    for gran in ("tensor", "token"):
        q = quant.rtn(m, 8, "channel")
        q.act = (8, gran)
        run("int8", q, act=gran)
    # which layer's inputs carry the damage: keep one kind of input in float
    for skip in SKIPS:
        q = quant.rtn(m, 8, "channel")
        q.act = (8, "tensor")
        q.act_skip = {n for n in m.W if SKIPS[skip](n)}
        run("int8-skip", q, act="tensor", skip=skip, n_skip=len(q.act_skip))
    # SmoothQuant over calibration seeds
    for seed in (0, 1, 2):
        rec = calibrate(m, d, seed)
        for alpha in ((0.0, 0.25, 0.5, 0.75, 0.9) if seed == 0 else (0.5, 0.75)):
            for gran in ("tensor", "token"):
                run("smoothquant", quant.smoothquant(m, rec, alpha, act=(8, gran)), alpha=alpha, act=gran, seed=seed)
        if seed == 0:
            q = quant.rtn(m, 8, "channel")
            q.act = (8, "static")
            q.static_amax = {n: float(a.max()) for n, a in rec.absmax.items()}
            run("int8", q, act="static", seed=seed)
    # LLM.int8(): vector-wise INT8 with float outlier columns
    for thr in (6.0, 3.0, 12.0):
        q = quant.Quantizer()
        q.int8_threshold = thr
        run("llm.int8", q, threshold=thr)
        res["runs"][-1]["fp_column_fraction"] = float(np.mean(q.int8_cols))
        save("w8a8", res)
    # FP8 E4M3 weights and activations, per-tensor dynamic activation scale
    run("fp8-e4m3", quant.w8a8_fp8(m), act="tensor")


def _b64(a, dtype):
    import base64
    if dtype == "bf16":  # exact for the released bfloat16 weights
        u = (np.ascontiguousarray(a, np.float32).view(np.uint32) >> 16).astype("<u2")
    else:
        u = np.ascontiguousarray(a, "<f2").view("<u2")
    return base64.b64encode(u.tobytes()).decode()


def stage_figure():
    """Record one linear's real inputs and weights for the in-browser figure:
    the first FIG_TOKENS encoder tokens of the first evaluation window at
    FIG_LINEAR, FIG_COLS evenly spaced output columns of its weight, and the
    per-channel input max over the seed-0 calibration windows (SmoothQuant's
    statistic)."""
    import sentencepiece as spm

    d = data.load(TEXT_DIR, SPM)
    m = model("base")
    name = os.environ.get("FIG_LINEAR", "enc.8.ffn.wo")
    toks = int(os.environ.get("FIG_TOKENS", "24"))
    cols = int(os.environ.get("FIG_COLS", "16"))
    rec = calibrate(m, d, seed=0)
    captured = {}

    class Grab(quant.Quantizer):
        def linear(self, model, n, x):
            if n == name and n not in captured:
                captured[n] = x[0, :toks].copy()
            return x @ model.W[n]

    m.quant = Grab()
    inp, tgt = d["eval"]
    m.nll(inp[:1], tgt[:1])
    m.quant = None
    X = captured[name].astype(np.float16).astype(np.float32)
    W = m.W[name]
    pick = np.linspace(0, W.shape[1] - 1, cols).round().astype(int)
    sp = spm.SentencePieceProcessor(model_file=SPM)
    out = {
        "linear": name,
        "model": "t5.1.1.lm100k.base",
        "tokens": [sp.id_to_piece(int(i)).replace("\u2581", " ") for i in inp[0, :toks]],
        "n_in": int(W.shape[0]),
        "cols": pick.tolist(),
        "x_f16": _b64(X, "f16"),
        "w_bf16": _b64(W[:, pick], "bf16"),
        "w_rowmax_bf16": _b64(np.abs(W).max(axis=1), "bf16"),
        "cal_absmax_f16": _b64(rec.absmax[name].astype(np.float32), "f16"),
    }
    path = os.environ.get("FIG_OUT", "outlier-layer.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path), "bytes")


def stage_rows():
    """Which tokens carry the giant values: for the first 16 evaluation
    windows, every token row whose input to the given wo layers has a value
    above 500, with its token and its largest channel."""
    import collections
    import sentencepiece as spm

    d = data.load(TEXT_DIR, SPM)
    m = model("base")
    sp = spm.SentencePieceProcessor(model_file=SPM)
    names = ("enc.8.ffn.wo", "enc.11.ffn.wo")
    grabbed = {}

    class Grab(quant.Quantizer):
        def linear(self, model, n, x):
            if n in names:
                grabbed[n] = x.copy()
            return x @ model.W[n]

    inp, tgt = d["eval"]
    m.quant = Grab()
    m.nll(inp[:16], tgt[:16])
    m.quant = None
    res = {}
    for n, x in grabbed.items():
        big = np.argwhere(np.abs(x).max(-1) > 500)
        res[n] = {
            "rows": int(x.shape[0] * x.shape[1]),
            "rows_above_500": len(big),
            "tokens": collections.Counter(sp.id_to_piece(int(inp[b, t])) for b, t in big).most_common(),
            "top_channel": collections.Counter(int(np.argmax(np.abs(x[b, t]))) for b, t in big).most_common(),
        }
        print(n, res[n], flush=True)
    save("rows", res)


if __name__ == "__main__":
    stage = sys.argv[1]
    {"outliers": lambda: stage_outliers(sys.argv[2]), "weights": stage_weights, "calibrated": stage_calibrated,
     "w8a8": stage_w8a8, "figure": stage_figure, "rows": stage_rows}[stage]()
