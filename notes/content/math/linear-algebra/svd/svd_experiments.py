"""Experiments for the SVD note.

Run from notes/:

    python3 content/math/linear-algebra/svd/svd_experiments.py \
        --mnist work/notebook-data/mnist/mnist.npz

Writes svd_results.json beside this file, the 256x256 grayscale image the
in-page figure decomposes (astronaut_256.png) and that image's singular values
(astronaut_256_singular_values.json), which the figure's tests check against. Needs numpy, Pillow and
scikit-image (for the astronaut photo, a NASA image bundled with it, and SSIM).

Sections:
  1. image:      truncated SVD of a 512x512 photo; Eckart-Young checked
                 numerically; rank-k with 8-bit factors versus JPEG at the
                 same byte budget.
  2. shuffled:   the same pixels in random order, as a control.
  3. stability:  singular values from svd versus sqrt(eig(A^T A)).
  4. randomized: Halko-Martinsson-Tropp randomized SVD versus LAPACK on
                 MNIST (60000 x 784) and the photo.
  5. pca:        variance explained by principal components of MNIST.
"""

from __future__ import annotations

import argparse
import io
import json
import platform
import time
import zlib
from pathlib import Path

import numpy as np
from PIL import Image
from skimage import color, data
from skimage.metrics import structural_similarity

HERE = Path(__file__).resolve().parent


def psnr(ref: np.ndarray, test: np.ndarray) -> float:
    mse = np.mean((ref - test) ** 2)
    return float(10 * np.log10(1.0 / mse))


def photo() -> np.ndarray:
    """skimage's astronaut photo as float64 luma in [0, 1], 512 x 512."""
    return color.rgb2gray(data.astronaut()).astype(np.float64)


def downsample2(img: np.ndarray) -> np.ndarray:
    return img.reshape(img.shape[0] // 2, 2, img.shape[1] // 2, 2).mean(axis=(1, 3))


# 1. Truncated SVD of the photo -------------------------------------------------


def quantized_rank_k(U, s, Vt, k):
    """Rank-k reconstruction from factors stored as int8 with one float32
    scale per vector. Returns the image and the zlib-compressed byte count."""
    us = U[:, :k] * np.sqrt(s[:k])
    vs = Vt[:k].T * np.sqrt(s[:k])
    payload = bytearray()
    deq = []
    for M in (us, vs):
        scale = np.abs(M).max(axis=0) / 127.0
        q = np.round(M / scale).astype(np.int8)
        payload += q.tobytes() + scale.astype(np.float32).tobytes()
        deq.append(q.astype(np.float64) * scale)
    approx = deq[0] @ deq[1].T
    return np.clip(approx, 0, 1), len(zlib.compress(bytes(payload), 9))


def jpeg_at_budget(img: np.ndarray, budget: int):
    """Highest-quality grayscale JPEG whose file fits in `budget` bytes."""
    pil = Image.fromarray(np.round(img * 255).astype(np.uint8), mode="L")
    best = None
    for q in range(1, 96):
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=q, optimize=True)
        if buf.tell() <= budget:
            dec = np.asarray(Image.open(io.BytesIO(buf.getvalue())), dtype=np.float64) / 255
            best = (q, buf.tell(), dec)
    return best


def image_experiment(img: np.ndarray) -> dict:
    m, n = img.shape
    U, s, Vt = np.linalg.svd(img, full_matrices=False)
    total = float(np.sum(s**2))
    ranks = [1, 2, 5, 10, 20, 30, 50, 100, 200]
    rows = []
    for k in ranks:
        Ak = (U[:, :k] * s[:k]) @ Vt[:k]
        R = img - Ak
        spec = float(np.linalg.norm(R, 2))
        frob = float(np.linalg.norm(R, "fro"))
        qimg, qbytes = quantized_rank_k(U, s, Vt, k)
        jpg = jpeg_at_budget(img, qbytes)
        row = {
            "k": k,
            "stored_values": k * (m + n + 1),
            "stored_fraction": k * (m + n + 1) / (m * n),
            "energy_kept": float(np.sum(s[:k] ** 2) / total),
            "spectral_error": spec,
            "sigma_k_plus_1": float(s[k]),
            "frobenius_error": frob,
            "frobenius_tail": float(np.sqrt(np.sum(s[k:] ** 2))),
            "relative_frobenius_error": frob / float(np.sqrt(total)),
            "psnr_float": psnr(img, np.clip(Ak, 0, 1)),
            "psnr_int8_factors": psnr(img, qimg),
            "ssim_int8_factors": float(structural_similarity(img, qimg, data_range=1.0)),
            "int8_factor_bytes_zlib": qbytes,
        }
        if jpg:
            q, size, dec = jpg
            row |= {"jpeg_quality": q, "jpeg_bytes": size, "jpeg_psnr": psnr(img, dec),
                    "jpeg_ssim": float(structural_similarity(img, dec, data_range=1.0))}
        rows.append(row)
    return {
        "shape": [m, n],
        "singular_values": s.tolist(),
        "ranks": rows,
        "rank_for_energy": {str(f): int(np.searchsorted(np.cumsum(s**2) / total, f) + 1) for f in (0.9, 0.99, 0.999)},
    }


def shuffled_experiment(img: np.ndarray) -> dict:
    rng = np.random.default_rng(0)
    sh = rng.permutation(img.ravel()).reshape(img.shape)
    s = np.linalg.svd(sh, compute_uv=False)
    total = np.sum(s**2)
    s_img = np.linalg.svd(img, compute_uv=False)
    tot_img = np.sum(s_img**2)
    # The mean is a rank-one component; subtract it to compare the structure.
    s_c = np.linalg.svd(img - img.mean(), compute_uv=False)
    s_shc = np.linalg.svd(sh - sh.mean(), compute_uv=False)
    def frac(sv, k):
        return float(np.sum(sv[:k] ** 2) / np.sum(sv**2))
    return {
        "singular_values": s.tolist(),
        "energy_kept": {str(k): {"photo": frac(s_img, k), "shuffled": frac(s, k),
                                  "photo_centered": frac(s_c, k), "shuffled_centered": frac(s_shc, k)} for k in (1, 10, 20, 50, 100)},
        "rank_for_energy_0.9": {"photo_centered": int(np.searchsorted(np.cumsum(s_c**2) / np.sum(s_c**2), 0.9) + 1),
                                 "shuffled_centered": int(np.searchsorted(np.cumsum(s_shc**2) / np.sum(s_shc**2), 0.9) + 1)},
        "sigma1_over_total": {"photo": float(s_img[0] ** 2 / tot_img), "shuffled": float(s[0] ** 2 / total)},
    }


# 3. Why not eig(A^T A) ----------------------------------------------------------


def stability_experiment(seeds: int = 10) -> dict:
    m, n = 100, 50
    true = np.logspace(0, -12, n)
    probe = [0, 12, 16, 20, 24, 29, 33, 37, 41, 45, 49]  # indices to report
    err_svd = np.zeros((seeds, n))
    err_eig = np.zeros((seeds, n))
    for seed in range(seeds):
        rng = np.random.default_rng(seed)
        U, _ = np.linalg.qr(rng.standard_normal((m, n)))
        V, _ = np.linalg.qr(rng.standard_normal((n, n)))
        A = (U * true) @ V.T
        s = np.linalg.svd(A, compute_uv=False)
        lam = np.linalg.eigvalsh(A.T @ A)[::-1]
        s_eig = np.sqrt(np.clip(lam, 0, None))
        err_svd[seed] = np.abs(s - true) / true
        err_eig[seed] = np.abs(s_eig - true) / true
    return {
        "shape": [m, n],
        "seeds": seeds,
        "rows": [
            {
                "sigma": float(true[i]),
                "svd_rel_err_median": float(np.median(err_svd[:, i])),
                "svd_rel_err_max": float(err_svd[:, i].max()),
                "eig_rel_err_median": float(np.median(err_eig[:, i])),
                "eig_rel_err_max": float(err_eig[:, i].max()),
            }
            for i in probe
        ],
    }


# 4. Randomized SVD -------------------------------------------------------------


def randomized_svd(A, k, p, q, rng):
    """Halko, Martinsson and Tropp (2011), algorithms 4.4 and 5.1, with
    re-orthonormalization between power iterations."""
    Y = A @ rng.standard_normal((A.shape[1], k + p))
    Q, _ = np.linalg.qr(Y)
    for _ in range(q):
        Z, _ = np.linalg.qr(A.T @ Q)
        Q, _ = np.linalg.qr(A @ Z)
    B = Q.T @ A
    Ub, s, Vt = np.linalg.svd(B, full_matrices=False)
    return (Q @ Ub)[:, :k], s[:k], Vt[:k]


def spectral_norm(M):
    """Largest singular value of a tall M from the largest eigenvalue of the
    small Gram matrix M^T M. Squaring loses accuracy only for small singular
    values (section 3), not for the largest one."""
    return float(np.sqrt(np.linalg.eigvalsh(M.T @ M)[-1]))


def median_time(fn, reps):
    fn()
    ts = []
    for _ in range(reps):
        t = time.perf_counter()
        fn()
        ts.append(time.perf_counter() - t)
    return {"median_s": float(np.median(ts)), "min_s": float(min(ts)), "max_s": float(max(ts)), "reps": reps}


def randomized_experiment(name, A, ks, seeds=10, reps=5) -> dict:
    s_true = np.linalg.svd(A, compute_uv=False)
    out = {"matrix": name, "shape": list(A.shape), "exact_time": median_time(lambda: np.linalg.svd(A, full_matrices=False), reps), "runs": []}
    for k in ks:
        for q in (0, 1, 2):
            ratios_spec, ratios_frob, top_err = [], [], []
            for seed in range(seeds):
                rng = np.random.default_rng(seed)
                Uk, sk, Vtk = randomized_svd(A, k, 10, q, rng)
                R = A - (Uk * sk) @ Vtk
                ratios_spec.append(spectral_norm(R) / s_true[k])
                ratios_frob.append(float(np.linalg.norm(R, "fro") / np.sqrt(np.sum(s_true[k:] ** 2))))
                top_err.append(float(np.max(np.abs(sk - s_true[:k]) / s_true[:k])))
            rng = np.random.default_rng(0)
            out["runs"].append({
                "k": k, "oversampling": 10, "power_iterations": q, "seeds": seeds,
                "spectral_error_over_optimal": {"mean": float(np.mean(ratios_spec)), "sd": float(np.std(ratios_spec, ddof=1)), "max": float(np.max(ratios_spec))},
                "frobenius_error_over_optimal": {"mean": float(np.mean(ratios_frob)), "sd": float(np.std(ratios_frob, ddof=1)), "max": float(np.max(ratios_frob))},
                "worst_top_k_sigma_rel_err": {"mean": float(np.mean(top_err)), "max": float(np.max(top_err))},
                "time": median_time(lambda: randomized_svd(A, k, 10, q, rng), reps),
            })
    return out


# 5. PCA on MNIST ---------------------------------------------------------------


def pca_experiment(X) -> dict:
    Xc = X - X.mean(axis=0)
    s = np.linalg.svd(Xc, compute_uv=False)
    var = s**2 / (X.shape[0] - 1)
    cum = np.cumsum(var) / var.sum()
    return {
        "shape": list(X.shape),
        "explained": {str(k): float(cum[k - 1]) for k in (1, 2, 10, 50, 100, 200)},
        "components_for": {str(f): int(np.searchsorted(cum, f) + 1) for f in (0.5, 0.8, 0.9, 0.95, 0.99)},
        "nonzero_singular_values": int(np.sum(s > s[0] * 1e-12)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mnist", type=Path, required=True)
    args = ap.parse_args()
    t0 = time.perf_counter()

    img = photo()
    small = downsample2(img)
    Image.fromarray(np.round(small * 255).astype(np.uint8), mode="L").save(HERE / "astronaut_256.png", optimize=True)
    # The figure decomposes the 8-bit PNG, so the fixture uses those exact pixels.
    small8 = np.asarray(Image.open(HERE / "astronaut_256.png"), dtype=np.float64) / 255

    with np.load(args.mnist) as d:
        X = d["x_train"].reshape(60000, -1).astype(np.float64) / 255

    results = {
        "environment": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "cpu": platform.processor() or platform.machine(),
            "blas": np.show_config(mode="dicts")["Build Dependencies"]["blas"]["name"],
        },
        "image": image_experiment(img),
        "shuffled": shuffled_experiment(img),
        "figure_fixture": {"shape": list(small8.shape), "singular_values": np.linalg.svd(small8, compute_uv=False).tolist()},
        "stability": stability_experiment(),
        "randomized": [
            randomized_experiment("mnist_centered", X - X.mean(axis=0), ks=[10, 50]),
            randomized_experiment("photo", img, ks=[10, 50]),
        ],
        "pca": pca_experiment(X),
    }
    (HERE / "astronaut_256_singular_values.json").write_text(json.dumps({
        "source": "singular values of astronaut_256.png (pixels / 255), from svd_experiments.py",
        "singular_values": [round(x, 10) for x in results["figure_fixture"]["singular_values"]],
    }))
    results["runtime_s"] = time.perf_counter() - t0
    (HERE / "svd_results.json").write_text(json.dumps(results, indent=1) + "\n")
    print(f"done in {results['runtime_s']:.0f} s")


if __name__ == "__main__":
    main()
