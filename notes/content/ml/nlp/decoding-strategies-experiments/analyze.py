"""Summarize results.jsonl: BLEU, length ratio and short-output rates by beam width.

    python3 analyze.py results.jsonl.gz > summary.json

Only sentences with every width present are used. Confidence intervals are
95% percentile intervals from 1,000 bootstrap resamples of sentences (seed 1),
computed from sacrebleu's per-sentence n-gram statistics. Differences from\ngreedy decoding (width 1) are paired: both systems on the same resamples.
"""
import gzip, json, sys
from collections import defaultdict
import numpy as np
from sacrebleu.metrics import BLEU

RULES = ["raw", "norm", "gnmt0.2", "gnmt0.6"]
opener = gzip.open if sys.argv[1].endswith(".gz") else open
rows = [json.loads(l) for l in opener(sys.argv[1], "rt", encoding="utf-8")]
by = defaultdict(dict)
for r in rows:
    by[r["line"]][r["k"]] = r
widths = sorted({r["k"] for r in rows})
lines = [l for l, d in by.items() if all(k in d for k in widths)]
lines.sort(key=lambda l: by[l][widths[0]]["rank"])
refs = [l.rstrip("\n") for l in open("data/newstest2021.en-de.ref.A.de", encoding="utf-8")]
R = [refs[l] for l in lines]
bleu = BLEU()
rng = np.random.default_rng(1)
B = 1000
boot = rng.integers(0, len(lines), size=(B, len(lines)))

def score(stats):
    return bleu._compute_score_from_stats(list(stats)).score

def paired(st, base):
    """BLEU(st) - BLEU(base) on the same bootstrap resamples."""
    a, b = st[boot].sum(1), base[boot].sum(1)
    d = np.array([score(x) - score(y) for x, y in zip(a, b)])
    return [round(float(np.percentile(d, 2.5)), 2), round(float(np.percentile(d, 97.5)), 2)]

out = {"n_sentences": len(lines), "widths": widths, "bootstrap": B, "results": {}}
for rule in RULES:
    res = []
    base = None
    for k in widths:
        hyps = [by[l][k][rule]["text"] for l in lines]
        st = np.array(bleu._extract_corpus_statistics(hyps, [R]), dtype=np.int64)
        tot = st.sum(0)
        if base is None:
            base = st
        bs = st[boot].sum(1)
        bl = np.array([score(x) for x in bs])
        ratio = bs[:, 0] / bs[:, 1]
        res.append({
            "k": k,
            "bleu": round(score(tot), 2),
            "bleu_ci": [round(float(np.percentile(bl, 2.5)), 2), round(float(np.percentile(bl, 97.5)), 2)],
            "delta_vs_greedy": round(score(tot) - score(base.sum(0)), 2),
            "delta_ci": paired(st, base),
            "ratio": round(float(tot[0] / tot[1]), 3),
            "ratio_ci": [round(float(np.percentile(ratio, 2.5)), 3), round(float(np.percentile(ratio, 97.5)), 3)],
            "empty": int(sum(1 for h in hyps if not h.strip())),
            "under_half_ref": int(sum(1 for s in st if s[0] < 0.5 * s[1])),
            "mean_logp": round(float(np.mean([by[l][k][rule]["logp"] for l in lines])), 3),
            "mean_len": round(float(np.mean([by[l][k][rule]["len"] for l in lines])), 2),
        })
    out["results"][rule] = res
# How often the empty translation outscores what raw-score beam search returned.
out["empty_beats_beam"] = {str(k): int(sum(1 for l in lines if by[l][k]["lp_empty"] > by[l][k]["raw"]["logp"])) for k in widths}
# Search quality: how often a wider beam returns a lower raw score than greedy decoding.
out["raw_below_greedy"] = {str(k): int(sum(1 for l in lines if by[l][k]["raw"]["logp"] < by[l][1]["raw"]["logp"] - 1e-6)) for k in widths}
out["raw_above_greedy"] = {str(k): int(sum(1 for l in lines if by[l][k]["raw"]["logp"] > by[l][1]["raw"]["logp"] + 1e-6)) for k in widths}
out["signature"] = str(bleu.get_signature())
json.dump(out, sys.stdout, indent=1)
