"""Experiments behind the power iteration section of
"Eigenvalues, Eigenvectors, and Diagonalization".

Run from notes/:

    python3 content/math/linear-algebra/power-iteration/power_iteration_experiments.py \
        --mnist work/notebook-data/mnist/mnist.npz

It writes results.json next to this file. Without --mnist the MNIST row is
skipped. Everything is deterministic given the seeds below.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import time
from pathlib import Path

import numpy as np
import scipy
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from scipy.sparse.linalg import LinearOperator, eigsh

HERE = Path(__file__).resolve().parent
CONTENT = HERE.parents[2]  # notes/content
TOL = 1e-8
SEEDS = range(10)


# ---------------------------------------------------------------------------
# Building blocks


def random_orthogonal(n: int, rng: np.random.Generator) -> np.ndarray:
    q, r = np.linalg.qr(rng.standard_normal((n, n)))
    return q * np.sign(np.diag(r))


def symmetric_with_spectrum(lams: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    q = random_orthogonal(len(lams), rng)
    return (q * lams) @ q.T, q


def gap_spectrum(n: int, ratio: float, rng: np.random.Generator) -> np.ndarray:
    """lambda_1 = 1, lambda_2 = ratio, the rest uniform in [-ratio, ratio]."""
    rest = ratio * rng.uniform(-1.0, 1.0, n - 2)
    return np.concatenate(([1.0, ratio], rest))


def sin_angle(x: np.ndarray, v: np.ndarray) -> float:
    """Sine of the angle between the lines through x and v, accurate for tiny
    angles: the length of the part of x/|x| orthogonal to v."""
    u = x / np.linalg.norm(x)
    w = v / np.linalg.norm(v)
    return float(np.linalg.norm(u - (u @ w) * w))


def power_iteration(matvec, x0, v1, lam1, max_steps, tol=TOL, record=False, rayleigh_tol=None):
    """Run x <- A x / |A x| and report when the eigenvector error (sine of the
    angle to v1) and the Rayleigh quotient error first drop below tol."""
    x = x0 / np.linalg.norm(x0)
    k_vec = k_val = None
    trace = []
    rayleigh_tol = tol if rayleigh_tol is None else rayleigh_tol
    for k in range(max_steps + 1):
        err = sin_angle(x, v1)
        y = matvec(x)
        rho = float(x @ y)  # x has unit norm
        val_err = abs(rho - lam1) / abs(lam1)
        if record:
            trace.append((err, val_err))
        if k_vec is None and err <= tol:
            k_vec = k
        if k_val is None and val_err <= rayleigh_tol:
            k_val = k
        if k_vec is not None and k_val is not None and not record:
            break
        x = y / np.linalg.norm(y)
    return k_vec, k_val, trace


def tail_rate(errs: list[float], lo=1e-11, hi=1e-4) -> float | None:
    """Geometric-mean per-step contraction over the stretch where the error is
    between lo and hi (past the start-up, above rounding)."""
    idx = [i for i, e in enumerate(errs) if lo <= e <= hi]
    if len(idx) < 3:
        return None
    a, b = idx[0], idx[-1]
    if b == a:
        return None
    return float((errs[b] / errs[a]) ** (1.0 / (b - a)))


def lanczos_steps(a: np.ndarray, x0: np.ndarray, v1: np.ndarray, max_steps: int, tol=TOL) -> int | None:
    """Plain Lanczos with full reorthogonalization. Returns the number of
    matrix-vector products after which the top Ritz vector is within tol."""
    n = len(x0)
    q = np.zeros((n, max_steps + 1))
    q[:, 0] = x0 / np.linalg.norm(x0)
    alpha, beta = [], []
    for j in range(max_steps):
        w = a @ q[:, j]
        alpha.append(float(q[:, j] @ w))
        w -= q[:, : j + 1] @ (q[:, : j + 1].T @ w)
        w -= q[:, : j + 1] @ (q[:, : j + 1].T @ w)
        t = np.diag(alpha) + np.diag(beta, 1) + np.diag(beta, -1)
        theta, s = np.linalg.eigh(t)
        ritz = q[:, : j + 1] @ s[:, -1]
        if sin_angle(ritz, v1) <= tol:
            return j + 1
        b = float(np.linalg.norm(w))
        if b == 0:
            return None
        beta.append(b)
        q[:, j + 1] = w / b
    return None


# ---------------------------------------------------------------------------
# 1. The gap sweep on controlled symmetric matrices


def gap_sweep(n=200, ratios=(0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995)):
    rows = []
    for ratio in ratios:
        per_seed = []
        for seed in SEEDS:
            rng = np.random.default_rng(1000 + seed)
            lams = gap_spectrum(n, ratio, rng)
            a, q = symmetric_with_spectrum(lams, rng)
            v1 = q[:, 0]
            x0 = rng.standard_normal(n)
            c = q.T @ x0
            tan0 = float(np.linalg.norm(c[1:]) / abs(c[0]))
            steps_cap = int(4 * math.log(TOL / tan0) / math.log(ratio)) + 50
            k_vec, k_val, trace = power_iteration(lambda v: a @ v, x0, v1, 1.0, steps_cap, record=True)
            errs = [e for e, _ in trace]
            # The bound tan(theta_k) <= tan(theta_0) ratio^k, solved for tol.
            bound = math.ceil(math.log(TOL / tan0) / math.log(ratio))
            per_seed.append(
                {
                    "seed": seed,
                    "tan_theta0": tan0,
                    "steps_vector": k_vec,
                    "steps_value": k_val,
                    "bound_steps": bound,
                    "rate": tail_rate(errs),
                }
            )
        sv = [s["steps_vector"] for s in per_seed]
        sl = [s["steps_value"] for s in per_seed]
        rates = [s["rate"] for s in per_seed if s["rate"] is not None]
        rows.append(
            {
                "ratio": ratio,
                "steps_vector_median": float(np.median(sv)),
                "steps_vector_min": int(min(sv)),
                "steps_vector_max": int(max(sv)),
                "steps_value_median": float(np.median(sl)),
                "bound_steps_median": float(np.median([s["bound_steps"] for s in per_seed])),
                "rate_median": float(np.median(rates)),
                "rate_min": float(min(rates)),
                "rate_max": float(max(rates)),
                "seeds": per_seed,
            }
        )
        print(f"gap ratio={ratio}: vector {np.median(sv):.0f} steps ({min(sv)}-{max(sv)}), "
              f"value {np.median(sl):.0f}, rate {np.median(rates):.4f}")
    return rows


# ---------------------------------------------------------------------------
# 2. Lanczos against power iteration on the same matrices


def lanczos_vs_power(n=400, ratios=(0.9, 0.99, 0.999)):
    rows = []
    for ratio in ratios:
        power, lanczos, arpack = [], [], []
        for seed in SEEDS:
            rng = np.random.default_rng(2000 + seed)
            lams = gap_spectrum(n, ratio, rng)
            a, q = symmetric_with_spectrum(lams, rng)
            v1 = q[:, 0]
            x0 = rng.standard_normal(n)
            cap = int(6 * math.log(TOL / 30) / math.log(ratio)) + 100
            k_vec, _, _ = power_iteration(lambda v: a @ v, x0, v1, 1.0, cap)
            power.append(k_vec)
            lanczos.append(lanczos_steps(a, x0, v1, min(n, 400)))
            count = [0]

            def mv(v, a=a, count=count):
                count[0] += 1
                return a @ v

            op = LinearOperator((n, n), matvec=mv, dtype=float)
            _, vec = eigsh(op, k=1, which="LA", v0=x0, tol=1e-12)
            arpack.append({"matvecs": count[0], "sin": sin_angle(vec[:, 0], v1)})
        rows.append(
            {
                "ratio": ratio,
                "gamma": (1 - ratio) / (2 * ratio),
                "power_median": float(np.median(power)),
                "power_min": int(min(power)),
                "power_max": int(max(power)),
                "lanczos_median": float(np.median(lanczos)),
                "lanczos_min": int(min(lanczos)),
                "lanczos_max": int(max(lanczos)),
                "arpack_matvecs_median": float(np.median([r["matvecs"] for r in arpack])),
                "arpack_sin_max": float(max(r["sin"] for r in arpack)),
            }
        )
        print(f"lanczos ratio={ratio}: power {np.median(power):.0f}, lanczos {np.median(lanczos):.0f}, "
              f"eigsh {np.median([r['matvecs'] for r in arpack]):.0f} matvecs")
    return rows


# ---------------------------------------------------------------------------
# 3. Failure and edge cases


def edge_cases(n=200, steps=2000):
    out = {}
    rng = np.random.default_rng(7)
    q = random_orthogonal(n, rng)
    x0 = rng.standard_normal(n)

    # lambda_2 = -lambda_1: no convergence, the iterate alternates.
    lams = np.concatenate(([1.0, -1.0], 0.5 * rng.uniform(-1, 1, n - 2)))
    a = (q * lams) @ q.T
    _, _, tr = power_iteration(lambda v: a @ v, x0, q[:, 0], 1.0, steps, record=True)
    out["opposite_sign"] = {
        "sin_after_steps": [tr[k][0] for k in (0, 10, 100, steps)],
        "steps": [0, 10, 100, steps],
        "rayleigh_after": tr[steps][1],
    }

    # A real matrix whose dominant eigenvalues are a complex pair: the iterate
    # rotates in the plane forever.
    theta = 0.3
    rot = np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])
    block = np.zeros((n, n))
    block[:2, :2] = rot
    block[2:, 2:] = np.diag(0.5 * rng.uniform(-1, 1, n - 2))
    a = q @ block @ q.T
    x = x0 / np.linalg.norm(x0)
    plane = q[:, :2]
    dist = []
    for k in range(steps + 1):
        proj = plane @ (plane.T @ x)
        dist.append(float(np.linalg.norm(x - proj)))
        x = a @ x
        x /= np.linalg.norm(x)
    xs = x0 / np.linalg.norm(x0)
    out["complex_pair"] = {
        "distance_to_plane_after": [dist[k] for k in (0, 10, 100, steps)],
        "steps": [0, 10, 100, steps],
    }

    # Defective dominant eigenvalue: a 2x2 Jordan block for lambda = 1.
    j = np.zeros((n, n))
    j[0, 0] = j[1, 1] = 1.0
    j[0, 1] = 1.0
    j[2:, 2:] = np.diag(0.5 * rng.uniform(-1, 1, n - 2))
    a = q @ j @ q.T
    _, _, tr = power_iteration(lambda v: a @ v, x0, q[:, 0], 1.0, 10**4, record=True)
    errs = [e for e, _ in tr]
    out["jordan"] = {
        "steps": [10, 100, 1000, 10000],
        "sin": [errs[k] for k in (10, 100, 1000, 10000)],
        "k_times_sin": [k * errs[k] for k in (10, 100, 1000, 10000)],
    }
    print("edge cases:", json.dumps(out, indent=None)[:400])
    return out


# ---------------------------------------------------------------------------
# 4. Non-symmetric matrices with badly conditioned eigenvectors


def nonnormal(n=200, ratio=0.8, angles_deg=(90, 10, 1, 0.1)):
    rows = []
    for ang in angles_deg:
        per = []
        for seed in SEEDS:
            rng = np.random.default_rng(3000 + seed)
            q = random_orthogonal(n, rng)
            v = q.copy()
            phi = math.radians(ang)
            v[:, 1] = math.cos(phi) * q[:, 0] + math.sin(phi) * q[:, 1]
            lams = gap_spectrum(n, ratio, rng)
            a = (v * lams) @ np.linalg.inv(v)
            x0 = rng.standard_normal(n)
            cap = 4000
            k_vec, k_val, tr = power_iteration(lambda y: a @ y, x0, v[:, 0], 1.0, cap, record=True)
            errs = [e for e, _ in tr]
            vals = [e for _, e in tr]
            per.append(
                {
                    "kappa": float(np.linalg.cond(v)),
                    "steps_vector": k_vec,
                    "steps_value": k_val,
                    "rate_vector": tail_rate(errs),
                    "rate_value": tail_rate(vals),
                    "max_sin": float(max(errs[:50])),
                }
            )
        rows.append(
            {
                "angle_deg": ang,
                "kappa_median": float(np.median([p["kappa"] for p in per])),
                "steps_vector_median": float(np.median([p["steps_vector"] for p in per])),
                "steps_value_median": float(np.median([p["steps_value"] for p in per])),
                "rate_vector_median": float(np.median([p["rate_vector"] for p in per])),
                "rate_value_median": float(np.median([p["rate_value"] for p in per])),
                "seeds": per,
            }
        )
        print(f"nonnormal angle={ang}: kappa {rows[-1]['kappa_median']:.3g}, "
              f"vector {rows[-1]['steps_vector_median']}, value {rows[-1]['steps_value_median']}, "
              f"rates {rows[-1]['rate_vector_median']:.4f}/{rows[-1]['rate_value_median']:.4f}")
    return rows


# ---------------------------------------------------------------------------
# 5. Top principal component of real data sets


def pca_datasets(mnist_path: str | None):
    from sklearn import datasets
    from sklearn.preprocessing import StandardScaler

    sets = {
        "digits": datasets.load_digits().data,
        "wine": datasets.load_wine().data,
        "breast_cancer": datasets.load_breast_cancer().data,
    }
    standardized = {"wine", "breast_cancer"}
    if mnist_path:
        with np.load(mnist_path) as f:
            sets["mnist"] = f["x_train"].reshape(len(f["x_train"]), -1).astype(np.float64) / 255.0
    rows = []
    for name, x in sets.items():
        variants = [("raw", x)]
        if name in standardized:
            variants.append(("standardized", StandardScaler().fit_transform(x)))
        for variant, data in variants:
            xc = data - data.mean(axis=0)
            cov = xc.T @ xc / (len(xc) - 1)
            lams, vecs = np.linalg.eigh(cov)
            lams, vecs = lams[::-1], vecs[:, ::-1]
            v1 = vecs[:, 0]
            ratio = float(lams[1] / lams[0])
            steps, bounds, rates = [], [], []
            for seed in SEEDS:
                rng = np.random.default_rng(4000 + seed)
                x0 = rng.standard_normal(cov.shape[0])
                c = vecs.T @ x0
                tan0 = float(np.linalg.norm(c[1:]) / abs(c[0]))
                k_vec, _, tr = power_iteration(lambda v: cov @ v, x0, v1, float(lams[0]), 20000, record=True)
                steps.append(k_vec)
                bounds.append(math.ceil(math.log(TOL / tan0) / math.log(ratio)))
                rates.append(tail_rate([e for e, _ in tr]))
            rows.append(
                {
                    "dataset": name,
                    "variant": variant,
                    "shape": list(data.shape),
                    "lambda1": float(lams[0]),
                    "lambda2": float(lams[1]),
                    "ratio": ratio,
                    "steps_median": float(np.median(steps)),
                    "steps_min": int(min(steps)),
                    "steps_max": int(max(steps)),
                    "bound_median": float(np.median(bounds)),
                    "rate_median": float(np.median([r for r in rates if r])),
                }
            )
            print(f"pca {name}/{variant}: ratio {ratio:.4f}, steps {np.median(steps)} "
                  f"({min(steps)}-{max(steps)}), bound {np.median(bounds)}, rate {rows[-1]['rate_median']:.4f}")
    return rows


# ---------------------------------------------------------------------------
# 6. PageRank on this site's own link graph

WIKILINK = re.compile(r"(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
MDLINK = re.compile(r"(?<!!)\[[^\]]*\]\((/[^)\s#]*|[^):\s#]+\.mdx?)(?:#[^)]*)?\)")


def slugify(path: str) -> str:
    path = re.sub(r"\.(mdx?)$", "", path)
    return path.strip("/").lower().replace(" ", "-")


def site_link_graph(content: Path):
    files = []
    for p in sorted(content.rglob("*")):
        if p.suffix not in (".md", ".mdx") or "templates" in p.relative_to(content).parts:
            continue
        text = p.read_text(errors="ignore")
        head = text[:2000]
        if re.search(r"^archive:\s*true", head, re.M):
            continue
        files.append((p, text))
    slugs = {slugify(str(p.relative_to(content))): i for i, (p, _) in enumerate(files)}
    by_base: dict[str, list[str]] = {}
    for s in slugs:
        by_base.setdefault(s.rsplit("/", 1)[-1], []).append(s)

    def resolve(target: str, here: Path) -> str | None:
        t = target.strip()
        if not t:
            return None
        if not t.startswith("/") and ("/" in t and t.split("/")[0] in (".", "..")):
            t = str((here.parent / t).resolve().relative_to(content.resolve()))
        s = slugify(t)
        for cand in (s, s + "/index", s.removesuffix("/index")):
            if cand in slugs:
                return cand
        base = s.rsplit("/", 1)[-1]
        hits = by_base.get(base, [])
        return hits[0] if len(hits) == 1 else None

    edges = set()
    for i, (p, text) in enumerate(files):
        targets = WIKILINK.findall(text) + MDLINK.findall(text)
        for t in targets:
            try:
                s = resolve(t, p)
            except ValueError:
                s = None
            if s is not None and slugs[s] != i:
                edges.add((i, slugs[s]))
    return len(files), sorted(edges)


def pagerank_experiment(alphas=(0.5, 0.7, 0.85, 0.9, 0.95, 0.99), tol=1e-10):
    n, edges = site_link_graph(CONTENT)
    rows_i = np.array([e[0] for e in edges])
    cols_i = np.array([e[1] for e in edges])
    adj = sp.csr_matrix((np.ones(len(edges)), (rows_i, cols_i)), shape=(n, n))
    outdeg = np.asarray(adj.sum(axis=1)).ravel()
    dangling = outdeg == 0
    inv = np.where(dangling, 0.0, 1.0 / np.maximum(outdeg, 1))
    pt = (sp.diags(inv) @ adj).T.tocsr()  # P^T, P row-stochastic on non-dangling rows

    # Closed classes of the chain where a dangling page jumps anywhere.
    _, labels = connected_components(adj, directed=True, connection="strong")
    ncomp = labels.max() + 1
    leaves = np.ones(ncomp, bool)
    for i, j in edges:
        if labels[i] != labels[j]:
            leaves[labels[i]] = False
    for i in np.where(dangling)[0]:
        leaves[labels[i]] = False  # a dangling page links to every page
    closed = [int((labels == c).sum()) for c in np.where(leaves)[0]]

    rows = []
    for alpha in alphas:
        x = np.full(n, 1.0 / n)
        res = []
        t0 = time.perf_counter()
        for k in range(1, 100000):
            y = alpha * (pt @ x + x[dangling].sum() / n) + (1 - alpha) / n
            r = float(np.abs(y - x).sum())
            res.append(r)
            x = y
            if r < tol:
                break
        elapsed = time.perf_counter() - t0
        tail = res[-11:]
        rate = (tail[-1] / tail[0]) ** (1 / (len(tail) - 1))
        # Exact second eigenvalue of the dense Google matrix.
        p = (sp.diags(inv) @ adj).toarray()
        p[dangling] = 1.0 / n
        g = alpha * p + (1 - alpha) / n
        ev = np.linalg.eigvals(g.T)
        mags = np.sort(np.abs(ev))[::-1]
        rows.append(
            {
                "alpha": alpha,
                "iterations": len(res),
                "observed_rate": float(rate),
                "abs_lambda2": float(mags[1]),
                "predicted_iterations": math.ceil(math.log(tol / res[0]) / math.log(alpha)) + 1,
                "seconds": elapsed,
            }
        )
        print(f"pagerank alpha={alpha}: {len(res)} iterations, rate {rate:.4f}, |lambda2| {mags[1]:.6f}")
    top = np.argsort(-x)[:5]
    return {
        "nodes": n,
        "edges": len(edges),
        "dangling": int(dangling.sum()),
        "closed_classes": len(closed),
        "closed_class_sizes": sorted(closed, reverse=True)[:10],
        "tol_l1": tol,
        "rows": rows,
    }


# ---------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mnist", help="path to Keras's mnist.npz")
    ap.add_argument("--out", default=str(HERE / "results.json"))
    args = ap.parse_args()
    t0 = time.perf_counter()
    results = {
        "environment": {
            "python": ".".join(map(str, __import__("sys").version_info[:3])),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
        },
        "tol": TOL,
        "pagerank": pagerank_experiment(),
        "gap_sweep": gap_sweep(),
        "lanczos_vs_power": lanczos_vs_power(),
        "edge_cases": edge_cases(),
        "nonnormal": nonnormal(),
        "pca": pca_datasets(args.mnist),
    }
    results["seconds"] = time.perf_counter() - t0
    Path(args.out).write_text(json.dumps(results, indent=1) + "\n")
    print(f"wrote {args.out} in {results['seconds']:.0f} s")


if __name__ == "__main__":
    main()
