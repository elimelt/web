"""Cross-checks the NumPy model against CTranslate2, an independent C++
implementation of the same checkpoint.

    python3 convert_ct2.py data/averaged-10-epoch.pt data/ct2
    OPENBLAS_NUM_THREADS=2 python3 checks.py

For 50 sentences of the sweep's sample, greedy decoding must produce the same
tokens in both, and the per-sentence log-probabilities are compared.
"""
import numpy as np, ctranslate2, sentencepiece as spm
import nmt_numpy as N
from beam_exp import beam_search

sp = spm.SentencePieceProcessor(model_file="data/sentencepiece.model")
m = N.Model("data/averaged-10-epoch.pt")
tr = ctranslate2.Translator("data/ct2", device="cpu", intra_threads=2)
src = [l.rstrip("\n") for l in open("data/newstest2021.en-de.src.en", encoding="utf-8")]
order = np.random.default_rng(0).permutation(len(src))[:50]
same, diffs = 0, []
for i in order:
    pieces = sp.encode(src[i], out_type=str)
    fin, _, _ = beam_search(m, m.encode(pieces), 1, 2 * len(pieces) + 10)
    ours = [m.tgt_itos[w] for w in fin[0][0]]
    ct = tr.translate_batch([pieces], beam_size=1, max_decoding_length=2 * len(pieces) + 10)[0].hypotheses[0]
    same += ours == ct
    # score_batch sums log-probabilities including end-of-sentence
    s = tr.score_batch([pieces], [ours])[0].log_probs
    diffs.append(abs(fin[0][1] - sum(s)) / abs(fin[0][1]))
print(f"greedy outputs identical: {same}/50")
print(f"relative difference of sentence log-probability: median {np.median(diffs):.4f}, max {np.max(diffs):.4f}")
