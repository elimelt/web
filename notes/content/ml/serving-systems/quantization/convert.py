"""Convert Google's mesh-tensorflow T5 v1.1 checkpoints to a float32 .npz.

The checkpoints (gs://t5-data/pretrained_models/t5.1.1.lm100k.{small,base,large})
store weights as bfloat16; bfloat16 -> float32 is exact, so the .npz holds the
released weights bit for bit. Optimizer slots are dropped.

usage: python3 convert.py CKPT_PREFIX OUT.npz
"""
import sys
import numpy as np
import tensorflow as tf

def main(prefix, out):
    r = tf.train.load_checkpoint(prefix)
    arrays = {}
    for name in r.get_variable_to_shape_map():
        if "slot" in name or name == "global_step":
            continue
        arrays[name] = np.asarray(tf.cast(tf.constant(r.get_tensor(name)), tf.float32))
    np.savez(out, **arrays)
    n = sum(a.size for a in arrays.values())
    print(f"{len(arrays)} tensors, {n/1e6:.1f}M parameters -> {out}")

if __name__ == "__main__":
    main(*sys.argv[1:])
