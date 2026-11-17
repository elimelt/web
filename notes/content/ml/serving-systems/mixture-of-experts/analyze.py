"""Router load statistics from recorded Switch-Base router logits.
usage: python analyze.py e8 [e64 ...]  -> results.json"""
import sys, json, math, numpy as np
from scipy.stats import binom

DOMS = ["prose", "code", "shakespeare", "math"]
BATCH = [16, 64, 256, 1024, 4096]
CF = [1.0, 1.25, 1.5, 2.0]
WIN = 256


def softmax(x):
    x = x - x.max(-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(-1, keepdims=True)


def cap(c, B, N):
    return math.ceil(c * B / N)


def exact_iid_drop(f, B, c):
    """E[sum_i (n_i - C)+] / B, n_i ~ Binomial(B, f_i): tokens drawn with replacement."""
    C = cap(c, B, len(f))
    tot = 0.0
    for fi in f:
        if fi == 0:
            continue
        n = np.arange(C + 1, B + 1)
        tot += float((binom.pmf(n, B, fi) * (n - C)).sum())
    return tot / B


def mc_contig_drop(choice_windows, B, c, N, rng, R=2000):
    """Prefill-like batches: whole windows (B >= 256) or one contiguous span (B < 256)."""
    W = choice_windows.shape[0]
    C = cap(c, B, N)
    out = np.empty(R)
    for r in range(R):
        if B >= WIN:
            ws = rng.choice(W, B // WIN, replace=False) if B // WIN <= W else rng.choice(W, B // WIN)
            ch = choice_windows[ws].ravel()
        else:
            w = rng.integers(W); s = rng.integers(0, WIN - B + 1)
            ch = choice_windows[w, s:s + B]
        n = np.bincount(ch, minlength=N)
        out[r] = np.maximum(n - C, 0).sum() / B
    return float(out.mean()), float(out.std()), float(np.quantile(out, 0.95))


def main(models):
    res = {}
    for E in models:
        z = np.load(f"routes_{E}.npz")
        layers = sorted({k.split("/")[1] for k in z.files if k.endswith(tuple("0123456789")) and "/enc." in k},
                        key=lambda s: int(s.split(".")[1]))
        rng = np.random.default_rng(7)
        R = {"layers": layers, "per_layer": {}}
        for L in layers:
            lg = {d: z[f"{d}/{L}"] for d in DOMS}
            N = lg[DOMS[0]].shape[1]
            ch = {d: lg[d].argmax(1) for d in DOMS}
            pr = {d: softmax(lg[d]) for d in DOMS}
            ch["mixed"] = np.concatenate([ch[d] for d in DOMS])
            pr["mixed"] = np.concatenate([pr[d] for d in DOMS])
            out = {"N": N}
            for d in DOMS + ["mixed"]:
                f = np.bincount(ch[d], minlength=N) / len(ch[d])
                P = pr[d].mean(0)
                # bootstrap over windows for spread of max/mean
                cw = ch[d].reshape(-1, WIN)
                boots = []
                for _ in range(300):
                    sel = cw[rng.integers(0, len(cw), len(cw))].ravel()
                    boots.append(N * np.bincount(sel, minlength=N).max() / len(sel))
                o = {
                    "f": f.round(5).tolist(),
                    "max_over_mean": float(N * f.max()),
                    "max_over_mean_ci": [float(np.quantile(boots, 0.025)), float(np.quantile(boots, 0.975))],
                    "cv": float(f.std() / f.mean()),
                    "aux_loss": float(N * (f * P).sum()),
                    "top_prob_mean": float(pr[d].max(1).mean()),
                    "drop_iid": {str(c): {str(B): exact_iid_drop(f, B, c) for B in BATCH} for c in CF},
                }
                if d != "mixed":
                    o["drop_contig"] = {str(c): {str(B): mc_contig_drop(cw, B, c, N, rng) for B in BATCH} for c in CF}
                out[d] = o
            fm = np.array(out["mixed"]["f"])
            for d in DOMS:
                out[d]["tv_vs_mixed"] = float(0.5 * np.abs(np.array(out[d]["f"]) - fm).sum())
            out["uniform_drop_iid"] = {str(c): {str(B): exact_iid_drop(np.full(N, 1 / N), B, c) for B in BATCH} for c in CF}
            R["per_layer"][L] = out
            print(E, L, "mixed max/mean %.2f aux %.3f" % (out["mixed"]["max_over_mean"], out["mixed"]["aux_loss"]),
                  " ".join(f"{d}:{out[d]['max_over_mean']:.2f}" for d in DOMS), flush=True)
        res[E] = R
    json.dump(res, open("results.json", "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
