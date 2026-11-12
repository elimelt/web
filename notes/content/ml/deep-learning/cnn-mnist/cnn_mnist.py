"""Train a small CNN and two MLPs on MNIST with NumPy, then test how each
copes with shifted digits.

This is the experiment behind the "Convolutional Neural Networks" note. It
backs two claims there with measurements instead of folklore:

1. Weight sharing buys accuracy per parameter: an 11k-parameter CNN against an
   MLP with the same parameter count and one with 18 times as many.
2. Convolution is translation-equivariant, but the trained network is only
   partly translation-invariant: accuracy and prediction stability under
   whole-pixel shifts of the test digits.

It also exports the trained CNN's weights and a few test digits for the
note's in-browser figure, which runs the same forward pass in JavaScript.

Run from notes/ (about 5 minutes on 4 CPU cores, nearly all of it the CNN):

    python3 content/ml/deep-learning/cnn-mnist/cnn_mnist.py \
        --data work/notebook-data/mnist/mnist.npz

The data file is Keras's copy of MNIST:
https://storage.googleapis.com/tensorflow/tf-keras-datasets/mnist.npz
(SHA-256 731c5ac602752760c8e48fbffcf8c3b850d9dc2a2aedcf2cc48468fc17b673d1).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import time
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

HERE = Path(__file__).resolve().parent
SEED = 0


# ---------------------------------------------------------------- layers
#
# Tensors are (batch, channels, height, width). Every convolution here is
# stride 1 with "same" padding, which keeps im2col and its gradient short.


def im2col(x: np.ndarray, k: int) -> np.ndarray:
    """(N, C, H, W) padded by k//2 -> (N*H*W, C*k*k) patches."""
    p = k // 2
    xp = np.pad(x, ((0, 0), (0, 0), (p, p), (p, p)))
    win = sliding_window_view(xp, (k, k), axis=(2, 3))  # N, C, H, W, k, k
    n, c, h, w = x.shape
    return win.transpose(0, 2, 3, 1, 4, 5).reshape(n * h * w, c * k * k)


def conv_forward(x, w, b):
    """Cross-correlation, as in every deep-learning library. w: (O, C, k, k)."""
    n, _, h, wd = x.shape
    o, _, k, _ = w.shape
    cols = im2col(x, k)
    out = cols @ w.reshape(o, -1).T + b
    return out.reshape(n, h, wd, o).transpose(0, 3, 1, 2), cols


def conv_backward(dout, x, w, cols):
    n, o, h, wd = dout.shape
    k = w.shape[2]
    d2 = dout.transpose(0, 2, 3, 1).reshape(-1, o)
    dw = (d2.T @ cols).reshape(w.shape)
    db = d2.sum(axis=0)
    # The input gradient of a same-padded stride-1 correlation is a
    # same-padded correlation of dout with the kernel rotated by 180 degrees
    # and its in/out channels swapped.
    w_flip = w[:, :, ::-1, ::-1].transpose(1, 0, 2, 3)
    dx, _ = conv_forward(dout, w_flip, 0.0)
    return dx, dw, db


def pool_forward(x):
    """2x2 max pooling. The mask marks the one input each output came from."""
    n, c, h, w = x.shape
    win = x.reshape(n, c, h // 2, 2, w // 2, 2).transpose(0, 1, 2, 4, 3, 5).reshape(n, c, h // 2, w // 2, 4)
    arg = win.argmax(axis=-1)
    out = np.take_along_axis(win, arg[..., None], axis=-1)[..., 0]
    return out, arg


def pool_backward(dout, arg):
    n, c, h, w = dout.shape
    win = np.zeros((n, c, h, w, 4), dout.dtype)
    np.put_along_axis(win, arg[..., None], dout[..., None], axis=-1)
    return win.reshape(n, c, h, w, 2, 2).transpose(0, 1, 2, 4, 3, 5).reshape(n, c, h * 2, w * 2)


def softmax_xent(logits, y):
    z = logits - logits.max(axis=1, keepdims=True)
    p = np.exp(z)
    p /= p.sum(axis=1, keepdims=True)
    loss = -np.log(p[np.arange(len(y)), y] + 1e-12).mean()
    dz = p
    dz[np.arange(len(y)), y] -= 1
    return loss, dz / len(y)


# ---------------------------------------------------------------- models


class CNN:
    """conv5x5(1->8) relu pool2 conv5x5(8->16) relu pool2 linear(784->10)."""

    name = "cnn"

    def __init__(self, rng: np.random.Generator):
        he = lambda fan_in, shape: rng.normal(0, np.sqrt(2 / fan_in), shape).astype(np.float32)
        self.params = {
            "w1": he(25, (8, 1, 5, 5)),
            "b1": np.zeros(8, np.float32),
            "w2": he(200, (16, 8, 5, 5)),
            "b2": np.zeros(16, np.float32),
            "w3": he(784, (784, 10)),
            "b3": np.zeros(10, np.float32),
        }

    def forward(self, x, keep=False):
        p = self.params
        a1, c1 = conv_forward(x, p["w1"], p["b1"])
        r1 = np.maximum(a1, 0)
        q1, m1 = pool_forward(r1)
        a2, c2 = conv_forward(q1, p["w2"], p["b2"])
        r2 = np.maximum(a2, 0)
        q2, m2 = pool_forward(r2)
        flat = q2.reshape(len(x), -1)
        logits = flat @ p["w3"] + p["b3"]
        cache = (x, a1, c1, m1, q1, a2, c2, m2, flat) if keep else None
        return logits, cache

    def backward(self, dlogits, cache):
        p = self.params
        x, a1, c1, m1, q1, a2, c2, m2, flat = cache
        g = {"w3": flat.T @ dlogits, "b3": dlogits.sum(axis=0)}
        dq2 = (dlogits @ p["w3"].T).reshape(len(x), 16, 7, 7)
        da2 = pool_backward(dq2, m2) * (a2 > 0)
        dq1, g["w2"], g["b2"] = conv_backward(da2, q1, p["w2"], c2)
        da1 = pool_backward(dq1, m1) * (a1 > 0)
        _, g["w1"], g["b1"] = conv_backward(da1, x, p["w1"], c1)
        return g


class MLP:
    def __init__(self, rng: np.random.Generator, hidden: int):
        self.name = f"mlp{hidden}"
        self.params = {
            "w1": rng.normal(0, np.sqrt(2 / 784), (784, hidden)).astype(np.float32),
            "b1": np.zeros(hidden, np.float32),
            "w2": rng.normal(0, np.sqrt(2 / hidden), (hidden, 10)).astype(np.float32),
            "b2": np.zeros(10, np.float32),
        }

    def forward(self, x, keep=False):
        p = self.params
        flat = x.reshape(len(x), -1)
        a = flat @ p["w1"] + p["b1"]
        h = np.maximum(a, 0)
        logits = h @ p["w2"] + p["b2"]
        return logits, ((flat, a, h) if keep else None)

    def backward(self, dlogits, cache):
        p = self.params
        flat, a, h = cache
        dh = (dlogits @ p["w2"].T) * (a > 0)
        return {
            "w2": h.T @ dlogits,
            "b2": dlogits.sum(axis=0),
            "w1": flat.T @ dh,
            "b1": dh.sum(axis=0),
        }


def n_params(model) -> int:
    return int(sum(v.size for v in model.params.values()))


# ---------------------------------------------------------------- training


def train(model, x, y, epochs, rng, lr=0.05, momentum=0.9, batch=128):
    velocity = {k: np.zeros_like(v) for k, v in model.params.items()}
    history = []
    for epoch in range(epochs):
        start = time.perf_counter()
        order = rng.permutation(len(x))
        step_lr = lr * 0.5 * (1 + np.cos(np.pi * epoch / epochs))  # cosine decay per epoch
        losses = []
        for i in range(0, len(x), batch):
            idx = order[i : i + batch]
            logits, cache = model.forward(x[idx], keep=True)
            loss, dlogits = softmax_xent(logits, y[idx])
            grads = model.backward(dlogits, cache)
            for k, g in grads.items():
                velocity[k] = momentum * velocity[k] - step_lr * g.astype(np.float32)
                model.params[k] += velocity[k]
            losses.append(loss)
        history.append({"epoch": epoch + 1, "train_loss": float(np.mean(losses)), "seconds": time.perf_counter() - start})
        print(f"{model.name} epoch {epoch + 1}: loss {history[-1]['train_loss']:.4f} ({history[-1]['seconds']:.1f}s)")
    return history


def predict(model, x, batch=1000):
    return np.concatenate([model.forward(x[i : i + batch])[0].argmax(axis=1) for i in range(0, len(x), batch)])


def shift(x, dy, dx):
    """Translate whole images by whole pixels, filling with zeros (background)."""
    out = np.zeros_like(x)
    h, w = x.shape[-2:]
    out[..., max(dy, 0) : h + min(dy, 0), max(dx, 0) : w + min(dx, 0)] = x[
        ..., max(-dy, 0) : h + min(-dy, 0), max(-dx, 0) : w + min(-dx, 0)
    ]
    return out


# ---------------------------------------------------------------- main


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, required=True, help="Keras mnist.npz")
    parser.add_argument("--epochs", type=int, default=6)
    args = parser.parse_args()

    raw = args.data.read_bytes()
    data = np.load(args.data)
    x_train = (data["x_train"].astype(np.float32) / 255.0)[:, None]
    x_test = (data["x_test"].astype(np.float32) / 255.0)[:, None]
    y_train, y_test = data["y_train"].astype(np.int64), data["y_test"].astype(np.int64)

    results = {
        "environment": {
            "cpu": next((l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name")), platform.processor()),
            "cores": os.cpu_count(),
            "python": platform.python_version(),
            "numpy": np.__version__,
            "data_sha256": hashlib.sha256(raw).hexdigest(),
        },
        "setup": {
            "train_images": len(x_train),
            "test_images": len(x_test),
            "epochs": args.epochs,
            "optimizer": "SGD, momentum 0.9, batch 128, lr 0.05 with per-epoch cosine decay",
            "seed": SEED,
            "augmentation": "none",
        },
        "models": {},
    }

    models = []
    for make in (lambda r: CNN(r), lambda r: MLP(r, 14), lambda r: MLP(r, 256)):
        rng = np.random.default_rng(SEED)
        model = make(rng)
        history = train(model, x_train, y_train, args.epochs, rng)
        base = predict(model, x_test)
        shifts = {}
        for d in range(-6, 7):
            pred = predict(model, shift(x_test, 0, d))
            shifts[str(d)] = float((pred == y_test).mean())
        # Prediction stability: does a 1-pixel shift in any of four directions
        # change the predicted class?
        changed = np.zeros(len(x_test), bool)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            changed |= predict(model, shift(x_test, dy, dx)) != base
        results["models"][model.name] = {
            "params": n_params(model),
            "test_accuracy": float((base == y_test).mean()),
            "accuracy_by_horizontal_shift": shifts,
            "changed_by_1px_shift": float(changed.mean()),
            "history": history,
        }
        models.append(model)
        print(json.dumps({k: v for k, v in results["models"][model.name].items() if k != "history"}))

    out = HERE / "cnn_mnist_results.json"
    out.write_text(json.dumps(results, indent=2) + "\n")
    print(f"wrote {out}")

    # Export the CNN and some test digits for the in-browser figure.
    cnn = models[0]
    picks = [int(np.flatnonzero(y_test == d)[0]) for d in range(10)]
    logits, _ = cnn.forward(x_test[picks])
    export = {
        "description": "Weights of the CNN trained by cnn_mnist.py, and the first test image of each digit.",
        "architecture": "conv5x5(1->8, pad 2) relu maxpool2 conv5x5(8->16, pad 2) relu maxpool2 linear(784->10)",
        "test_accuracy": results["models"]["cnn"]["test_accuracy"],
        # Six significant digits keep the browser's logits within 1e-4 of NumPy's.
        "weights": {k: [float(f"{x:.6g}") for x in v.ravel()] for k, v in cnn.params.items()},
        "shapes": {k: list(v.shape) for k, v in cnn.params.items()},
        "digits": [
            {"index": i, "label": int(y_test[i]), "pixels": data["x_test"][i].ravel().tolist(), "logits": [round(float(x), 4) for x in l]}
            for i, l in zip(picks, logits)
        ],
    }
    model_out = HERE / "cnn_mnist_model.json"
    model_out.write_text(json.dumps(export, separators=(",", ":")) + "\n")
    print(f"wrote {model_out}")


if __name__ == "__main__":
    main()
