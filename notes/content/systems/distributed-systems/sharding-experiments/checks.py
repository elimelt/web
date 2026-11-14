"""Independent checks on shard_exp.py's hashing code.

    pip install uhashring
    python3 checks.py

1. Its ketama ring sends 20,000 keys to the same servers as the uhashring
   package's ketama implementation.
2. With one point per server, the busiest server's share of the ring,
   divided by the fair share 1/n, averages the harmonic number H_n over many
   random placements: the largest of the n gaps between n uniform points on a
   circle has mean H_n / n.
"""

import numpy as np
from uhashring import HashRing

import shard_exp as s

nodes = [f"10.0.0.{i}:11211" for i in range(32)]
ring = HashRing(nodes=nodes, hash_fn="ketama")
toks, owner = s.ketama_ring(32, 0)
keys = [str(i * 7919) for i in range(20000)]
mine = s.lookup(toks, owner, s.ketama_keypos(keys))
theirs = np.array([nodes.index(ring.get_node(k)) for k in keys])
print(f"ketama agreement with uhashring: {np.mean(theirs == mine):.4f}")

for n in (8, 32):
    peaks = [s.peak(s.arc_shares(*s.ring(n, 1, seed), n)) for seed in range(2000)]
    h = sum(1 / i for i in range(1, n + 1))
    se = np.std(peaks, ddof=1) / np.sqrt(len(peaks))
    print(f"n={n}: mean peak over 2000 placements {np.mean(peaks):.3f} +- {se:.3f}, H_n = {h:.3f}")
