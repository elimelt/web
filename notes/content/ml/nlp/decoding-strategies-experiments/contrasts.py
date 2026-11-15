"""Paired bootstrap contrasts quoted in the note (same resampling as analyze.py).
    python3 contrasts.py results.jsonl.gz > contrasts.txt"""
import gzip, json, sys
from collections import defaultdict
import numpy as np
from sacrebleu.metrics import BLEU

opener = gzip.open if sys.argv[1].endswith(".gz") else open
rows = [json.loads(l) for l in opener(sys.argv[1], "rt", encoding="utf-8")]
by = defaultdict(dict)
for r in rows:
    by[r["line"]][r["k"]] = r
lines = sorted(by, key=lambda l: by[l][1]["rank"])
refs = [l.rstrip("\n") for l in open("data/newstest2021.en-de.ref.A.de", encoding="utf-8")]
R = [refs[l] for l in lines]
bleu = BLEU()
boot = np.random.default_rng(1).integers(0, len(lines), size=(1000, len(lines)))
stats = lambda rule, k: np.array(bleu._extract_corpus_statistics([by[l][k][rule]["text"] for l in lines], [R]), dtype=np.int64)
score = lambda s: bleu._compute_score_from_stats(list(s)).score
for (r1, k1), (r2, k2) in [(("raw", 100), ("raw", 2)), (("norm", 100), ("raw", 100)), (("norm", 100), ("norm", 5)), (("gnmt0.6", 100), ("raw", 100))]:
    a, b = stats(r1, k1), stats(r2, k2)
    d = np.array([score(x) - score(y) for x, y in zip(a[boot].sum(1), b[boot].sum(1))])
    print(f"{r1}@{k1} - {r2}@{k2}: {score(a.sum(0)) - score(b.sum(0)):+.2f} [{np.percentile(d, 2.5):+.2f}, {np.percentile(d, 97.5):+.2f}]")
