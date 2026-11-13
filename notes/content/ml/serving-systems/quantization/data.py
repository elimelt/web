"""Token windows for evaluation and calibration.

Each window is PREFIX tokens of a document fed to the encoder (followed by
EOS, as in T5's prefix-LM task) and the next TARGET tokens scored by the
decoder. Go blog posts are split by name hash into a calibration pool and an
evaluation pool, so calibration never sees evaluation text.
"""
from __future__ import annotations

import hashlib
import json
import numpy as np
import sentencepiece as spm

PREFIX, TARGET, EOS = 128, 64, 1


def _windows(sp, docs):
    out = []
    for d in docs:
        ids = sp.encode(d["text"].replace("\n", " "))
        for s in range(0, len(ids) - PREFIX - TARGET + 1, PREFIX + TARGET):
            out.append(ids[s : s + PREFIX + TARGET])
    return out


def _split(docs):
    cal, ev = [], []
    for d in docs:
        h = int(hashlib.sha256(d["name"].encode()).hexdigest(), 16) % 4
        (cal if h == 0 else ev).append(d)
    return cal, ev


def _arrays(w):
    w = np.asarray(w, dtype=np.int64)
    inputs = np.concatenate([w[:, :PREFIX], np.full((len(w), 1), EOS)], axis=1)
    return inputs, w[:, PREFIX:]


def load(text_dir, spm_path, n_eval=256, n_cal=128, seed=0):
    """Returns dict with eval (inputs, targets), shakespeare eval, and a
    calibration-window sampler keyed by seed."""
    sp = spm.SentencePieceProcessor(model_file=spm_path)
    go = json.load(open(f"{text_dir}/goblog.json"))
    sh = json.load(open(f"{text_dir}/shakespeare.json"))
    cal_docs, ev_docs = _split(go)
    ev = _windows(sp, ev_docs)
    cal = _windows(sp, cal_docs)
    rng = np.random.default_rng(1234)  # fixed: the eval set is the same for every run
    ev = [ev[i] for i in sorted(rng.choice(len(ev), size=min(n_eval, len(ev)), replace=False))]
    shw = _windows(sp, sh)
    shw = [shw[i] for i in sorted(rng.choice(len(shw), size=min(n_eval // 2, len(shw)), replace=False))]
    return {
        "eval": _arrays(ev),
        "shakespeare": _arrays(shw),
        "cal_pool": cal,
        "n_eval_docs": len(ev_docs),
        "n_cal_docs": len(cal_docs),
    }


def calibration(data, n, seed):
    rng = np.random.default_rng(seed)
    pool = data["cal_pool"]
    idx = rng.choice(len(pool), size=min(n, len(pool)), replace=False)
    return _arrays([pool[i] for i in idx])
