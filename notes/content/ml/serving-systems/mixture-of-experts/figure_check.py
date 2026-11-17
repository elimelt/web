"""Independent numpy reference for the RouterLoad figure. Decodes the
router-*.json files and computes, for a set of settings, each traffic pool's
per-expert share and the expected fraction of tokens dropped:

- independent tokens: exact, E[sum_i (n_i - C)+] / B with n_i ~ Binomial(B, f_i);
- whole sequences: Monte Carlo mean and standard error over 20000 batches.

The figure's test (quartz-site/plugins/mdx/test/router-load.test.mjs) checks its
TypeScript model against figure-check.json.

usage: python3 figure_check.py   (run from this directory; needs numpy, scipy)
"""
import base64, json, math
import numpy as np
from scipy.stats import binom

DOMS = ["prose", "code", "shakespeare", "math"]


def load(path):
    d = json.load(open(path))
    ch = {k: np.frombuffer(base64.b64decode(v), np.uint8) for k, v in d["domains"].items()}
    return d, ch


def windows(d, ch, traffic):
    doms = DOMS if traffic == "mixed" else [traffic]
    return np.concatenate([ch[k].reshape(-1, d["win"]) for k in doms])


def cap(c, B, N):
    return math.ceil(round(c * B / N, 9))


def exact(f, B, c):
    C = cap(c, B, len(f))
    n = np.arange(C + 1, B + 1)
    return float(sum((binom.pmf(n, B, fi) * (n - C)).sum() for fi in f if fi > 0)) / B


def mc_sequences(W, B, c, N, rng, R=20000):
    C = cap(c, B, N)
    win = W.shape[1]
    out = np.empty(R)
    for r in range(R):
        if B < win:
            w = rng.integers(len(W)); s = rng.integers(0, win - B + 1)
            x = W[w, s:s + B]
        else:
            x = W[rng.choice(len(W), B // win, replace=False)].ravel()
        out[r] = np.maximum(np.bincount(x, minlength=N) - C, 0).sum() / B
    return float(out.mean()), float(out.std() / math.sqrt(R))


cases = []
rng = np.random.default_rng(3)
for model, layer, traffic, B, c in [
    ("e8", 11, "mixed", 256, 1.25), ("e8", 11, "code", 1024, 1.25), ("e8", 11, "mixed", 16, 1.0),
    ("e8", 1, "math", 64, 1.5), ("e8", 7, "prose", 4096, 1.1),
    ("e64", 11, "mixed", 4096, 1.25), ("e64", 7, "shakespeare", 256, 2.0), ("e64", 1, "code", 64, 1.0),
]:
    d, ch = load(f"router-{model}-layer{layer}.json")
    N = d["N"]
    W = windows(d, ch, traffic)
    f = np.bincount(W.ravel(), minlength=N) / W.size
    m, se = mc_sequences(W, B, c, N, rng, R=4000 if B >= 1024 else 20000)
    cases.append({"model": model, "layer": layer, "traffic": traffic, "batch": B, "cf": c, "C": cap(c, B, N),
                  "pool": f.tolist(), "tokensDrop": exact(f, B, c), "sequencesDrop": m, "sequencesSE": se})
json.dump(cases, open("figure-check.json", "w"), indent=1)
for k in cases:
    print(k["model"], k["layer"], k["traffic"], k["batch"], k["cf"], "C", k["C"], "tokens %.4f sequences %.4f±%.4f" % (k["tokensDrop"], k["sequencesDrop"], k["sequencesSE"]))
