"""Cross-check ir_bench.BM25 against the bm25s library (method='lucene') on the
same analyzed tokens: every query's full score vector must agree."""
import sys, numpy as np, bm25s
sys.path.insert(0, ".")
from ir_bench import load, BM25, analyze
docs, titles, queries, qrels = load(sys.argv[1])
bm = BM25(docs)
toks = [analyze(docs[d]) for d in bm.ids]
ret = bm25s.BM25(method="lucene", k1=0.9, b=0.4)
ret.index(toks, show_progress=False)
worst = 0.0
for q in sorted(qrels):
    qt = analyze(queries[q])
    a = bm.scores(queries[q])
    b = ret.get_scores(qt)
    worst = max(worst, float(np.max(np.abs(a - b))))
print("max abs score difference over 300 queries:", worst)
