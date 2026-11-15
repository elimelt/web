"""Per-rank memory and communication of data parallelism and ZeRO stages 1-3.

Trains a small decoder-only transformer on the bytes of this site's own
Markdown notes with 4 CPU processes over PyTorch's gloo backend, under four
strategies:

  dp     DistributedDataParallel (gradients AllReduced)
  zero1  DDP + torch.distributed.optim.ZeroRedundancyOptimizer (Adam state
         sharded; each rank updates its share of the parameters, then
         broadcasts it)
  zero2  FSDP2 fully_shard(reshard_after_forward=False): gradients
         ReduceScattered, optimizer state and parameters sharded at rest,
         parameters kept unsharded from the forward pass through the backward
  zero3  FSDP2 fully_shard(reshard_after_forward=True): parameters gathered
         again for the backward pass

For every step it records, per rank:
  * the bytes the process wrote (wchar in /proc/self/io; gloo's TCP sends are
    the only writes during a step), i.e. bytes actually sent on the wire;
  * every collective's name and full-tensor size, from wrappers around the
    torch.distributed functions that DDP's comm hook, ZeroRedundancyOptimizer
    and FSDP2 call;
  * bytes of parameters, gradients and optimizer state the rank holds after
    the optimizer step, and the peak bytes of parameters it holds during the
    step (sharded storage plus any unsharded copies);
  * peak resident set size (VmHWM).

Run from notes/ (one launch per strategy and seed; each takes well under a
minute on a 4-core VM):

  for seed in 1 2 3; do for s in dp zero1 zero2 zero3; do
    OMP_NUM_THREADS=1 python3 -m torch.distributed.run --nproc_per_node 4 \
      content/ml/serving-systems/parallelism/zero_measure.py --strategy $s --seed $seed
  done; done
  python3 content/ml/serving-systems/parallelism/zero_summarize.py

Raw per-launch records go to parallelism/zero-runs/<strategy>-<seed>.json.
"""

import argparse
import functools
import json
import math
import os
import pathlib
import time

import torch
import torch.distributed as dist
import torch.nn as nn
import torch.nn.functional as F

HERE = pathlib.Path(__file__).resolve().parent
CONTENT = HERE.parents[2]  # notes/content

# ---------------------------------------------------------------------------
# Accounting of collectives


COLLECTIVES = [
    "all_reduce",
    "all_gather",
    "all_gather_into_tensor",
    "all_gather_single",
    "reduce_scatter",
    "reduce_scatter_tensor",
    "reduce_scatter_single",
    "broadcast",
    "all_to_all",
    "all_to_all_single",
    "send",
    "recv",
    "isend",
    "irecv",
]
LOG = []  # (op, full-tensor bytes) for the current step
ACTIVE = [False]


def _tensor_bytes(x):
    if isinstance(x, torch.Tensor):
        return x.numel() * x.element_size()
    if isinstance(x, (list, tuple)):
        return sum(_tensor_bytes(y) for y in x)
    return 0


def _wrap(name):
    fn = getattr(dist, name)

    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        if ACTIVE[0]:
            sizes = [_tensor_bytes(a) for a in args] + [_tensor_bytes(v) for v in kwargs.values()]
            # The largest tensor argument is the full (unsharded) tensor: the
            # output of an all-gather, the input of a reduce-scatter.
            LOG.append((name, max(sizes) if sizes else 0))
        return fn(*args, **kwargs)

    setattr(dist, name, wrapped)


for _n in COLLECTIVES:
    if hasattr(dist, _n):
        _wrap(_n)


def wchar():
    for line in open("/proc/self/io"):
        if line.startswith("wchar:"):
            return int(line.split()[1])
    raise RuntimeError("no wchar")


def vm(field):
    for line in open("/proc/self/status"):
        if line.startswith(field + ":"):
            return int(line.split()[1]) * 1024
    raise RuntimeError(field)


# ---------------------------------------------------------------------------
# Model: a GPT-style decoder (pre-LayerNorm, learned positions, untied head)


class Block(nn.Module):
    def __init__(self, d, heads):
        super().__init__()
        self.heads = heads
        self.ln1 = nn.LayerNorm(d)
        self.qkv = nn.Linear(d, 3 * d)
        self.proj = nn.Linear(d, d)
        self.ln2 = nn.LayerNorm(d)
        self.fc1 = nn.Linear(d, 4 * d)
        self.fc2 = nn.Linear(4 * d, d)

    def forward(self, x):
        b, s, d = x.shape
        q, k, v = self.qkv(self.ln1(x)).split(d, dim=-1)
        q, k, v = (t.view(b, s, self.heads, d // self.heads).transpose(1, 2) for t in (q, k, v))
        y = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        x = x + self.proj(y.transpose(1, 2).reshape(b, s, d))
        return x + self.fc2(F.gelu(self.fc1(self.ln2(x))))


class GPT(nn.Module):
    def __init__(self, vocab, ctx, d, layers, heads):
        super().__init__()
        self.tok = nn.Embedding(vocab, d)
        self.pos = nn.Embedding(ctx, d)
        self.blocks = nn.ModuleList(Block(d, heads) for _ in range(layers))
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab)

    def forward(self, idx):
        x = self.tok(idx) + self.pos(torch.arange(idx.shape[1]))
        for blk in self.blocks:
            x = blk(x)
        return self.head(self.ln(x))


# ---------------------------------------------------------------------------


def corpus():
    """Bytes of every Markdown note on the site, in sorted path order."""
    parts = []
    for p in sorted(CONTENT.rglob("*.md")):
        if "templates" in p.parts:
            continue
        parts.append(p.read_bytes())
    return torch.frombuffer(bytearray(b"\n".join(parts)), dtype=torch.uint8).long()


def local_bytes(t):
    from torch.distributed.tensor import DTensor

    if isinstance(t, DTensor):
        t = t.to_local()
    return t.numel() * t.element_size()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strategy", choices=["dp", "zero1", "zero2", "zero3"], required=True)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--d", type=int, default=768)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--heads", type=int, default=12)
    ap.add_argument("--ctx", type=int, default=128)
    ap.add_argument("--batch", type=int, default=4, help="sequences per rank per step")
    ap.add_argument("--warmup", type=int, default=2)
    ap.add_argument("--steps", type=int, default=6)
    args = ap.parse_args()

    torch.set_num_threads(1)
    dist.init_process_group("gloo")
    rank, world = dist.get_rank(), dist.get_world_size()

    data = corpus()
    torch.manual_seed(args.seed)
    model = GPT(256, args.ctx, args.d, args.layers, args.heads)
    psi = sum(p.numel() for p in model.parameters())

    rss_base = vm("VmRSS")
    s = args.strategy
    if s in ("dp", "zero1"):
        from torch.distributed.algorithms.ddp_comm_hooks import default_hooks
        from torch.nn.parallel import DistributedDataParallel as DDP

        net = DDP(model)
        # The default hook AllReduces each gradient bucket through
        # dist.all_reduce, so the wrapper above sees it.
        net.register_comm_hook(None, default_hooks.allreduce_hook)
        if s == "dp":
            opt = torch.optim.Adam(net.parameters(), lr=1e-3)
        else:
            from torch.distributed.optim import ZeroRedundancyOptimizer

            opt = ZeroRedundancyOptimizer(net.parameters(), optimizer_class=torch.optim.Adam, lr=1e-3)
        fsdp_params = None
    else:
        from torch.distributed.fsdp import fully_shard

        reshard = s == "zero3"
        for blk in model.blocks:
            fully_shard(blk, reshard_after_forward=reshard)
        fully_shard(model, reshard_after_forward=reshard)
        net = model
        opt = torch.optim.Adam(net.parameters(), lr=1e-3)
        fsdp_params = []
        for m in [model, *model.blocks]:
            fsdp_params += m._get_fsdp_state()._fsdp_param_group.fsdp_params

    # Peak parameter bytes resident during a step, sampled at every block's
    # forward entry and exit and at every block's backward entry and exit.
    peak = [0]

    def sample_params(*_):
        if fsdp_params is None:
            cur = sum(p.numel() * p.element_size() for p in net.parameters())
        else:
            cur = 0
            for fp in fsdp_params:
                cur += fp._sharded_param_data.numel() * fp._sharded_param_data.element_size()
                if fp.sharded_state.name != "SHARDED":
                    up = fp.unsharded_param
                    cur += up.numel() * up.element_size()
        peak[0] = max(peak[0], cur)

    for blk in model.blocks:
        blk.register_forward_pre_hook(sample_params)
        blk.register_forward_hook(sample_params)
        blk.register_full_backward_pre_hook(sample_params)
        blk.register_full_backward_hook(sample_params)

    g = torch.Generator().manual_seed(1000 + args.seed)
    gbatch = args.batch * world
    records = []
    for step in range(args.warmup + args.steps):
        starts = torch.randint(0, len(data) - args.ctx - 1, (gbatch,), generator=g)
        mine = starts[rank * args.batch : (rank + 1) * args.batch]
        x = torch.stack([data[i : i + args.ctx] for i in mine])
        y = torch.stack([data[i + 1 : i + args.ctx + 1] for i in mine])

        dist.barrier()
        LOG.clear()
        peak[0] = 0
        ACTIVE[0] = True
        w0, t0 = wchar(), time.perf_counter()
        logits = net(x)
        loss = F.cross_entropy(logits.reshape(-1, 256), y.reshape(-1))
        loss.backward()
        opt.step()
        t1, w1 = time.perf_counter(), wchar()
        ACTIVE[0] = False

        params = sum(local_bytes(p) for p in net.parameters())
        grads = sum(local_bytes(p.grad) for p in net.parameters() if p.grad is not None)
        inner = opt.optim if s == "zero1" else opt
        ostate = sum(local_bytes(v) for st in inner.state.values() for v in st.values() if isinstance(v, torch.Tensor) and v.dim() > 0)
        opt.zero_grad(set_to_none=True)

        gl = loss.detach().clone()
        dist.all_reduce(gl)
        by_op = {}
        for name, b in LOG:
            c = by_op.setdefault(name, [0, 0])
            c[0] += 1
            c[1] += b
        records.append(
            {
                "step": step,
                "warmup": step < args.warmup,
                "loss": gl.item() / world,
                "seconds": t1 - t0,
                "bytes_sent": w1 - w0,
                "collectives": by_op,
                "param_bytes": params,
                "grad_bytes": grads,
                "optimizer_bytes": ostate,
                "peak_param_bytes": peak[0],
            }
        )

    out = {
        "rank": rank,
        "world": world,
        "psi": psi,
        "rss_after_build": rss_base,
        "peak_rss": vm("VmHWM"),
        "records": records,
    }
    gathered = [None] * world
    dist.all_gather_object(gathered, out)
    if rank == 0:
        d = HERE / "zero-runs"
        d.mkdir(exist_ok=True)
        meta = {
            "strategy": s,
            "seed": args.seed,
            "config": vars(args),
            "torch": torch.__version__,
            "ranks": gathered,
        }
        (d / f"{s}-{args.seed}.json").write_text(json.dumps(meta, indent=1))
        r = [x for x in records if not x["warmup"]]
        print(
            f"{s} seed {args.seed}: psi={psi} loss {r[-1]['loss']:.4f} "
            f"sent/step {sum(x['bytes_sent'] for x in r) / len(r) / (4 * psi):.3f} x 4psi "
            f"step {sum(x['seconds'] for x in r) / len(r):.2f}s"
        )
    dist.destroy_process_group()


if __name__ == "__main__":
    main()
