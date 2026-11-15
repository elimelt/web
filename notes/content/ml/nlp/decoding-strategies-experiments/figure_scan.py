"""Find short newstest2021 sentences where raw-score beam search prefers a
shorter output than length-normalized beam search at a small width.
    OPENBLAS_NUM_THREADS=2 python3 figure_scan.py > figure_scan.txt"""
import sentencepiece as spm
import nmt_numpy as N
from beam_exp import beam_search, pick

sp = spm.SentencePieceProcessor(model_file="data/sentencepiece.model")
m = N.Model("data/averaged-10-epoch.pt")
src = [l.rstrip("\n") for l in open("data/newstest2021.en-de.src.en", encoding="utf-8")]
dec = lambda h: sp.decode([m.tgt_itos[w] for w in h])
for i, s in enumerate(src):
    pieces = sp.encode(s, out_type=str)
    if not 6 <= len(pieces) <= 14:
        continue
    ckv = m.encode(pieces)
    rows = []
    for k in range(1, 9):
        fin, _, _ = beam_search(m, ckv, k, 2 * len(pieces) + 10)
        c = pick(fin)
        rows.append((k, fin[c["raw"]], fin[c["norm"]]))
    gap = max(len(n[0]) - len(r[0]) for _, r, n in rows)
    if gap >= 3:
        print(f"== line {i} ({len(pieces)} pieces) gap {gap}: {s}")
        for k, r, n in rows:
            print(f"  k={k} raw[{len(r[0])}] {r[1]:.2f} {dec(r[0])!r} | norm[{len(n[0])}] {n[1]:.2f} {dec(n[0])!r}")
        print(flush=True)
