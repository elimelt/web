"""Summarize the fan-out runs written by run.sh into results.json.

python3 analyze.py              -> writes results.json and prints the tables
python3 analyze.py p95 DIR K    -> prints the pooled leaf p95 at fan-out K, in us
"""
import glob
import json
import os
import re
import sys

import numpy as np

QS = [50, 90, 95, 99, 99.9]


def load(prefix):
    root = np.fromfile(prefix + ".root", dtype="<i4") / 1e3  # microseconds
    leaf = np.fromfile(prefix + ".leaf", dtype="<i4") / 1e3
    meta = json.load(open(prefix + ".meta.json"))
    return root, leaf.reshape(len(root), -1), meta


def icc(leaf):
    """Intraclass correlation of log leaf latency within a root request: the
    share of its variance explained by which request a leaf belonged to
    (one-way ANOVA estimator). 0 for independent leaves."""
    k = leaf.shape[1]
    if k < 2:
        return None
    x = np.log(leaf)
    within = x.var(1, ddof=1).mean()
    between = x.mean(1).var(ddof=1) - within / k
    return float(between / (between + within))


def max_quantile(leaf_samples, k, q):
    """Quantile q (percent) of the max of k independent draws from the
    empirical distribution of leaf_samples: F_max = F^k, so the q-quantile of
    the max is the (q/100)^(1/k) quantile of one draw."""
    return float(np.quantile(leaf_samples, (q / 100) ** (1 / k)))


# Log-spaced histogram bins for the figure: 10 us to 20 ms, 60 per decade.
LO, HI, PER_DECADE = 10.0, 20000.0, 60


def figure_data(runs):
    """Pooled per-leaf and root latency histograms of the unhedged runs, which
    the page's figure replays (fanout-figure.json)."""
    nb = int(np.ceil(np.log10(HI / LO) * PER_DECADE))
    edges = LO * 10 ** (np.arange(nb + 1) / PER_DECADE)
    fig = {"lo": LO, "perDecade": PER_DECADE, "bins": nb, "fanouts": {}}
    for group, rs in runs.items():
        k = rs[0][2]["k"]
        if rs[0][2]["hedge_us"]:
            continue
        leaf = np.concatenate([l.ravel() for _, l, _ in rs])
        root = np.concatenate([r for r, _, _ in rs])
        hist = lambda x: np.histogram(np.clip(x, LO, HI * 0.999999), edges)[0].astype(int).tolist()
        fig["fanouts"][str(k)] = {"leaf": hist(leaf), "root": hist(root),
                                  "leafN": int(leaf.size), "rootN": int(root.size)}
    json.dump(fig, open("fanout-figure.json", "w"), separators=(",", ":"))


def main(d="runs"):
    runs = {}
    for meta_path in sorted(glob.glob(os.path.join(d, "*.meta.json"))):
        prefix = meta_path[: -len(".meta.json")]
        name = os.path.basename(prefix)
        group, seed = re.match(r"(.*)-s(\d+)$", name).groups()
        runs.setdefault(group, []).append(load(prefix))

    # single-leaf distribution of each seed's k=1 run, by seed
    base = {m["seed"]: leaf.ravel() for _, leaf, m in runs["k1"]}
    out = {"quantiles": QS, "groups": {}}
    for group, rs in runs.items():
        k = rs[0][2]["k"]
        g = {"k": k, "hedge_us": rs[0][2]["hedge_us"], "seeds": []}
        for root, leaf, meta in rs:
            g["seeds"].append({
                "root": [float(np.percentile(root, q)) for q in QS],
                "leaf": [float(np.percentile(leaf, q)) for q in QS],
                # order statistics of the single-leaf (k=1) distribution
                "pred_k1": [max_quantile(base[meta["seed"]], k, q) for q in QS],
                # order statistics of this run's own leaf distribution
                "pred_same": [max_quantile(leaf.ravel(), k, q) for q in QS],
                "frac_root_over_leaf1_p99": float(np.mean(root > np.percentile(base[meta["seed"]], 99))),
                "icc_log_leaf": icc(leaf),
                "send_spread_us": meta["mean_send_spread_ns"] / 1e3,
                "hedge_frac": meta["hedges"] / (len(root) * k),
            })
        for key in ["root", "leaf", "pred_k1", "pred_same"]:
            a = np.array([s[key] for s in g["seeds"]])
            g[key] = {"mean": a.mean(0).tolist(), "sd": a.std(0, ddof=1).tolist()}
        g["frac_root_over_leaf1_p99"] = float(np.mean([s["frac_root_over_leaf1_p99"] for s in g["seeds"]]))
        g["hedge_frac"] = float(np.mean([s["hedge_frac"] for s in g["seeds"]]))
        out["groups"][group] = g
    json.dump(out, open("results.json", "w"), indent=1)
    figure_data(runs)
    for group, g in out["groups"].items():
        f = lambda key: " ".join(f"{m:7.0f}±{s:<4.0f}" for m, s in zip(g[key]["mean"], g[key]["sd"]))
        ic = [s["icc_log_leaf"] for s in g["seeds"]]
        print(f"{group:12s} icc={ic}")
        print(f"{group:12s} hedged={g['hedge_frac']:.3f} over_leaf1_p99={g['frac_root_over_leaf1_p99']:.3f}")
        for key in ["leaf", "pred_k1", "pred_same", "root"]:
            print(f"   {key:9s} {f(key)}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "p95":
        d, k = sys.argv[2], int(sys.argv[3])
        leaf = np.concatenate([load(p[:-10])[1].ravel() for p in glob.glob(f"{d}/k{k}-s*.meta.json")])
        print(int(round(np.percentile(leaf, 95))))
    else:
        main(*sys.argv[1:])
