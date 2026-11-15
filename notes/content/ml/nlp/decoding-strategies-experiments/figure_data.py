"""Record the next-token log-probabilities the beam-search figure replays.

    OPENBLAS_NUM_THREADS=2 python3 figure_data.py > beam-figure.json

For one newstest2021 sentence, every prefix that beam search expands at widths
1 to KMAX is stored with its 2*KMAX most probable next tokens and the
log-probability of end-of-sentence. That is enough to replay the search
exactly at any width up to KMAX: a candidate outside its own hypothesis's top
2k cannot be among the 2k best candidates of the whole beam. The file also
holds what the live model's search returned at each width, which
figure_replay.py checks against its own replay of the stored numbers.
"""
import json
import numpy as np
import sentencepiece as spm
import nmt_numpy as N
from beam_exp import beam_search

LINE = 554  # 0-based line of newstest2021.en-de.src.en
KMAX = 8
M = 2 * KMAX

sp = spm.SentencePieceProcessor(model_file="data/sentencepiece.model")
m = N.Model("data/averaged-10-epoch.pt")
src = open("data/newstest2021.en-de.src.en", encoding="utf-8").read().split("\n")[LINE]
ref = open("data/newstest2021.en-de.ref.A.de", encoding="utf-8").read().split("\n")[LINE]
pieces = sp.encode(src, out_type=str)
ckv = m.encode(pieces)
max_len = 2 * len(pieces) + 10

# The live searches, to know which prefixes get expanded and what they return.
live = {}
for k in range(1, KMAX + 1):
    fin, _, _ = beam_search(m, ckv, k, max_len)
    live[k] = [[h, s] for h, s in fin]

# Expand every prefix any of those searches could expand: rerun the same
# search, but record the distribution at each live hypothesis.
nodes = {}  # prefix tuple -> (top tokens, their log-probs, eos log-prob)

def expand(prefix):
    if prefix in nodes:
        return nodes[prefix]
    st = m.init_state(); lp = None
    seq = [m.bos] + list(prefix)
    for t, w in enumerate(seq):
        lp, st = m.step(ckv, st, [w], t)
    row = lp[0].astype(np.float64)
    order = [int(i) for i in np.argsort(-row, kind="stable") if int(i) != m.eos][:M]
    nodes[prefix] = (order, [float(row[i]) for i in order], float(row[m.eos]))
    return nodes[prefix]

def recording_search(k):
    hyps = [()]; scores = [0.0]; finished = []
    for t in range(max_len):
        cands = []
        for b, h in enumerate(hyps):
            toks, lps, e = expand(h)
            cands.append((scores[b] + e, b, m.eos))
            cands += [(scores[b] + l, b, w) for w, l in zip(toks, lps)]
        cands.sort(key=lambda c: -c[0])
        if t == max_len - 1:
            finished += [(hyps[b], s) for s, b, w in cands if w == m.eos]
            break
        new_h, new_s = [], []
        for rank, (s, b, w) in enumerate(cands[: 2 * k]):
            if w == m.eos:
                if rank < k:
                    finished.append((hyps[b], s))
            elif len(new_h) < k:
                new_h.append(hyps[b] + (w,)); new_s.append(s)
        if len(finished) >= k:
            break
        hyps, scores = new_h, new_s
    return finished

for k in range(1, KMAX + 1):
    rec = recording_search(k)
    assert [list(h) for h, _ in rec] == [h for h, _ in live[k]], k
    for (h, s), (h2, s2) in zip(rec, live[k]):
        assert abs(s - s2) < 1e-3, (k, s, s2)

# Serialize: one vocabulary of the pieces that occur, nodes as a tree.
vocab = ["</s>"]; vid = {m.eos: 0}
def v(w):
    if w not in vid:
        vid[w] = len(vocab); vocab.append(m.tgt_itos[w])
    return vid[w]
prefixes = sorted(nodes, key=lambda p: (len(p), p))
index = {p: i for i, p in enumerate(prefixes)}
out_nodes = []
for p in prefixes:
    toks, lps, e = nodes[p]
    out_nodes.append({
        "parent": index[p[:-1]] if p else -1,
        "token": v(p[-1]) if p else -1,
        "eos": round(e, 4),
        "next": [[v(w), round(l, 4)] for w, l in zip(toks, lps)],
    })
json.dump({
    "source": src, "reference": ref, "line": LINE + 1, "kmax": KMAX, "max_len": max_len,
    "vocab": vocab, "nodes": out_nodes,
    "live": {str(k): [[[v(w) for w in h], round(s, 4)] for h, s in live[k]] for k in live},
}, __import__("sys").stdout, ensure_ascii=False, separators=(",", ":"))
