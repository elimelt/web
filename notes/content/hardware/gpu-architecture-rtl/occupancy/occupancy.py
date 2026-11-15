"""Resident warps per SM on an H100 (compute capability 9.0), from the
documented limits, checked against NVIDIA's occupancy calculator.

Limits (CUDA C++ Programming Guide, compute capabilities table; Hopper tuning
guide): 64 warps, 32 blocks and 64K 32-bit registers per SM, 255 registers per
thread, 228 KB shared memory per SM, 227 KB per block, and 1 KB of shared
memory reserved per block. Allocation rules (cuda_occupancy.h): registers are
given to a warp in units of 256 and from one of four SM sub-partitions, each
with a quarter of the register file; shared memory is given to a block in
units of 128 bytes.

    python3 -I occupancy.py occupancy_h100_reference.csv
compares every row of the reference CSV and prints the mismatches.
"""
import csv
import sys

WARP = 32
MAX_WARPS = 64
MAX_BLOCKS = 32
REGS_SM = 65536
SUBPARTITIONS = 4
REG_UNIT = 256
MAX_REGS_THREAD = 255
SMEM_SM = 228 * 1024
SMEM_BLOCK = 227 * 1024
SMEM_RESERVED = 1024
SMEM_UNIT = 128


def ceil_to(x, unit):
    return -(-x // unit) * unit


def occupancy(threads, regs, smem):
    """Return (resident blocks, resident warps, limits) for one launch."""
    warps_per_block = -(-threads // WARP)
    by_warps = MAX_WARPS // warps_per_block
    by_blocks = MAX_BLOCKS

    regs_per_warp = ceil_to(regs * WARP, REG_UNIT)
    if regs > MAX_REGS_THREAD or regs_per_warp * ceil_to(warps_per_block, SUBPARTITIONS) > REGS_SM:
        by_regs = 0
    else:
        warps_per_subpartition = (REGS_SM // SUBPARTITIONS) // regs_per_warp
        by_regs = (warps_per_subpartition * SUBPARTITIONS) // warps_per_block

    smem_alloc = ceil_to(smem + SMEM_RESERVED, SMEM_UNIT)
    by_smem = 0 if smem > SMEM_BLOCK else SMEM_SM // smem_alloc

    blocks = min(by_warps, by_blocks, by_regs, by_smem)
    limits = {"warps": by_warps, "blocks": by_blocks, "regs": by_regs, "smem": by_smem}
    return blocks, blocks * warps_per_block, limits


def main(path):
    rows = list(csv.DictReader(open(path)))
    bad = 0
    for row in rows:
        t, r, s = int(row["threads"]), int(row["regs"]), int(row["smem_bytes"])
        blocks, warps, lim = occupancy(t, r, s)
        ref = (int(row["blocks"]), int(row["limit_warps"]), int(row["limit_regs"]),
               int(row["limit_smem"]), int(row["limit_blocks"]))
        got = (blocks, lim["warps"], lim["regs"], lim["smem"], lim["blocks"])
        if got != ref:
            bad += 1
            print("mismatch", t, r, s, "python", got, "nvidia", ref)
    print(f"occupancy.py vs cuda_occupancy.h: {len(rows)} configurations, {bad} mismatches")
    return bad


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1]) else 0)
