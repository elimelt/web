"""A DDPM on 2D point clouds, in NumPy only.

This is the harness behind the measurements and the figures in
ml/deep-learning/diffusion-models. It trains a small noise-prediction MLP with
the DDPM objective (Ho et al. 2020, Algorithm 1), samples with the generalized
DDIM update (Song et al. 2020), which is ancestral DDPM at eta=1 and the
deterministic DDIM sampler at eta=0, and scores samples by the exact
2-Wasserstein distance to held-out data.

Everything is written out by hand (forward pass, backward pass, Adam), so the
same arithmetic can be checked line by line against the browser figure.

Run from this directory:

    python3 diffusion2d.py train      # trains every dataset and seed, writes runs/
                                      # (or `train moons` to train one dataset)
    python3 diffusion2d.py evaluate   # sample quality vs number of steps, writes runs/eval-*.json
    python3 diffusion2d.py collect    # gathers them into results.json
    python3 diffusion2d.py export     # browser weights and test fixtures

Needs numpy, scipy and scikit-learn.
"""

from __future__ import annotations

import base64
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree
from sklearn.datasets import make_moons, make_swiss_roll

HERE = Path(__file__).resolve().parent
RUNS = HERE / "runs"

T = 1000
HIDDEN = 64
LAYERS = 3
FREQS = 16  # sinusoidal time embedding: 16 sines + 16 cosines
DATASETS = ["moons", "eight", "spiral"]
SEEDS = [0, 1, 2]
STEPS = [1, 2, 3, 5, 10, 20, 50, 100, 250, 1000]
N_TRAIN = 20_000
N_EVAL = 2_000

# ---------------------------------------------------------------------------
# Data


def raw_dataset(name: str, n: int, rng: np.random.Generator) -> np.ndarray:
    seed = int(rng.integers(2**31))
    if name == "moons":
        x, _ = make_moons(n, noise=0.05, random_state=seed)
    elif name == "spiral":
        x3, _ = make_swiss_roll(n, noise=0.3, random_state=seed)
        x = x3[:, [0, 2]]
    elif name == "eight":
        centers = np.array([(math.cos(2 * math.pi * k / 8), math.sin(2 * math.pi * k / 8)) for k in range(8)])
        x = centers[rng.integers(8, size=n)] * 2.0 + 0.1 * rng.standard_normal((n, 2))
    else:
        raise ValueError(name)
    return x.astype(np.float64)


# Each dataset is shifted and scaled once, from a large reference draw, to zero
# mean and unit variance per coordinate, the scale the DDPM schedule assumes.
_NORM: dict[str, tuple[np.ndarray, np.ndarray]] = {}


def dataset(name: str, n: int, seed: int) -> np.ndarray:
    if name not in _NORM:
        ref = raw_dataset(name, 200_000, np.random.default_rng(12345))
        _NORM[name] = (ref.mean(0), ref.std(0))
    mean, std = _NORM[name]
    return (raw_dataset(name, n, np.random.default_rng(seed)) - mean) / std


# ---------------------------------------------------------------------------
# Schedule


def linear_schedule(t_max: int = T, beta_start: float = 1e-4, beta_end: float = 0.02):
    betas = np.linspace(beta_start, beta_end, t_max, dtype=np.float64)
    alpha_bars = np.cumprod(1.0 - betas)
    return betas, alpha_bars


def cosine_alpha_bars(t_max: int = T, s: float = 0.008) -> np.ndarray:
    """Nichol and Dhariwal (2021), eq. 17, with betas clipped at 0.999."""
    f = lambda t: np.cos(((t / t_max) + s) / (1 + s) * np.pi / 2) ** 2
    t = np.arange(t_max + 1, dtype=np.float64)
    ab = f(t) / f(0)
    betas = np.clip(1 - ab[1:] / ab[:-1], 0, 0.999)
    return np.cumprod(1 - betas)


BETAS, ALPHA_BARS = linear_schedule()

# ---------------------------------------------------------------------------
# Model: eps_theta(x_t, t) = MLP([x_t, embed(t)])


def embed(t: np.ndarray) -> np.ndarray:
    """Transformer-style sinusoidal embedding of the integer timestep index."""
    freqs = np.exp(-math.log(10000.0) * np.arange(FREQS) / FREQS)
    args = np.asarray(t, dtype=np.float64)[:, None] * freqs[None, :]
    return np.concatenate([np.sin(args), np.cos(args)], axis=1)


def init_params(rng: np.random.Generator) -> list[np.ndarray]:
    sizes = [2 + 2 * FREQS] + [HIDDEN] * LAYERS + [2]
    params = []
    for i, (a, b) in enumerate(zip(sizes[:-1], sizes[1:])):
        scale = math.sqrt(2.0 / a) if i < len(sizes) - 2 else 1e-3
        params.append((rng.standard_normal((a, b)) * scale).astype(np.float32))
        params.append(np.zeros(b, dtype=np.float32))
    return params


def sigmoid(z):
    return 0.5 * (1.0 + np.tanh(0.5 * z))  # no overflow for large |z|


def silu(z):
    return z * sigmoid(z)


def forward(params, x, t, keep=False):
    h = np.concatenate([x, embed(t)], axis=1).astype(params[0].dtype)
    cache = [h]
    n_layers = len(params) // 2
    for i in range(n_layers):
        z = h @ params[2 * i] + params[2 * i + 1]
        if i < n_layers - 1:
            cache.append(z)
            h = silu(z)
            cache.append(h)
        else:
            h = z
    return (h, cache) if keep else h


def loss_and_grads(params, x, t, eps):
    out, cache = forward(params, x, t, keep=True)
    n = x.shape[0]
    diff = out - eps
    loss = float(np.mean(np.sum(diff**2, axis=1)))
    g = (2.0 / n) * diff
    grads = [None] * len(params)
    n_layers = len(params) // 2
    for i in reversed(range(n_layers)):
        h_in = cache[2 * i]
        grads[2 * i] = h_in.T @ g
        grads[2 * i + 1] = g.sum(0)
        if i > 0:
            g = g @ params[2 * i].T
            z = cache[2 * i - 1]
            s = sigmoid(z)
            g = g * (s * (1.0 + z * (1.0 - s)))
    return loss, grads


# ---------------------------------------------------------------------------
# Training: Ho et al. (2020), Algorithm 1


def train(name: str, seed: int, steps: int = 50_000, batch: int = 1024, lr: float = 2e-3, ema_decay: float = 0.999):
    rng = np.random.default_rng(1000 + seed)
    data = dataset(name, N_TRAIN, seed=seed)
    params = init_params(rng)
    ema = [p.copy() for p in params]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    b1, b2, adam_eps = 0.9, 0.999, 1e-8
    log = []
    start = time.time()
    for step in range(1, steps + 1):
        x0 = data[rng.integers(N_TRAIN, size=batch)]
        t = rng.integers(T, size=batch)
        eps = rng.standard_normal((batch, 2))
        ab = ALPHA_BARS[t][:, None]
        xt = (np.sqrt(ab) * x0 + np.sqrt(1 - ab) * eps).astype(np.float32)
        loss, grads = loss_and_grads(params, xt, t, eps.astype(np.float32))
        rate = lr * 0.5 * (1 + math.cos(math.pi * step / steps))  # cosine decay to zero
        for i, g in enumerate(grads):
            m[i] = b1 * m[i] + (1 - b1) * g
            v[i] = b2 * v[i] + (1 - b2) * g * g
            mh = m[i] / (1 - b1**step)
            vh = v[i] / (1 - b2**step)
            params[i] -= (rate * mh / (np.sqrt(vh) + adam_eps)).astype(np.float32)
            ema[i] = ema_decay * ema[i] + (1 - ema_decay) * params[i]
        if step % 1000 == 0:
            log.append({"step": step, "loss": loss})
    return ema, log, time.time() - start


def save(path: Path, params):
    np.savez(path, *params)


def load(path: Path):
    with np.load(path) as f:
        return [f[f"arr_{i}"] for i in range(len(f.files))]


# ---------------------------------------------------------------------------
# Sampling: the generalized update of Song et al. (2020), eq. 12


def timesteps(k: int) -> list[int]:
    """k timestep indices from T-1 down to 0, evenly spaced (the "linear" DDIM subsequence)."""
    return [int(round(x)) for x in np.linspace(T - 1, 0, k)] if k > 1 else [T - 1]


def sample(params, n: int, k: int, eta: float, seed: int, alpha_bars=ALPHA_BARS, trajectory: bool = False, x_init=None, noises=None):
    """eta=1: ancestral DDPM on the respaced schedule. eta=0: deterministic DDIM.
    eta="beta": the DDPM posterior mean with the larger variance sigma^2 = beta
    (respaced), the choice behind DDPM's FID of 3.17 ("sigma-hat" in DDIM's Table 1).

    Returns the final samples, or with trajectory=True the list of states
    x_T, ..., x_0 and the model's x0 prediction at each step.
    """
    rng = np.random.default_rng(seed)
    x = rng.standard_normal((n, 2)) if x_init is None else np.array(x_init, dtype=np.float64)
    params64 = [p.astype(np.float64) for p in params]
    ts = timesteps(k)
    states, preds = [x.copy()], []
    for i, t in enumerate(ts):
        ab_t = alpha_bars[t]
        ab_prev = alpha_bars[ts[i + 1]] if i + 1 < len(ts) else 1.0
        eps_hat = forward(params64, x, np.full(n, t))
        x0_hat = (x - np.sqrt(1 - ab_t) * eps_hat) / np.sqrt(ab_t)
        if eta == "beta":
            tilde = np.sqrt((1 - ab_prev) / (1 - ab_t) * (1 - ab_t / ab_prev))
            x = np.sqrt(ab_prev) * x0_hat + np.sqrt(1 - ab_prev - tilde**2) * eps_hat
            sigma = np.sqrt(1 - ab_t / ab_prev) if i + 1 < len(ts) else 0.0  # no noise on the last step
        else:
            sigma = eta * np.sqrt((1 - ab_prev) / (1 - ab_t) * (1 - ab_t / ab_prev))
            direction = np.sqrt(np.maximum(1 - ab_prev - sigma**2, 0.0)) * eps_hat
            x = np.sqrt(ab_prev) * x0_hat + direction
        if sigma > 0:
            z = rng.standard_normal((n, 2)) if noises is None else noises[i]
            x = x + sigma * z
        states.append(x.copy())
        preds.append(x0_hat.copy())
    return (states, preds) if trajectory else x


# ---------------------------------------------------------------------------
# Metric: exact W2 between equal-size point sets (optimal matching)


def w2(a: np.ndarray, b: np.ndarray) -> float:
    cost = ((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)
    r, c = linear_sum_assignment(cost)
    return float(np.sqrt(cost[r, c].mean()))


def nn_mean(a: np.ndarray, b: np.ndarray) -> float:
    """Mean distance from each point of a to its nearest neighbour in b."""
    return float(cKDTree(b).query(a)[0].mean())


def scores(test: np.ndarray, ref: np.ndarray, x: np.ndarray) -> dict:
    """W2 to the test set, plus the two halves of what W2 mixes together:
    off = how far samples sit from the data (blur, points between modes),
    miss = how far data sits from the samples (collapse, missing modes)."""
    return {"w2": w2(test, x), "off": nn_mean(x, ref), "miss": nn_mean(test, x)}


# ---------------------------------------------------------------------------
# Commands


def cmd_train(*names: str):
    RUNS.mkdir(exist_ok=True)
    meta = {}
    for name in names or DATASETS:
        for seed in SEEDS:
            ema, log, secs = train(name, seed)
            save(RUNS / f"{name}-{seed}.npz", ema)
            meta[f"{name}-{seed}"] = {"seconds": round(secs, 1), "final_loss": log[-1]["loss"], "log": log}
            print(f"{name} seed {seed}: {secs:.0f}s, loss {log[-1]['loss']:.4f}", flush=True)
    tag = "-".join(names) if names else "all"
    (RUNS / f"train-log-{tag}.json").write_text(json.dumps(meta, indent=1))


def cmd_evaluate(*names: str):
    for name in names or DATASETS:
        test_a = dataset(name, N_EVAL, seed=900)
        ref = dataset(name, 20_000, seed=950)  # for nearest-neighbour distances
        real = [scores(test_a, ref, dataset(name, N_EVAL, seed=901 + i)) for i in range(3)]
        prior = scores(test_a, ref, np.random.default_rng(0).standard_normal((N_EVAL, 2)))
        entry = {"real": real, "prior": prior}
        for sampler, eta in [("ddpm", 1.0), ("ddim", 0.0), ("ddpm_beta", "beta")]:
            entry[sampler] = {}
            for k in STEPS:
                runs = []
                for seed in SEEDS:
                    params = load(RUNS / f"{name}-{seed}.npz")
                    for s in range(2):
                        runs.append(scores(test_a, ref, sample(params, N_EVAL, k, eta, seed=10_000 + 100 * seed + s)))
                entry[sampler][str(k)] = runs
                w = [r["w2"] for r in runs]
                print(f"{name} {sampler} k={k}: W2 {np.mean(w):.3f} ± {np.std(w):.3f}, off {np.mean([r['off'] for r in runs]):.3f}, miss {np.mean([r['miss'] for r in runs]):.3f}", flush=True)
        (RUNS / f"eval-{name}.json").write_text(json.dumps(entry))


def cmd_collect():
    """Gathers runs/eval-*.json into results.json."""
    results = {"steps": STEPS, "n": N_EVAL, "seeds": SEEDS, "sample_seeds_per_model": 2, "datasets": {}}
    for name in DATASETS:
        results["datasets"][name] = json.loads((RUNS / f"eval-{name}.json").read_text())
    (HERE / "results.json").write_text(json.dumps(results, indent=1))


def f16_b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype="<f2").tobytes()).decode()


def cmd_export():
    """Browser weights (seed 0, float16) and fixtures the figure's tests check against."""
    out = HERE
    fixtures = {"T": T, "freqs": FREQS, "datasets": {}}
    for name in DATASETS:
        params = load(RUNS / f"{name}-0.npz")
        half = [p.astype(np.float16).astype(np.float64) for p in params]
        points = dataset(name, 600, seed=777)
        blob = {
            "T": T,
            "hidden": HIDDEN,
            "layers": LAYERS,
            "freqs": FREQS,
            "schedule": {"kind": "linear", "beta_start": 1e-4, "beta_end": 0.02},
            "shapes": [list(p.shape) for p in params],
            "weights": [f16_b64(p) for p in params],
        }
        (out / f"points-{name}.json").write_text(json.dumps({"points": np.round(points, 3).tolist()}, separators=(",", ":")))
        (out / f"weights-{name}.json").write_text(json.dumps(blob, separators=(",", ":")))
        # Fixtures: eps predictions at fixed inputs, and short deterministic and
        # stochastic trajectories from a fixed start, computed with the same
        # float16-rounded weights the browser loads.
        rng = np.random.default_rng(42)
        xs = rng.standard_normal((16, 2)) * 1.5
        ts = rng.integers(T, size=16)
        eps = forward(half, xs, ts)
        start = rng.standard_normal((8, 2))
        ddim10, preds = sample(half, 8, 10, 0.0, seed=0, trajectory=True, x_init=start)
        noises = rng.standard_normal((10, 8, 2))
        ddpm10, _ = sample(half, 8, 10, 1.0, seed=0, trajectory=True, x_init=start, noises=noises)
        fixtures["datasets"][name] = {
            "x": xs.tolist(),
            "t": ts.tolist(),
            "eps": eps.tolist(),
            "start": start.tolist(),
            "ddim10": [s.tolist() for s in ddim10],
            "ddim10_x0": [p.tolist() for p in preds],
            "noises": noises.tolist(),
            "ddpm10": [s.tolist() for s in ddpm10],
        }
    fixtures["timesteps"] = {str(k): timesteps(k) for k in [1, 2, 3, 4, 5, 7, 10, 20, 50, 100, 250, 1000]}
    fixtures["alpha_bars_linear"] = {str(t): ALPHA_BARS[t] for t in [0, 1, 99, 249, 499, 749, 999]}
    fixtures["alpha_bars_cosine"] = {str(t): cosine_alpha_bars()[t - 1] for t in [1, 100, 250, 500, 750, 1000]}
    (HERE / "fixtures.json").write_text(json.dumps(fixtures))
    for f in sorted(out.glob("weights-*.json")):
        print(f.name, f.stat().st_size, "bytes")


if __name__ == "__main__":
    {"train": cmd_train, "evaluate": cmd_evaluate, "collect": cmd_collect, "export": cmd_export}[sys.argv[1]](*sys.argv[2:])
