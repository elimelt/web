"""Record the BM25 figure's data and the reference the figure is tested against.

  python figure_data.py --data DATA_DIR scan            # list candidate queries
  python figure_data.py --data DATA_DIR export QID ...  # write bm25-figure.json and bm25-figure-expected.json

For each chosen query the figure needs every document that contains at least
one analyzed query term (all others score 0), its analyzed length, and the
frequency of each query term in it. The expected file holds the top 10 and
the relevant document's rank, computed by ir_bench.BM25 over the whole
collection, at several (k1, b) settings.
"""
import argparse
import json
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, ".")
from ir_bench import BM25, analyze, first_rel_rank, load, rank, TOKEN, STOP  # noqa: E402

SETTINGS = [(0.9, 0.4), (1.2, 0.75), (0.0, 0.5), (3.0, 1.0), (2.0, 0.0), (0.5, 1.0)]
K1_GRID = [round(0.1 * i, 1) for i in range(31)]  # the figure's slider steps
B_GRID = [round(0.05 * i, 2) for i in range(21)]


def surface(query, terms):
    """A surface word for each stemmed term, taken from the query itself."""
    out = {}
    for w in TOKEN.findall(query.lower()):
        if w in STOP:
            continue
        t = analyze(w, stop=False)[0]
        out.setdefault(t, w)
    return [out.get(t, t) for t in terms]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--results", default="results.json")
    ap.add_argument("--dense", default="dense_scores.npy")
    ap.add_argument("cmd")
    ap.add_argument("qids", nargs="*")
    a = ap.parse_args()
    docs, titles, queries, qrels = load(a.data)
    qids = sorted(qrels)
    bm = BM25(docs)
    S = np.load(a.dense)
    res = json.load(open(a.results))
    pq = {x["qid"]: x for x in res["per_query"]}

    if a.cmd == "scan":
        for q in qids:
            x = pq[q]
            qt = analyze(queries[q])
            ranks_b = []
            for b in (0.0, 1.0):
                ranks_b.append(first_rel_rank(rank(bm.ids, bm.scores(queries[q], 1.2, b)), qrels[q]))
            n_slice = len({i for t in set(qt) for i, _ in bm.postings.get(t, ())})
            print(f"{q}\tbm25={x['bm25_rank']}\tdense={x['dense_rank']}\tb0={ranks_b[0]}\tb1={ranks_b[1]}\t"
                  f"terms={len(set(qt))}\tslice={n_slice}\t{queries[q]}")
        return

    presets, expected = {}, {}
    for q in a.qids:
        qt = analyze(queries[q])
        qtf = Counter(qt)
        terms = list(dict.fromkeys(qt))
        df = [len(bm.postings.get(t, ())) for t in terms]
        tfs = {}
        for j, t in enumerate(terms):
            for i, c in bm.postings.get(t, ()):
                tfs.setdefault(i, [0] * len(terms))[j] = c
        slice_idx = sorted(tfs)  # corpus order
        pos = {i: k for k, i in enumerate(slice_idx)}
        rows = [[int(bm.len[i])] + tfs[i] for i in slice_idx]
        # documents the figure can show: the top 5 at any slider setting, plus the relevant ones
        show = set()
        for k1 in K1_GRID:
            for b in B_GRID:
                s = bm.scores(queries[q], k1, b)
                show.update(int(i) for i in np.argsort(-s, kind="stable")[:5])
        rel_idx = [bm.ids.index(d) for d in sorted(qrels[q])]
        show.update(rel_idx)
        qi = qids.index(q)
        dense_rank = first_rel_rank(rank(bm.ids, S[qi]), qrels[q])
        best_rel = max(rel_idx, key=lambda i: S[qi, i])
        presets[q] = {
            "query": queries[q],
            "terms": terms,
            "words": surface(queries[q], terms),
            "qtf": [qtf[t] for t in terms],
            "df": df,
            "ids": [int(bm.ids[i]) for i in slice_idx],
            "docs": rows,
            "titles": {str(pos[i]): titles[bm.ids[i]] for i in sorted(show) if i in pos},
            "rel": [pos.get(i, -1) for i in rel_idx],
            "dense": {"rank": dense_rank, "cos": round(float(S[qi, best_rel]), 4)},
        }
        exp = []
        for k1, b in SETTINGS:
            s = bm.scores(queries[q], k1, b)
            top = np.argsort(-s, kind="stable")[:10]
            exp.append({"k1": k1, "b": b,
                        "top": [[bm.ids[i], float(s[i])] for i in top],
                        "rel_rank": first_rel_rank(rank(bm.ids, s, len(bm.ids)), qrels[q])})
        expected[q] = exp
        print(q, "slice", len(rows), "shown", len(presets[q]["titles"]), file=sys.stderr)
    data = {"N": bm.N, "avgdl": float(bm.avgdl), "presets": presets}
    json.dump(data, open("bm25-figure.json", "w"), separators=(",", ":"))
    json.dump(expected, open("bm25-figure-expected.json", "w"), indent=1)


if __name__ == "__main__":
    main()
