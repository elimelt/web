"""BM25 versus dense retrieval on SciFact (BEIR test split = SciFact dev claims).

Data:  https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz
Model: sentence-transformers/all-MiniLM-L6-v2 exported to ONNX, from
       https://chroma-onnx-models.s3.amazonaws.com/all-MiniLM-L6-v2/onnx.tar.gz

Usage:
  python ir_bench.py --data DATA_DIR --model MODEL_DIR --out results.json

Everything is deterministic (no sampling), so variability is reported as a
paired bootstrap over queries (10,000 resamples, seed 0).
"""
import argparse
import json
import math
import re
import time
from collections import Counter, defaultdict

import numpy as np
import Stemmer

# Lucene's default English stop set (EnglishAnalyzer.ENGLISH_STOP_WORDS_SET).
STOP = set(
    "a an and are as at be but by for if in into is it no not of on or such that the their then "
    "there these they this to was will with".split()
)
_stem = Stemmer.Stemmer("english")
TOKEN = re.compile(r"[a-z0-9]+")


def analyze(text, stem=True, stop=True):
    toks = TOKEN.findall(text.lower())
    if stop:
        toks = [t for t in toks if t not in STOP]
    if stem:
        toks = _stem.stemWords(toks)
    return toks


def load(data_dir):
    corpus = [json.loads(l) for l in open(f"{data_dir}/corpus.jsonl")]
    docs = {str(d["doc_id"]): d["title"] + " " + " ".join(d["abstract"]) for d in corpus}
    titles = {str(d["doc_id"]): d["title"] for d in corpus}
    claims = [json.loads(l) for l in open(f"{data_dir}/claims_dev.jsonl")]
    queries = {str(c["id"]): c["claim"] for c in claims}
    qrels = {str(c["id"]): {str(d) for d in c["cited_doc_ids"] if str(d) in docs} for c in claims}
    return docs, titles, queries, qrels


class BM25:
    """Inverted index + BM25. variant='lucene' (Lucene/Pyserini idf, no (k1+1)
    factor, which does not change ranking) or 'slp3' (the textbook form,
    idf = log(N/df))."""

    def __init__(self, docs, stem=True, stop=True):
        self.ids = list(docs)
        self.stem, self.stop = stem, stop
        self.postings = defaultdict(list)  # term -> [(doc_index, tf)]
        self.len = np.zeros(len(self.ids))
        for i, did in enumerate(self.ids):
            toks = analyze(docs[did], stem, stop)
            self.len[i] = len(toks)
            for t, c in Counter(toks).items():
                self.postings[t].append((i, c))
        self.N = len(self.ids)
        self.avgdl = self.len.mean()

    def idf(self, t, variant):
        df = len(self.postings.get(t, ()))
        if df == 0:
            return 0.0
        if variant == "slp3":
            return math.log(self.N / df)
        return math.log(1 + (self.N - df + 0.5) / (df + 0.5))

    def scores(self, query, k1=0.9, b=0.4, variant="lucene"):
        s = np.zeros(self.N)
        for t, qtf in Counter(analyze(query, self.stem, self.stop)).items():
            post = self.postings.get(t)
            if not post:
                continue
            idx = np.fromiter((p[0] for p in post), int, len(post))
            tf = np.fromiter((p[1] for p in post), float, len(post))
            norm = k1 * (1 - b + b * self.len[idx] / self.avgdl)
            s[idx] += qtf * self.idf(t, variant) * tf / (norm + tf)
        return s


class MiniLM:
    def __init__(self, model_dir, max_len=256, threads=4):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        self.sess = ort.InferenceSession(f"{model_dir}/model.onnx", so)
        self.tok = Tokenizer.from_file(f"{model_dir}/tokenizer.json")
        self.tok.enable_truncation(max_len)
        self.tok.enable_padding(pad_id=0, pad_token="[PAD]")

    def encode(self, texts, bs=32):
        out = []
        # sort by length so padding is small
        order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
        for s in range(0, len(texts), bs):
            batch = [texts[i] for i in order[s : s + bs]]
            enc = self.tok.encode_batch(batch)
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
            h = self.sess.run(None, {"input_ids": ids, "attention_mask": mask,
                                     "token_type_ids": np.zeros_like(ids)})[0]
            m = mask[..., None].astype(np.float32)
            v = (h * m).sum(1) / np.clip(m.sum(1), 1e-9, None)  # mean pooling
            v /= np.linalg.norm(v, axis=1, keepdims=True)
            out.append(v)
        v = np.concatenate(out)
        res = np.empty_like(v)
        res[order] = v
        return res

    def n_tokens(self, texts):
        self.tok.no_truncation()
        self.tok.no_padding()
        n = [len(e.ids) for e in self.tok.encode_batch(texts)]
        return np.array(n)


def ndcg10(ranked, rel):
    dcg = sum(1 / math.log2(r + 2) for r, d in enumerate(ranked[:10]) if d in rel)
    idcg = sum(1 / math.log2(r + 2) for r in range(min(len(rel), 10)))
    return dcg / idcg


def recall_at(ranked, rel, k):
    return len(set(ranked[:k]) & rel) / len(rel)


def ap(ranked, rel):
    """TREC uninterpolated AP: divide by the number of relevant documents
    (|U|), over a ranking truncated at 1000."""
    hits, tot = 0, 0.0
    for r, d in enumerate(ranked[:1000]):
        if d in rel:
            hits += 1
            tot += hits / (r + 1)
    return tot / len(rel)


def rr(ranked, rel):
    for r, d in enumerate(ranked):
        if d in rel:
            return 1 / (r + 1)
    return 0.0


def first_rel_rank(ranked, rel):
    for r, d in enumerate(ranked):
        if d in rel:
            return r + 1
    return None


def rank(ids, s, k=1000):
    top = np.argsort(-s, kind="stable")[:k]
    return [ids[i] for i in top]


def rrf(rankings, k=60, depth=1000):
    sc = defaultdict(float)
    for rk in rankings:
        for r, d in enumerate(rk[:depth]):
            sc[d] += 1 / (k + r + 1)
    return [d for d, _ in sorted(sc.items(), key=lambda x: -x[1])]


def evaluate(runs, qrels):
    per = {}
    for name, run in runs.items():
        per[name] = {
            m: np.array([f(run[q], qrels[q]) for q in sorted(qrels)])
            for m, f in [("ndcg10", ndcg10), ("recall100", lambda a, b: recall_at(a, b, 100)),
                         ("recall1000", lambda a, b: recall_at(a, b, 1000)), ("map", ap), ("mrr", rr)]
        }
    return per


def bootstrap(a, b=None, n=10000, seed=0):
    rng = np.random.default_rng(seed)
    x = a if b is None else a - b
    idx = rng.integers(0, len(x), (n, len(x)))
    m = x[idx].mean(1)
    return float(x.mean()), float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--data", required=True)
    ap_.add_argument("--model", required=True)
    ap_.add_argument("--out", default="results.json")
    ap_.add_argument("--emb-cache", default="emb.npz")
    args = ap_.parse_args()

    docs, titles, queries, qrels = load(args.data)
    qids = sorted(qrels)
    print(f"docs {len(docs)} queries {len(qids)} judgments {sum(len(v) for v in qrels.values())}")
    res = {"n_docs": len(docs), "n_queries": len(qids),
           "n_judgments": sum(len(v) for v in qrels.values())}

    t = time.time()
    bm = BM25(docs)
    res["bm25_index_s"] = time.time() - t
    res["avgdl_terms"] = float(bm.avgdl)
    res["vocab"] = len(bm.postings)
    res["n_postings"] = sum(len(p) for p in bm.postings.values())

    runs = {}
    t = time.time()
    runs["bm25_lucene_k0.9_b0.4"] = {q: rank(bm.ids, bm.scores(queries[q])) for q in qids}
    res["bm25_query_ms"] = (time.time() - t) / len(qids) * 1000
    runs["bm25_lucene_k1.2_b0.75"] = {q: rank(bm.ids, bm.scores(queries[q], 1.2, 0.75)) for q in qids}
    runs["bm25_slp3_k1.2_b0.75"] = {q: rank(bm.ids, bm.scores(queries[q], 1.2, 0.75, "slp3")) for q in qids}
    bm_ns = BM25(docs, stem=False, stop=False)
    runs["bm25_nostem_k0.9_b0.4"] = {q: rank(bm_ns.ids, bm_ns.scores(queries[q])) for q in qids}

    # k1/b grid on nDCG@10 (diagnostic only: tuned on the test queries)
    grid = []
    for k1 in [0.0, 0.3, 0.6, 0.9, 1.2, 1.5, 2.0, 3.0]:
        for b in [0.0, 0.2, 0.4, 0.6, 0.75, 0.9, 1.0]:
            v = np.mean([ndcg10(rank(bm.ids, bm.scores(queries[q], k1, b), 10), qrels[q]) for q in qids])
            grid.append({"k1": k1, "b": b, "ndcg10": float(v)})
    res["bm25_grid"] = grid

    # dense
    enc = MiniLM(args.model)
    dtexts = [docs[d] for d in bm.ids]
    ntok = enc.n_tokens(dtexts)
    enc = MiniLM(args.model)
    res["doc_tokens_wordpiece"] = {"median": float(np.median(ntok)), "p90": float(np.percentile(ntok, 90)),
                                   "frac_over_256": float((ntok > 256).mean())}
    try:
        cache = np.load(args.emb_cache)
        D = cache["D"]
        res["dense_encode_docs_s"] = float(cache["t"])
    except FileNotFoundError:
        t = time.time()
        D = enc.encode(dtexts)
        res["dense_encode_docs_s"] = time.time() - t
        np.savez(args.emb_cache, D=D, t=res["dense_encode_docs_s"])
    t = time.time()
    Q = enc.encode([queries[q] for q in qids], bs=1)
    res["dense_encode_query_ms"] = (time.time() - t) / len(qids) * 1000
    t = time.time()
    S = Q @ D.T
    res["dense_search_ms"] = (time.time() - t) / len(qids) * 1000
    runs["dense_minilm"] = {q: rank(bm.ids, S[i]) for i, q in enumerate(qids)}
    runs["hybrid_rrf"] = {q: rrf([runs["bm25_lucene_k0.9_b0.4"][q], runs["dense_minilm"][q]]) for q in qids}
    # 128-token truncation, as in the ONNX export's tokenizer.json
    enc128 = MiniLM(args.model, max_len=128)
    D128 = enc128.encode(dtexts)
    S128 = enc128.encode([queries[q] for q in qids]) @ D128.T
    runs["dense_minilm_trunc128"] = {q: rank(bm.ids, S128[i]) for i, q in enumerate(qids)}

    per = evaluate(runs, qrels)
    res["metrics"] = {n: {m: bootstrap(v) for m, v in ms.items()} for n, ms in per.items()}
    base = "bm25_lucene_k0.9_b0.4"
    res["paired_vs_bm25"] = {n: {m: bootstrap(per[n][m], per[base][m]) for m in per[n]}
                             for n in per if n != base}
    a, b_ = per[base]["ndcg10"], per["dense_minilm"]["ndcg10"]
    res["per_query_ndcg10_bm25_vs_dense"] = {"bm25_better": int((a > b_).sum()),
                                             "dense_better": int((b_ > a).sum()), "tied": int((a == b_).sum()),
                                             "both_zero": int(((a == 0) & (b_ == 0)).sum())}
    # overlap of the two top-10 lists
    ov = [len(set(runs[base][q][:10]) & set(runs["dense_minilm"][q][:10])) for q in qids]
    res["top10_overlap_mean"] = float(np.mean(ov))
    # query-term overlap: fraction of each relevant doc's... query terms present in relevant doc
    cover = []
    for i, q in enumerate(qids):
        qt = set(analyze(queries[q]))
        for d in qrels[q]:
            dt = set(analyze(docs[d]))
            cover.append((q, d, len(qt & dt) / max(1, len(qt))))
    # dense-vs-bm25 by query-term coverage of the relevant doc
    buckets = defaultdict(list)
    for q, d, c in cover:
        rb = first_rel_rank(runs[base][q], {d})
        rd = first_rel_rank(runs["dense_minilm"][q], {d})
        key = "<0.5" if c < 0.5 else ("0.5-0.8" if c < 0.8 else ">=0.8")
        buckets[key].append((rb is not None and rb <= 10, rd is not None and rd <= 10))
    res["hit10_by_term_coverage"] = {k: {"n": len(v), "bm25": float(np.mean([x[0] for x in v])),
                                         "dense": float(np.mean([x[1] for x in v]))} for k, v in buckets.items()}

    # per-query table for figure selection
    res["per_query"] = [{"qid": q, "query": queries[q], "rel": sorted(qrels[q]),
                         "bm25_rank": first_rel_rank(runs[base][q], qrels[q]),
                         "dense_rank": first_rel_rank(runs["dense_minilm"][q], qrels[q]),
                         "bm25_ndcg10": float(per[base]["ndcg10"][i]),
                         "dense_ndcg10": float(per["dense_minilm"]["ndcg10"][i])}
                        for i, q in enumerate(qids)]
    np.save("dense_scores.npy", S.astype(np.float32))
    json.dump(res, open(args.out, "w"), indent=1)
    for n, ms in res["metrics"].items():
        print(f"{n:28s} " + " ".join(f"{m}={v[0]:.3f}" for m, v in ms.items()))


if __name__ == "__main__":
    main()
