"""Build the corpus and tokenizer, then train the target and draft models.

Run from notes/:

    python3 content/ml/serving-systems/speculative-decoding/train.py prepare \
        --shakespeare work/notebook-data/specdec/shakespeare.txt
    python3 content/ml/serving-systems/speculative-decoding/train.py train target --steps 6000
    python3 content/ml/serving-systems/speculative-decoding/train.py train draft --steps 6000

Corpus: the Python standard library's own .py files (tests excluded) from the
interpreter running this script, plus Karpathy's tinyshakespeare
(https://raw.githubusercontent.com/karpathy/char-rnn/master/data/tinyshakespeare/input.txt).
Code files whose path hashes to 0 mod 10 are held out; so is the last 10% of
the Shakespeare text. Everything lands in work/notebook-data/specdec/.
"""

import argparse
import hashlib
import json
import math
import sys
import sysconfig
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).parent))
from gpt import GPT, SIZES  # noqa: E402

WORK = Path("work/notebook-data/specdec")
SKIP = ("/test/", "/tests/", "idle_test", "site-packages", "dist-packages")


def held_out(rel: str) -> bool:
    return int(hashlib.sha1(rel.encode()).hexdigest(), 16) % 10 == 0


def prepare(args):
    from tokenizers import ByteLevelBPETokenizer

    WORK.mkdir(parents=True, exist_ok=True)
    root = Path(sysconfig.get_paths()["stdlib"])
    files = sorted(p for p in root.rglob("*.py") if not any(s in str(p) for s in SKIP))
    code = {"train": [], "valid": []}
    for p in files:
        rel = str(p.relative_to(root))
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        code["valid" if held_out(rel) else "train"].append(text)
    shakes = Path(args.shakespeare).read_text(encoding="utf-8")
    cut = int(len(shakes) * 0.9)
    shakes_split = {"train": shakes[:cut], "valid": shakes[cut:]}

    sep = "\n\n"
    texts = {
        ("code", s): sep.join(code[s]) for s in ("train", "valid")
    } | {("prose", s): shakes_split[s] for s in ("train", "valid")}

    tok = ByteLevelBPETokenizer()
    train_txt = WORK / "tokenizer_train.txt"
    train_txt.write_text(texts[("code", "train")] + sep + texts[("prose", "train")], encoding="utf-8")
    tok.train([str(train_txt)], vocab_size=4096, min_frequency=2, special_tokens=["<|sep|>"])
    tok.save(str(WORK / "tokenizer.json"))

    meta = {"python": sys.version.split()[0], "stdlib": str(root), "code_files": len(files),
            "shakespeare_sha256": hashlib.sha256(shakes.encode()).hexdigest()}
    for (domain, split), text in texts.items():
        ids = np.array(tok.encode(text).ids, dtype=np.uint16)
        ids.tofile(WORK / f"{domain}_{split}.bin")
        meta[f"{domain}_{split}_tokens"] = int(ids.size)
        meta[f"{domain}_{split}_chars"] = len(text)
    (WORK / "corpus.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


def load(domain, split):
    return torch.from_numpy(np.fromfile(WORK / f"{domain}_{split}.bin", dtype=np.uint16).astype(np.int64))


def batches(gen, data, n, ctx):
    starts = torch.randint(0, len(data) - ctx - 1, (n,), generator=gen)
    x = torch.stack([data[s : s + ctx] for s in starts])
    y = torch.stack([data[s + 1 : s + ctx + 1] for s in starts])
    return x, y


@torch.no_grad()
def evaluate(model, data, ctx, n=64, seed=123):
    gen = torch.Generator().manual_seed(seed)
    model.eval()
    x, y = batches(gen, data, n, ctx)
    loss = F.cross_entropy(model(x).flatten(0, 1), y.flatten()).item()
    model.train()
    return loss


def train(args):
    torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    cfg = SIZES[args.name]
    model = GPT(cfg)
    data = {(d, s): load(d, s) for d in ("code", "prose") for s in ("train", "valid")}
    gen = torch.Generator().manual_seed(args.seed)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.95), weight_decay=0.1)
    ctx, bs = cfg.context, args.batch
    n_prose = round(bs * args.prose_share)
    log = []
    t0 = time.time()
    for step in range(args.steps + 1):
        if step % 500 == 0 or step == args.steps:
            row = {"step": step, "seconds": round(time.time() - t0, 1)}
            for d in ("code", "prose"):
                row[f"{d}_valid_loss"] = round(evaluate(model, data[(d, "valid")], ctx), 4)
            log.append(row)
            print(json.dumps(row), flush=True)
            torch.save(model.state_dict(), WORK / f"{args.name}.partial.pt")
        if step == args.steps:
            break
        warm = 200
        lr = args.lr * min(1, (step + 1) / warm) * 0.5 * (1 + math.cos(math.pi * step / args.steps))
        for g in opt.param_groups:
            g["lr"] = max(lr, args.lr * 0.02)
        xc, yc = batches(gen, data[("code", "train")], bs - n_prose, ctx)
        xp, yp = batches(gen, data[("prose", "train")], n_prose, ctx)
        x, y = torch.cat([xc, xp]), torch.cat([yc, yp])
        loss = F.cross_entropy(model(x).flatten(0, 1), y.flatten())
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
    torch.save(model.state_dict(), WORK / f"{args.name}.pt")
    (WORK / f"{args.name}_train.json").write_text(json.dumps(
        {"config": cfg.__dict__, "params": model.n_params(), "args": vars(args), "log": log}, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--shakespeare", required=True)
    t = sub.add_parser("train")
    t.add_argument("name", choices=sorted(SIZES))
    t.add_argument("--steps", type=int, default=6000)
    t.add_argument("--batch", type=int, default=32)
    t.add_argument("--lr", type=float, default=1e-3)
    t.add_argument("--prose-share", type=float, default=0.25)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument("--threads", type=int, default=4)
    a = ap.parse_args()
    prepare(a) if a.cmd == "prepare" else train(a)
