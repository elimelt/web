"""Beam-width sweep on newstest2021 en-de with the OpenNMT-py Transformer-base model.

Run from this directory after `sh fetch.sh`:
    OPENBLAS_NUM_THREADS=2 python3 beam_exp.py --n 300 > results.jsonl

One beam search per (sentence, width). The search itself does not depend on how
finished hypotheses are scored, so every finished set is rescored three ways
(raw log-probability, per-token average, GNMT length penalty with alpha 0.2 and 0.6) after the search.
"""
import argparse, json, sys, time
import numpy as np
import sentencepiece as spm
import nmt_numpy as N

WIDTHS = [1, 2, 3, 5, 10, 20, 50, 100, 200]

def beam_search(m, ckv, k, max_len):
    """fairseq-style beam search. Returns the list of finished hypotheses as
    (tokens without EOS, sum of log-probs including EOS), the log-probability of
    the empty translation, and the number of decoder steps."""
    V = len(m.tgt_itos)
    hyps = [[]]; scores = np.zeros(1, np.float32)
    st = m.init_state()
    finished = []
    lp_empty = None
    for t in range(max_len):
        last = [m.bos if not h else h[-1] for h in hyps]
        lp, st = m.step(ckv, st, last, t)
        if t == 0:
            lp_empty = float(lp[0, m.eos])
        cand = (scores[:, None] + lp).ravel()
        if t == max_len - 1:  # length limit reached: close every live hypothesis
            for b, h in enumerate(hyps):
                finished.append((h, float(scores[b] + lp[b, m.eos])))
            break
        n = min(2 * k, cand.size)
        top = np.argpartition(-cand, n - 1)[:n]
        top = top[np.argsort(-cand[top], kind="stable")]
        keep_b, keep_w, keep_s = [], [], []
        for rank, idx in enumerate(top):
            b, w = divmod(int(idx), V)
            if w == m.eos:
                if rank < k:  # EOS among the k best candidates finishes a hypothesis
                    finished.append((hyps[b], float(cand[idx])))
            elif len(keep_b) < k:
                keep_b.append(b); keep_w.append(w); keep_s.append(cand[idx])
        if len(finished) >= k:
            break
        hyps = [hyps[b] + [w] for b, w in zip(keep_b, keep_w)]
        scores = np.array(keep_s, np.float32)
        st = N.reorder(st, np.array(keep_b))
    return finished, lp_empty, t + 1

def gnmt_lp(n_tokens, alpha=0.6):
    return ((5.0 + n_tokens) / 6.0) ** alpha

def pick(finished):
    """Best finished hypothesis under each scoring rule. Length counts EOS."""
    out = {}
    rules = {
        "raw": lambda h, s: s,
        "norm": lambda h, s: s / (len(h) + 1),
        "gnmt0.2": lambda h, s: s / gnmt_lp(len(h) + 1, 0.2),
        "gnmt0.6": lambda h, s: s / gnmt_lp(len(h) + 1, 0.6),
    }
    for name, f in rules.items():
        i = max(range(len(finished)), key=lambda j: f(*finished[j]))
        out[name] = i
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--widths", type=str, default=",".join(map(str, WIDTHS)))
    a = ap.parse_args()
    widths = [int(x) for x in a.widths.split(",")]
    sp = spm.SentencePieceProcessor(model_file="data/sentencepiece.model")
    m = N.Model("data/averaged-10-epoch.pt")
    src = [l.rstrip("\n") for l in open("data/newstest2021.en-de.src.en", encoding="utf-8")]
    order = np.random.default_rng(a.seed).permutation(len(src))[: a.n]
    for rank, i in enumerate(order):
        pieces = sp.encode(src[i], out_type=str)
        ckv = m.encode(pieces)
        max_len = 2 * len(pieces) + 10
        for k in widths:
            t0 = time.time()
            fin, lp_empty, steps = beam_search(m, ckv, k, max_len)
            choice = pick(fin)
            rec = {"rank": rank, "line": int(i), "k": k, "src_len": len(pieces),
                   "steps": steps, "n_finished": len(fin), "lp_empty": lp_empty,
                   "sec": round(time.time() - t0, 3),
                   "finished": [[len(h), round(s, 4)] for h, s in fin]}
            for name, j in choice.items():
                h, s = fin[j]
                rec[name] = {"text": sp.decode([m.tgt_itos[w] for w in h]),
                             "len": len(h), "logp": s}
            print(json.dumps(rec, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
