"""Summarizes parallelism/zero-runs/*.json into parallelism/zero-results.json.

Run from notes/: python3 content/ml/serving-systems/parallelism/zero_summarize.py

Bytes are normalized by 4*psi (one float32 copy of the parameters). For each
strategy, every quantity is averaged over the measured (non-warm-up) steps
and the four ranks of one launch; the spread is over launches (seeds).
"""

import json
import pathlib
import statistics as st

HERE = pathlib.Path(__file__).resolve().parent
STRATS = ["dp", "zero1", "zero2", "zero3"]
N = 4


def formula(s):
    # FP32 parameters and gradients (4 bytes each), Adam momentum and
    # variance (8 bytes), no separate master copy. ZeRO's mixed-precision
    # accounting is 2 + 2 + K with K = 12 instead of 4 + 4 + 8.
    p, g, o = 4, 4, 8
    return {
        "dp": {"param": p, "grad": g, "opt": o},
        "zero1": {"param": p, "grad": g, "opt": o / N},
        "zero2": {"param": p, "grad": g / N, "opt": o / N},
        "zero3": {"param": p / N, "grad": g / N, "opt": o / N},
    }[s]


def ring_volume(s):
    """Bytes sent per rank per step / 4psi for bandwidth-optimal ring
    collectives with ZeRO's algorithms (Rajbhandari et al., Section 7)."""
    f = (N - 1) / N
    return {"dp": 2 * f, "zero1": 2 * f, "zero2": 2 * f, "zero3": 3 * f}[s]


PAPER_VOLUME = {"dp": 2, "zero1": 2, "zero2": 2, "zero3": 3}  # x psi elements


def ms(xs):
    return {"mean": st.mean(xs), "sd": st.stdev(xs) if len(xs) > 1 else 0.0, "min": min(xs), "max": max(xs), "n": len(xs)}


def main():
    runs = {s: sorted((HERE / "zero-runs").glob(f"{s}-*.json")) for s in STRATS}
    out = {"world": N, "strategies": {}}
    losses = {}
    for s in STRATS:
        per_run = {k: [] for k in ["sent", "logical", "seconds", "param", "grad", "opt", "peak_param", "rss_delta"]}
        rank_opt = []
        ops = None
        for path in runs[s]:
            d = json.loads(path.read_text())
            psi = d["ranks"][0]["psi"]
            unit = 4 * psi
            out["psi"] = psi
            out["config"] = {k: v for k, v in d["config"].items() if k not in ("strategy", "seed")}
            out["torch"] = d["torch"]
            vals = {k: [] for k in per_run}
            for r in d["ranks"]:
                recs = [x for x in r["records"] if not x["warmup"]]
                for x in recs:
                    vals["sent"].append(x["bytes_sent"] / unit)
                    # ZeRO's accounting (Section 7): an AllReduce of psi
                    # elements moves 2 psi, an AllGather, ReduceScatter or
                    # Broadcast of psi elements moves psi.
                    vals["logical"].append(sum(b * (2 if op == "all_reduce" else 1) for op, (_, b) in x["collectives"].items()) / unit)
                    vals["seconds"].append(x["seconds"])
                    vals["param"].append(x["param_bytes"] / unit * 4)
                    vals["grad"].append(x["grad_bytes"] / unit * 4)
                    vals["opt"].append(x["optimizer_bytes"] / unit * 4)
                    vals["peak_param"].append(x["peak_param_bytes"] / unit * 4)
                vals["rss_delta"].append((r["peak_rss"] - r["rss_after_build"]) / 2**20)
                rank_opt.append(recs[-1]["optimizer_bytes"] / unit * 4)
                ops = {k: [v[0], round(v[1] / unit, 4)] for k, v in recs[-1]["collectives"].items()}
            for k in per_run:
                per_run[k].append(st.mean(vals[k]))
            losses.setdefault(d["seed"], {})[s] = d["ranks"][0]["records"][-1]["loss"]
        f = formula(s)
        out["strategies"][s] = {
            "runs": len(runs[s]),
            # Bytes per parameter (multiply by psi for bytes).
            "param_bytes_per_psi": ms(per_run["param"]),
            "grad_bytes_per_psi": ms(per_run["grad"]),
            "optimizer_bytes_per_psi": ms(per_run["opt"]),
            "optimizer_bytes_per_psi_by_rank": [min(rank_opt), max(rank_opt)],
            "peak_param_bytes_per_psi": ms(per_run["peak_param"]),
            "formula_bytes_per_psi": f | {"total": sum(f.values())},
            "sent_over_4psi": ms(per_run["sent"]),
            "zero_paper_volume_over_psi": ms(per_run["logical"]),
            "ring_prediction_over_4psi": ring_volume(s),
            "zero_paper_prediction_over_psi": PAPER_VOLUME[s],
            "collectives_last_step": ops,
            "step_seconds": ms(per_run["seconds"]),
            "peak_rss_minus_after_build_MiB": ms(per_run["rss_delta"]),
        }
    out["final_loss_by_seed"] = losses
    out["max_loss_difference_across_strategies"] = max(max(v.values()) - min(v.values()) for v in losses.values())
    coll = HERE / "collective-bytes.json"
    if coll.exists():
        out["gloo_collective_sent_over_S"] = json.loads(coll.read_text())["sent_over_S"][0] | {
            "broadcast_from_0_by_rank": [r["broadcast_from_0"][0] for r in json.loads(coll.read_text())["sent_over_S"]]
        }
    (HERE / "zero-results.json").write_text(json.dumps(out, indent=1))
    for s, v in out["strategies"].items():
        print(
            s,
            "params %.3f grads %.3f opt %.3f peak-param %.3f B/psi;" % tuple(v[k]["mean"] for k in ["param_bytes_per_psi", "grad_bytes_per_psi", "optimizer_bytes_per_psi", "peak_param_bytes_per_psi"]),
            "sent %.4f±%.4f (ring %.3f, paper-units volume %.3f psi) x4psi;" % (v["sent_over_4psi"]["mean"], v["sent_over_4psi"]["sd"], v["ring_prediction_over_4psi"], v["zero_paper_volume_over_psi"]["mean"]),
            "step %.2f±%.2f s; rss +%.0f±%.0f MiB" % (v["step_seconds"]["mean"], v["step_seconds"]["sd"], v["peak_rss_minus_after_build_MiB"]["mean"], v["peak_rss_minus_after_build_MiB"]["sd"]),
        )
    print("max loss difference across strategies", out["max_loss_difference_across_strategies"])


if __name__ == "__main__":
    main()
