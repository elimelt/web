"""Speculative decoding experiments on the models train.py produces.

Run from notes/ after training (about 25 minutes on 4 CPU cores):

    python3 content/ml/serving-systems/speculative-decoding/measure.py

Writes results.json (every number the note quotes) and trace.json (the
recorded rounds the page replays) next to this file.

Conventions follow Chen et al. (2023): p is the draft distribution and q the
target's. Temperature 0 means greedy decoding on both models.
"""

import json
import platform
import statistics as st
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from gpt import GPT, SIZES  # noqa: E402

HERE = Path(__file__).parent
WORK = Path("work/notebook-data/specdec")
torch.set_num_threads(4)
torch.set_grad_enabled(False)


def load_model(name):
    m = GPT(SIZES[name])
    m.load_state_dict(torch.load(WORK / f"{name}.pt"))
    return m.eval()


def probs(logits, temp):
    """Next-token distribution as float64 numpy; temp 0 is a one-hot argmax."""
    logits = logits.double()
    if temp == 0:
        out = torch.zeros_like(logits)
        out[logits.argmax()] = 1.0
        return out.numpy()
    return torch.softmax(logits / temp, dim=-1).numpy()


def sample(dist, u):
    """Inverse-CDF sample with an explicit uniform u, so a run can be replayed."""
    return int(min(np.searchsorted(np.cumsum(dist), u * dist.sum(), side="right"), len(dist) - 1))


class Stream:
    """One model's KV cache plus the tokens it has not yet consumed."""

    def __init__(self, model, prompt):
        self.model = model
        self.cache = model.new_cache()
        self.pos = 0
        self.last = self.feed(prompt)

    def feed(self, ids):
        logits = self.model(torch.tensor([ids]), self.cache, self.pos)[0]
        self.pos += len(ids)
        return logits

    def rollback(self, pos):
        self.pos = pos  # stale entries past pos are overwritten before they are read


def plain_decode(target, prompt, n, temp, rng):
    s = Stream(target, prompt)
    out = []
    while len(out) < n:
        q = probs(s.last[-1], temp)
        out.append(sample(q, rng.random()))
        s.last = s.feed([out[-1]])
    return out


def spec_decode(target, draft, prompt, n, gamma, temp, rng, record=None, bug=False):
    """Speculative sampling (Leviathan et al. 2022; Chen et al. 2023), one draft chain.

    Returns the emitted tokens and the number of drafts accepted in each
    round. If record is a list, each round's distributions are appended to it.
    bug=True resamples a rejected position from q instead of the residual, a
    plausible mistake that the distribution test should catch.
    """
    t = Stream(target, prompt[:-1])
    d = Stream(draft, prompt[:-1])
    pend_t = pend_d = [prompt[-1]]  # emitted tokens a model has not consumed yet
    out, accepts = [], []
    while len(out) < n:
        # Draft gamma tokens autoregressively.
        d.last = d.feed(pend_d)
        base_d = d.pos
        drafted, ps = [], []
        for i in range(gamma):
            p = probs(d.last[-1], temp)
            drafted.append(sample(p, rng.random()))
            ps.append(p)
            if i < gamma - 1:
                d.last = d.feed([drafted[-1]])
        # One target pass scores every drafted position plus one more.
        base_t = t.pos
        logits = t.feed(pend_t + drafted)[len(pend_t) - 1 :]
        qs = [probs(logits[i], temp) for i in range(gamma + 1)]
        # Accept draft i with probability min(1, q(x)/p(x)); stop at the first rejection.
        n_acc, us = 0, []
        for i, x in enumerate(drafted):
            us.append(rng.random())
            if us[-1] >= min(1.0, qs[i][x] / ps[i][x]):
                break
            n_acc += 1
        if n_acc < gamma:
            resid = np.maximum(qs[n_acc] - ps[n_acc], 0.0)  # never all zero after a rejection
            dist = qs[n_acc] if bug else resid / resid.sum()
        else:
            resid, dist = None, qs[gamma]  # every draft accepted: one free token from q
        u_fix = rng.random()
        fix = sample(dist, u_fix)
        new = drafted[:n_acc] + [fix]
        if record is not None:
            record.append({"drafted": drafted, "p": ps, "q": qs, "u": us, "accepted": n_acc,
                           "resid": resid, "u_fix": u_fix, "emitted": new})
        out.extend(new)
        accepts.append(n_acc)
        # Keep cache entries for accepted tokens only. The draft never consumed
        # its last draft, so if all were accepted that one is still pending.
        t.rollback(base_t + len(pend_t) + n_acc)
        pend_t = [fix]
        kept = min(n_acc, gamma - 1)
        d.rollback(base_d + kept)
        pend_d = drafted[kept:n_acc] + [fix]
    return out[:n], accepts


def windows(data, n, length, seed):
    rng = np.random.default_rng(seed)
    starts = rng.integers(0, len(data) - length - 1, n)
    return [data[s : s + length].tolist() for s in starts]


def exact_alpha(target, draft, data, temp, n=48, ctx=256):
    """Per-position alpha = sum_x min(p, q) on held-out text (teacher forcing)."""
    vals = []
    for w in windows(data, n, ctx, seed=7):
        x = torch.tensor([w])
        lq, lp = target(x)[0].double(), draft(x)[0].double()
        if temp == 0:
            vals.extend((lq.argmax(-1) == lp.argmax(-1)).double().tolist())
        else:
            vals.extend(torch.minimum(torch.softmax(lq / temp, -1), torch.softmax(lp / temp, -1)).sum(-1).tolist())
    return np.array(vals)


def timeit(fn, reps):
    fn()
    ts = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn()
        ts.append(time.perf_counter() - t0)
    return st.median(ts)


def step_costs(target, draft, batches=(1, 4, 16, 64), max_new=9, at=128, reps=15):
    """Median seconds for one forward pass that appends k tokens at position `at`."""
    out = {}
    for b in batches:
        row = {}
        for name, m in (("target", target), ("draft", draft)):
            cache = m.new_cache(b)
            m(torch.zeros(b, at, dtype=torch.long), cache, 0)
            row[name] = [timeit(lambda k=k: m(torch.zeros(b, k, dtype=torch.long), cache, at), reps)
                         for k in range(1, max_new + 1)]
        out[b] = row
    return out


@np.errstate(divide="ignore", invalid="ignore")
def chi2_p(counts_a, counts_b=None, expected=None):
    if counts_b is not None:
        keys = sorted(set(counts_a) | set(counts_b))
        a = np.array([counts_a.get(k, 0) for k in keys], float)
        b = np.array([counts_b.get(k, 0) for k in keys], float)
        keep = (a + b) >= 10
        a = np.append(a[keep], a[~keep].sum())
        b = np.append(b[keep], b[~keep].sum())
        tot = a + b
        ea, eb = tot * a.sum() / tot.sum(), tot * b.sum() / tot.sum()
        m = tot > 0
        stat = (((a - ea) ** 2 / ea)[m]).sum() + (((b - eb) ** 2 / eb)[m]).sum()
        dof = m.sum() - 1
    else:
        keys = np.arange(len(expected))
        a = np.array([counts_a.get(k, 0) for k in keys], float)
        e = expected * a.sum()
        keep = e >= 5
        a, e = np.append(a[keep], a[~keep].sum()), np.append(e[keep], e[~keep].sum())
        m = e > 0
        stat = (((a - e) ** 2 / e)[m]).sum()
        dof = m.sum() - 1
    from scipy.stats import chi2

    return float(stat), int(dof), float(chi2.sf(stat, dof))


def repetition(target, valid, n_prompts=16, prompt_len=64, n_new=128):
    """Share of 4-grams that repeat an earlier 4-gram in the same 128 tokens:
    greedy output, sampled output and held-out text, on the speed-run prompts."""
    def rep(seq, n=4):
        grams = [tuple(seq[i : i + n]) for i in range(len(seq) - n + 1)]
        return 1 - len(set(grams)) / len(grams)

    out = {}
    for dom, data in valid.items():
        prompts = windows(data, n_prompts, prompt_len, seed=11)
        rows = {"greedy": [], "temperature_1": [], "held_out": []}
        for i, pr in enumerate(prompts):
            rows["greedy"].append(rep(plain_decode(target, pr, n_new, 0, np.random.default_rng(i))))
            rows["temperature_1"].append(rep(plain_decode(target, pr, n_new, 1, np.random.default_rng(i))))
            start = int(np.random.default_rng(i).integers(0, len(data) - 2 * n_new))
            rows["held_out"].append(rep(data[start : start + n_new].tolist()))
        out[dom] = {k: float(np.mean(v)) for k, v in rows.items()}
    return out


def main():
    meta = json.loads((WORK / "corpus.json").read_text())
    target, draft = load_model("target"), load_model("draft")
    from tokenizers import Tokenizer

    tok = Tokenizer.from_file(str(WORK / "tokenizer.json"))
    valid = {d: np.fromfile(WORK / f"{d}_valid.bin", dtype=np.uint16).astype(np.int64) for d in ("code", "prose")}
    res = {"corpus": meta, "env": {"python": platform.python_version(), "torch": torch.__version__,
                                    "cpu": platform.processor() or platform.machine(), "threads": torch.get_num_threads()},
           "models": {n: {"params": m.n_params(), **SIZES[n].__dict__} for n, m in (("target", target), ("draft", draft))}}
    for n in ("target", "draft"):
        res["models"][n]["train"] = json.loads((WORK / f"{n}_train.json").read_text())["log"][-1]

    # 1. Acceptance rate per position, exactly, on held-out text.
    res["alpha"] = {}
    for dom, data in valid.items():
        for temp in (0, 1):
            a = exact_alpha(target, draft, data, temp)
            hist = np.histogram(a, bins=10, range=(0, 1))[0].tolist() if temp else None
            res["alpha"][f"{dom}_T{temp}"] = {"mean": float(a.mean()), "n": int(a.size), "hist": hist,
                                              "p10": float(np.quantile(a, 0.1)), "p50": float(np.quantile(a, 0.5))}
            print(dom, temp, res["alpha"][f"{dom}_T{temp}"]["mean"], flush=True)

    # 2. Decode runs: tokens per round, empirical acceptance, wall time.
    gammas = [1, 2, 3, 4, 5, 6, 8]
    n_prompts, prompt_len, n_new = 16, 64, 128
    res["runs"] = {}
    greedy_mismatch = 0
    for dom, data in valid.items():
        prompts = windows(data, n_prompts, prompt_len, seed=11)
        for temp in (0, 1):
            key = f"{dom}_T{temp}"
            row = {"plain_s": [], "gamma": {g: {"s": [], "tokens_per_round": [], "accept_rate": []} for g in gammas}}
            for rep in range(3):
                for pi, pr in enumerate(prompts):
                    t0 = time.perf_counter()
                    ref = plain_decode(target, pr, n_new, temp, np.random.default_rng(1000 * rep + pi))
                    row["plain_s"].append(time.perf_counter() - t0)
                    for g in gammas:
                        t0 = time.perf_counter()
                        out, acc = spec_decode(target, draft, pr, n_new, g, temp, np.random.default_rng(1000 * rep + pi))
                        el = time.perf_counter() - t0
                        r = row["gamma"][g]
                        r["s"].append(el)
                        r["tokens_per_round"].append(1 + sum(acc) / len(acc))
                        r["accept_rate"].append(sum(acc) / (g * len(acc)))
                        if temp == 0 and out != ref:
                            greedy_mismatch += 1
            plain = np.array(row["plain_s"])
            summary = {"plain_tok_per_s": float(np.median(n_new / plain)), "gamma": {}}
            for g in gammas:
                r = row["gamma"][g]
                sp = plain / np.array(r["s"])  # paired by prompt and repeat
                summary["gamma"][g] = {
                    "tokens_per_round": float(np.mean(r["tokens_per_round"])),
                    "tokens_per_round_se": float(np.std(r["tokens_per_round"], ddof=1) / np.sqrt(len(r["s"]))),
                    "accept_rate": float(np.mean(r["accept_rate"])),
                    "speedup": float(np.median(sp)),
                    "speedup_q25": float(np.quantile(sp, 0.25)),
                    "speedup_q75": float(np.quantile(sp, 0.75)),
                }
            res["runs"][key] = summary
            print(key, json.dumps(summary["gamma"][4]), flush=True)
    res["greedy_mismatches"] = greedy_mismatch
    res["run_setup"] = {"prompts": n_prompts, "prompt_tokens": prompt_len, "new_tokens": n_new, "repeats": 3, "gammas": gammas}

    # 3. Cost of a forward pass by batch size and tokens appended.
    res["costs"] = step_costs(target, draft)

    # 4. Is the output distribution the target's? For each of six prompts,
    # draw 3000 four-token continuations with each sampler and compare the
    # token counts at each position. "plain2" is a second plain sampler with
    # its own seeds: plain vs plain2 shows how often the test flags two
    # samplers that are identical by construction.
    n_samp, L = 3000, 4
    prompts = [("code", w) for w in windows(valid["code"], 3, prompt_len, seed=5)] + \
              [("prose", w) for w in windows(valid["prose"], 3, prompt_len, seed=5)]
    dist = {"samples": n_samp, "length": L, "gamma": 3, "prompts": [d for d, _ in prompts],
            "spec_first_vs_exact": [], "buggy_first_vs_exact": [],
            "spec_vs_plain": [], "buggy_vs_plain": [], "plain2_vs_plain": []}
    for pi, (_, pr) in enumerate(prompts):
        q_first = probs(Stream(target, pr).last[-1], 1)
        runners = {"spec": lambda r: spec_decode(target, draft, pr, L, 3, 1, r)[0],
                   "buggy": lambda r: spec_decode(target, draft, pr, L, 3, 1, r, bug=True)[0],
                   "plain": lambda r: plain_decode(target, pr, L, 1, r),
                   "plain2": lambda r: plain_decode(target, pr, L, 1, r)}
        counts = {name: [dict() for _ in range(L)] for name in runners}
        for i in range(n_samp):
            for k, (name, fn) in enumerate(runners.items()):
                out = fn(np.random.default_rng(50_000 + i + k * 10**6 + pi * 10**7))
                for j in range(L):
                    c = counts[name][j]
                    c[out[j]] = c.get(out[j], 0) + 1
        for name in ("spec", "buggy"):
            dist[f"{name}_first_vs_exact"].append(chi2_p(counts[name][0], expected=q_first)[2])
        for name in ("spec", "buggy", "plain2"):
            dist[f"{name}_vs_plain"].append([chi2_p(counts[name][j], counts["plain"][j])[2] for j in range(L)])
        print("dist prompt", pi, {k: v[-1] for k, v in dist.items() if isinstance(v, list) and v and isinstance(v[-1], (float, list))}, flush=True)
    res["distribution"] = dist
    print(json.dumps(dist), flush=True)

    # 5. Recorded rounds for the page.
    trace = {}
    for dom, data in valid.items():
        pr = windows(data, 1, 48, seed=21 if dom == "code" else 3)[0]
        rec = []
        spec_decode(target, draft, pr, 96, 4, 1, np.random.default_rng(2026), record=rec)
        trace[dom] = export_trace(tok, pr, rec)
    res["repetition"] = repetition(target, valid)
    (HERE / "trace.json").write_text(json.dumps(trace, separators=(",", ":")))
    (HERE / "results.json").write_text(json.dumps(res, indent=1))


def export_trace(tok, prompt, rec, top=6):
    piece = lambda i: tok.decode([int(i)])  # noqa: E731

    def tops(dist, extra):
        ids = list(np.argsort(-dist)[:top])
        for e in extra:
            if e not in ids:
                ids.append(e)
        return ids

    rounds = []
    for r in rec:
        positions = []
        for i, x in enumerate(r["drafted"]):
            if i > r["accepted"]:
                break
            p, q = r["p"][i], r["q"][i]
            ids = tops(np.maximum(p, q), [x] + ([r["emitted"][-1]] if i == r["accepted"] else []))
            pos = {"x": int(x), "px": round(float(p[x]), 5), "qx": round(float(q[x]), 5),
                   "u": round(r["u"][i], 5) if i < len(r["u"]) else None,
                   "top": [[int(t), round(float(p[t]), 5), round(float(q[t]), 5)] for t in ids],
                   "alpha": round(float(np.minimum(p, q).sum()), 5)}
            positions.append(pos)
        rnd = {"drafted": [int(x) for x in r["drafted"]], "accepted": r["accepted"], "emitted": [int(x) for x in r["emitted"]],
               "u_fix": round(r["u_fix"], 5), "positions": positions}
        if r["resid"] is None:
            qb = r["q"][-1]
            rnd["bonus_top"] = [[int(t), round(float(qb[t]), 5)] for t in tops(qb, [r["emitted"][-1]])]
        rounds.append(rnd)
    vocab = sorted({t for r in rounds for p in r["positions"] for t, *_ in p["top"]} | {t for r in rounds for t in r["emitted"] + r["drafted"]}
                   | {t for r in rounds for t, _ in r.get("bonus_top", [])} | set(prompt))
    return {"prompt": [int(t) for t in prompt], "rounds": rounds, "pieces": {str(t): piece(t) for t in vocab}}


if __name__ == "__main__":
    main()
