"""Bytes each rank sends for one gloo collective on a tensor of S bytes.

Run from notes/:
  OMP_NUM_THREADS=1 python3 -m torch.distributed.run --nproc_per_node 4 \
    content/ml/serving-systems/parallelism/collective_bytes.py

Prints, for each collective, the bytes the process wrote during the call
(wchar in /proc/self/io) divided by S, per rank, and writes
parallelism/collective-bytes.json. A bandwidth-optimal ring sends
2(N-1)/N S for AllReduce and (N-1)/N S for AllGather and ReduceScatter.
"""

import json
import pathlib

import torch
import torch.distributed as dist


def wchar():
    for line in open("/proc/self/io"):
        if line.startswith("wchar:"):
            return int(line.split()[1])


def main():
    torch.set_num_threads(1)
    dist.init_process_group("gloo")
    rank, n = dist.get_rank(), dist.get_world_size()
    numel = 4 * 1024 * 1024  # 16 MiB of float32, divisible by n
    S = numel * 4
    full = torch.ones(numel)
    shard = torch.ones(numel // n)
    ops = {
        "all_reduce": lambda: dist.all_reduce(full),
        "all_gather_into_tensor": lambda: dist.all_gather_into_tensor(full, shard),
        "reduce_scatter_tensor": lambda: dist.reduce_scatter_tensor(shard, full),
        "broadcast_from_0": lambda: dist.broadcast(full, src=0),
    }
    res = {}
    for name, op in ops.items():
        ratios = []
        for _ in range(3):
            dist.barrier()
            w0 = wchar()
            op()
            ratios.append((wchar() - w0) / S)
        res[name] = ratios
    out = [None] * n
    dist.all_gather_object(out, res)
    if rank == 0:
        for name in ops:
            print(name, [round(r[name][0], 4) for r in out])
        path = pathlib.Path(__file__).resolve().parent / "collective-bytes.json"
        path.write_text(json.dumps({"world": n, "tensor_bytes": S, "torch": torch.__version__, "sent_over_S": out}, indent=1))
    dist.destroy_process_group()


if __name__ == "__main__":
    main()
