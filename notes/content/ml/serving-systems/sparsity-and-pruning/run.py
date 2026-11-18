"""Pruning experiments for the sparsity note, on Google's T5 v1.1 LM-adapted
checkpoints, reusing the numpy model and the Go-blog evaluation windows of the
quantization note (../quantization/{t5,data}.py).

usage:
  python3 run.py main SIZE     # dense vs magnitude / Wanda / SparseGPT at 50%, 4:8, 2:4
  python3 run.py sweep         # base: perplexity vs sparsity 10..80%
  python3 run.py sublayer      # base: prune one kind of linear at a time, 50%
  python3 run.py sequential    # base: Wanda with statistics from the already-pruned model
  python3 run.py figure        # one real layer's weights and inputs for the figure

Environment: MODEL_DIR (.npz from ../quantization/convert.py), TEXT_DIR
(../quantization/prep_text.py output), SPM (T5's sentencepiece model), OUT_DIR.
"""
from __future__ import annotations

import json
import os
import platform
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "quantization"))
import data  # noqa: E402
import quant  # noqa: E402
import t5  # noqa: E402

import prune  # noqa: E402

MODEL_DIR = os.environ.get("MODEL_DIR", "/home/claude/pwork")
TEXT_DIR = os.environ.get("TEXT_DIR", "/home/claude/pwork/text")
SPM = os.environ.get("SPM", "/home/claude/pwork/ckpt/spm.model")
OUT = os.environ.get("OUT_DIR", "/home/claude/pwork/out")
BATCH = 16
N_CAL = 128  # calibration windows (128 x 193 tokens), drawn from the 41 calibration posts
SEEDS = tuple(int(s) for s in os.environ.get("SEEDS", "0,1,2").split(","))


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


def with_weights(m, W):
    q = quant.Quantizer()
    q.W = W
    return q


def evaluate(m, W, d, base, sets=("eval", "shakespeare")):
    m.quant = with_weights(m, W) if W is not None else None
    out = {s: summarize(window_nll(m, *d[s]), base.get(s)) for s in sets}
    m.quant = None
    return out


def calibrate(m, d, seed, hessian=False, weights=None):
    rec = quant.Recorder(hessian=hessian, seed=seed)
    q = with_weights(m, weights or {})
    q.record = rec
    m.quant = q
    ci, ct = data.calibration(d, N_CAL, seed)
    window_nll(m, ci, ct)
    m.quant = None
    return rec


def share_key(name):
    """Linears that read the same input share one Gram matrix: q/k/v of
    self-attention, k/v of cross-attention (the encoder output) and wi_0/wi_1.
    Returns the shared key and whether this linear is the one that adds to it."""
    side, i, kind, m = name.split(".")
    if kind == "attn" and m in "qkv":
        return f"{side}.{i}.attn.qkv", m == "q"
    if kind == "cross" and m in "kv":
        return f"{side}.{i}.cross.kv", m == "k"
    if kind == "ffn" and m.startswith("wi_"):
        return f"{side}.{i}.ffn.wi", m == "wi_0"
    return name, True


class LowMemRecorder(quant.Recorder):
    """Recorder whose Gram matrices X^T X are stored once per distinct input
    and in float32 (each batch's product is formed in float64), so that
    large's calibration fits in memory; base and small use quant.Recorder."""

    def __init__(self, seed=0):
        super().__init__(hessian=False, seed=seed)
        self.Hk = {}

    def see(self, name, x):
        super().see(name, x)
        key, first = share_key(name)
        if first:
            f = x.reshape(-1, x.shape[-1]).astype(np.float64)
            g = (f.T @ f).astype(np.float32)
            if key in self.Hk:
                self.Hk[key] += g
            else:
                self.Hk[key] = g

    def finish(self):
        self.H = {n: self.Hk[share_key(n)[0]] for n in self.sumsq}
        return self


def calibrate_lowmem(m, d, seed):
    rec = LowMemRecorder(seed=seed)
    q = with_weights(m, {})
    q.record = rec
    m.quant = q
    ci, ct = data.calibration(d, N_CAL, seed)
    window_nll(m, ci, ct)
    m.quant = None
    return rec.finish()


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


def setup(size, sets=("eval", "shakespeare")):
    d = data.load(TEXT_DIR, SPM)
    m = t5.Model(f"{MODEL_DIR}/{size}.npz")
    base = {s: window_nll(m, *d[s]) for s in sets}
    dense = {s: summarize(base[s]) for s in sets}
    print(size, "dense", dense, flush=True)
    return d, m, base, dense


def run_one(res, name, m, d, base, label, W, sets=("eval", "shakespeare"), **extra):
    t = time.time()
    r = evaluate(m, W, d, base, sets)
    row = {"label": label, **extra, "density": prune.density(W), **r, "eval_seconds": time.time() - t}
    res["runs"].append(row)
    print(label, extra, {k: (round(v["ppl"], 3), round(v.get("dppl_pct", 0), 2)) for k, v in r.items()}, flush=True)
    save(name, res)


# ---- stages ------------------------------------------------------------------
def stage_main(size):
    # large is ~3x slower than base; it is scored on the Go-blog windows only
    sets = ("eval",) if size == "large" else ("eval", "shakespeare")
    d, m, base, dense = setup(size, sets)
    name = f"main-{size}"
    res = {"size": size, "dense": dense, "n_eval": len(d["eval"][0]), "n_cal": N_CAL, "runs": []}
    resume = os.environ.get("RESUME") and os.path.exists(f"{OUT}/{name}.json")
    if resume:  # keep the magnitude rows of an earlier run
        res["runs"] = [r for r in json.load(open(f"{OUT}/{name}.json"))["runs"] if r["label"] == "magnitude"]
    for sp in ("0.5", "4:8", "2:4"):
        if resume:
            break
        for group in ("layer", "output"):
            if ":" in sp and group == "layer":
                continue
            t = time.time()
            W = None  # free the previous model's weights first (large)
            W = prune.prune_all(m, "magnitude", sp, group)
            run_one(res, name, m, d, base, "magnitude", W, sets, sparsity=sp, group=group, seed=None,
                    prune_seconds=time.time() - t)
    for seed in SEEDS:
        t = time.time()
        rec = calibrate_lowmem(m, d, seed) if size == "large" else calibrate(m, d, seed, hessian=True)
        cal_s = time.time() - t
        for sp in ("0.5", "4:8", "2:4"):
            for group in ("output", "layer"):
                if ":" in sp and group == "layer":
                    continue
                t = time.time()
                W = None  # free the previous model's weights first (large)
                W = prune.prune_all(m, "wanda", sp, group, rec)
                run_one(res, name, m, d, base, "wanda", W, sets, sparsity=sp, group=group, seed=seed,
                        prune_seconds=time.time() - t, calibration_seconds=cal_s)
            t = time.time()
            W = None  # free the previous model's weights first (large)
            W = prune.prune_all(m, "sparsegpt", sp, rec=rec)
            run_one(res, name, m, d, base, "sparsegpt", W, sets, sparsity=sp, group="block128", seed=seed,
                    prune_seconds=time.time() - t, calibration_seconds=cal_s)
        del rec


def stage_sweep():
    d, m, base, dense = setup("base", sets=("eval",))
    res = {"size": "base", "dense": dense, "runs": []}
    rec = calibrate(m, d, 0, hessian=True)
    for s in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
        sp = f"{s:.1f}"
        run_one(res, "sweep", m, d, base, "magnitude", prune.prune_all(m, "magnitude", sp, "output"), ("eval",), sparsity=s)
        run_one(res, "sweep", m, d, base, "magnitude-layer", prune.prune_all(m, "magnitude", sp, "layer"), ("eval",), sparsity=s)
        run_one(res, "sweep", m, d, base, "wanda", prune.prune_all(m, "wanda", sp, "output", rec), ("eval",), sparsity=s)
        run_one(res, "sweep", m, d, base, "sparsegpt", prune.prune_all(m, "sparsegpt", sp, rec=rec), ("eval",), sparsity=s)


KINDS = {
    "attn.qkv": lambda n: n.split(".")[2] in ("attn", "cross") and n.split(".")[3] in ("q", "k", "v"),
    "attn.o": lambda n: n.endswith((".attn.o", ".cross.o")),
    "ffn.wi": lambda n: n.endswith((".wi_0", ".wi_1")),
    "ffn.wo": lambda n: n.endswith(".ffn.wo"),
}


def stage_sublayer():
    d, m, base, dense = setup("base", sets=("eval",))
    res = {"size": "base", "dense": dense, "runs": []}
    rec = calibrate(m, d, 0)
    for method in ("magnitude", "wanda"):
        full = prune.prune_all(m, method, "0.5", "output", rec)
        for kind, sel in KINDS.items():
            W = {n: (w if sel(n) else m.W[n]) for n, w in full.items()}
            share = sum(m.W[n].size for n in m.W if sel(n)) / sum(w.size for w in m.W.values())
            run_one(res, "sublayer", m, d, base, method, W, ("eval",), kind=kind, param_share=share)


def stage_sequential():
    """Wanda's reference code prunes block by block, taking each block's input
    statistics from the model whose earlier blocks are already pruned. Here:
    encoder blocks in order, then decoder blocks; one calibration pass per block."""
    d, m, base, dense = setup("base", sets=("eval",))
    res = {"size": "base", "dense": dense, "runs": []}
    for sp in ("0.5",):
        t = time.time()
        W = {}
        for side, n in (("enc", m.n_enc), ("dec", m.n_dec)):
            for i in range(n):
                rec = calibrate(m, d, 0, weights=W)
                for name in m.W:
                    if name.startswith(f"{side}.{i}."):
                        S = prune.score("wanda", m.W[name], rec.sumsq[name])
                        W[name] = np.where(prune.mask_from_score(S, sp), m.W[name], 0).astype(np.float32)
        run_one(res, "sequential", m, d, base, "wanda-sequential", W, ("eval",), sparsity=sp,
                prune_seconds=time.time() - t)


def stage_paired():
    """Paired bootstrap of Wanda against SparseGPT on the same windows, seed 0,
    in domain (Go blog) and out of domain (Shakespeare)."""
    sets = ("eval", "shakespeare")
    d, m, base, dense = setup("base", sets)
    rec = calibrate(m, d, 0, hessian=True)
    res = {"size": "base", "dense": dense, "runs": []}
    rng = np.random.default_rng(0)
    for sp in ("0.5", "2:4"):
        nll = {}
        for method in ("wanda", "sparsegpt"):
            W = prune.prune_all(m, method, sp, "output", rec)
            m.quant = with_weights(m, W)
            nll[method] = {s: window_nll(m, *d[s]) for s in sets}
            m.quant = None
        for s in sets:
            diff = nll["wanda"][s] - nll["sparsegpt"][s]  # log of the perplexity ratio, per window
            boots = np.array([diff[rng.integers(0, len(diff), len(diff))].mean() for _ in range(2000)])
            row = {"sparsity": sp, "set": s, "n": int(len(diff)),
                   "wanda_over_sparsegpt_pct": float((np.exp(diff.mean()) - 1) * 100),
                   "ci": [float((np.exp(np.percentile(boots, q)) - 1) * 100) for q in (2.5, 97.5)],
                   "windows_wanda_better": float((diff < 0).mean())}
            res["runs"].append(row)
            print(row, flush=True)
        save("paired", res)


def stage_figure():
    """Pruning statistics for the in-browser figure, which reuses the
    quantization note's recorded layer (../quantization/outlier-layer.json:
    24 encoder tokens of the first evaluation window at enc.8.ffn.wo and 16 of
    the layer's 768 output columns). Adds what pruning needs: the RMS of each
    input channel over the seed-0 calibration windows (Wanda's ||X_j||, up to
    a constant factor), rounded to float16 as the browser receives it, and,
    for whole-layer comparison groups, the score threshold over the full
    2048 x 768 matrix at each sparsity from 0 to 95% in steps of 5%."""
    d = data.load(TEXT_DIR, SPM)
    m = t5.Model(f"{MODEL_DIR}/base.npz")
    name = "enc.8.ffn.wo"
    rec = calibrate(m, d, 0)
    rms = np.sqrt(rec.sumsq[name] / rec.count[name]).astype(np.float16)
    W = m.W[name]
    grid = [round(0.05 * i, 2) for i in range(20)]
    thr = {}
    for method, S in (("magnitude", np.abs(W)), ("wanda", np.abs(W) * rms.astype(np.float64)[:, None])):
        flat = np.sort(S.ravel())
        thr[method] = [float(flat[int(flat.size * s) - 1]) if s > 0 else -1.0 for s in grid]
    out = {
        "linear": name,
        "model": "t5.1.1.lm100k.base",
        "n_cal_tokens": int(rec.count[name]),
        "rms_f16": [float(v) for v in rms],
        "grid": grid,
        "layer_threshold": thr,
    }
    path = os.environ.get("FIG_OUT", os.path.join(HERE, "prune-layer.json"))
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    stage = sys.argv[1]
    if stage == "main":
        stage_main(sys.argv[2])
    else:
        globals()[f"stage_{stage}"]()
