"""Writes the max-flow instances used in network-flows.mdx as DIMACS files.

Three generator families are reimplemented from the DIMACS max-flow challenge
generators (the C sources are mirrored in cmuparlay/pbbsbench under
testData/graphData/maxFlowGens):

- genrmf (Goldfarb and Grigoriadis's RMFGEN, implemented by Badics): b frames
  of a x a grid vertices; in-frame neighbour arcs of capacity c2 * a * a, and
  one arc from each vertex to a random-permutation partner in the next frame
  with capacity uniform on [c1, c2]. Source in the first frame, sink in the
  last.
- rlg (Anderson's "washington" random level graph, function 2): `levels`
  levels of `rows` vertices, each vertex joined to 3 distinct random vertices
  of the next level with capacity uniform on [1, r]; source and sink arcs of
  capacity 3r.
- ak (Cherkassky and Goldberg's hard instances): a deterministic network with
  4k + 6 vertices built to make augmenting-path and push-relabel codes do
  quadratic work.

The real instances are graph-cut segmentation problems built from photographs
in scikit-image's data module, with the 4-connected grid construction of
Boykov and Jolly (2001): one vertex per pixel, terminal arcs from a two-class
Gaussian intensity model, and neighbour arcs of weight
lambda * exp(-(I_p - I_q)^2 / (2 sigma^2)).

    python3 -m pip install scikit-image numpy
    python3 instances.py OUTDIR
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import numpy as np


def write(path: Path, n: int, s: int, t: int, arcs, comment: str) -> dict:
    arcs = [(u, v, c) for (u, v, c) in arcs if c > 0 and u != v]
    with path.open("w") as f:
        f.write(f"c {comment}\n")
        f.write(f"p max {n} {len(arcs)}\n")
        f.write(f"n {s} s\nn {t} t\n")
        f.write("".join(f"a {u} {v} {c}\n" for u, v, c in arcs))
    return {"file": path.name, "n": n, "m": len(arcs), "comment": comment}


def genrmf(a: int, b: int, c1: int, c2: int, seed: int):
    rng = random.Random(seed)
    aa = a * a
    perm = list(range(aa + 1))
    arcs = []
    for z in range(1, b + 1):
        off = aa * (z - 1)
        if z != b:  # the C code's permute(): a Fisher-Yates shuffle of 1..aa
            for i in range(1, aa):
                j = rng.randint(i, aa)
                perm[i], perm[j] = perm[j], perm[i]
        for x in range(1, a + 1):
            for y in range(1, a + 1):
                cv = off + (x - 1) * a + y
                if z != b:
                    arcs.append((cv, off + aa + perm[cv - off], rng.randint(c1, c2)))
                for x1, y1 in ((x, y + 1), (x, y - 1), (x + 1, y), (x - 1, y)):
                    if 1 <= x1 <= a and 1 <= y1 <= a:
                        arcs.append((cv, off + (x1 - 1) * a + y1, c2 * aa))
    return aa * b, 1, aa * b, arcs


def rlg(rows: int, levels: int, r: int, seed: int):
    rng = random.Random(seed)
    src, sink = 0, rows * levels + 1
    arcs = []
    for i in range(1, rows + 1):
        arcs.append((src, src + i, 3 * r))
        arcs.append((sink - i, sink, 3 * r))
    for i in range(levels - 1):
        for j in range(1, rows + 1):
            for x in rng.sample(range(1, rows + 1), 3):
                arcs.append((i * rows + j, (i + 1) * rows + x, rng.randint(1, r)))
    # DIMACS vertices are 1-based
    return rows * levels + 2, src + 1, sink + 1, [(u + 1, v + 1, c) for u, v, c in arcs]


def ak(k: int):
    """A line-for-line port of ak.c."""
    arcs = []
    for i in range(k):
        arcs.append((i + 3, i + 4, k - i + 1))
        arcs.append((i + 3, k + 4, 1))
    arcs.append((k + 3, 2 * k + 4, 1))
    arcs.append((k + 3, k + 4, 1))
    for i in range(k + 3, 2 * k + 3):
        arcs.append((i + 1, i + 2, k + 1))
    d = 2 * k + 4
    for i in range(d, 2 * k + d + 1):
        arcs.append((i + 1, i + 2, k))
    for i in range(k):
        arcs.append((i + d + 1, 2 * k + 2 - i + d, 1))
    arcs += [(1, 3, 1000000), (1, d + 1, 1000000), (d, 2, 1000000), (4 * k + 6, 2, 1000000)]
    return 4 * k + 6, 1, 2, arcs


def segmentation(img: np.ndarray, lam: float = 2.0, scale: int = 100):
    """Boykov-Jolly graph cut on a grayscale image in [0, 1]."""
    from skimage.filters import threshold_otsu

    h, w = img.shape
    thr = threshold_otsu(img)
    fg, bg = img[img > thr], img[img <= thr]

    def nll(x, sample):
        mu, sd = sample.mean(), max(sample.std(), 1e-3)
        return (x - mu) ** 2 / (2 * sd * sd) + math.log(sd)

    d_fg, d_bg = nll(img, fg), nll(img, bg)
    low = np.minimum(d_fg, d_bg)  # reparametrize so one terminal arc per pixel is 0
    cap_s = np.rint(scale * (d_bg - low)).astype(np.int64)  # cut when p is labelled background
    cap_t = np.rint(scale * (d_fg - low)).astype(np.int64)
    dx = (img[:, 1:] - img[:, :-1]) ** 2
    dy = (img[1:, :] - img[:-1, :]) ** 2
    sigma2 = (dx.sum() + dy.sum()) / (dx.size + dy.size)
    wx = np.rint(scale * lam * np.exp(-dx / (2 * sigma2))).astype(np.int64)
    wy = np.rint(scale * lam * np.exp(-dy / (2 * sigma2))).astype(np.int64)
    vid = lambda r, c: 3 + r * w + c  # 1 = s, 2 = t
    arcs = []
    for r in range(h):
        for c in range(w):
            v = vid(r, c)
            arcs.append((1, v, int(cap_s[r, c])))
            arcs.append((v, 2, int(cap_t[r, c])))
            if c + 1 < w:
                arcs += [(v, v + 1, int(wx[r, c])), (v + 1, v, int(wx[r, c]))]
            if r + 1 < h:
                arcs += [(v, v + w, int(wy[r, c])), (v + w, v, int(wy[r, c]))]
    return h * w + 2, 1, 2, arcs


def images():
    from skimage import data
    from skimage.color import rgb2gray
    from skimage.transform import resize
    from skimage.util import img_as_float

    gray = {
        "camera": img_as_float(data.camera()),
        "coins": img_as_float(data.coins()),
        "astronaut": rgb2gray(data.astronaut()),
        "coffee": rgb2gray(data.coffee()),
    }
    out = {name: im for name, im in gray.items()}
    cam = gray["camera"]
    for side in (64, 128, 256):
        out[f"camera{side}"] = resize(cam, (side, side), anti_aliasing=True)
    return out


SWEEP_SEEDS = (1, 2, 3)


def main(outdir: str) -> None:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    manifest = []

    def add(family, size, seed, built, comment):
        n, s, t, arcs = built
        meta = write(out / f"{family}-{size}-{seed}.max", n, s, t, arcs, comment)
        meta.update(family=family, size=size, seed=seed)
        manifest.append(meta)

    for x in (10, 12, 14, 16, 18):
        a, b = round(2 ** (x / 4)), round(2 ** (x / 2))  # long: b = a^2 frames
        for seed in SWEEP_SEEDS:
            add("genrmf-long", x, seed, genrmf(a, b, 1, 10000, seed), f"genrmf a={a} b={b} c1=1 c2=10000 seed={seed}")
        a, b = round(2 ** (2 * x / 5)), round(2 ** (x / 5))  # wide: a^2 = frame area, few frames
        for seed in SWEEP_SEEDS:
            add("genrmf-wide", x, seed, genrmf(a, b, 1, 10000, seed), f"genrmf a={a} b={b} c1=1 c2=10000 seed={seed}")
    for x in range(6, 12):
        for seed in SWEEP_SEEDS:
            add("rlg-wide", x, seed, rlg(2 ** x, 64, 10000, seed), f"rlg rows={2**x} levels=64 r=10000 seed={seed}")
    for k in (250, 500, 1000, 2000, 4000, 8000):
        add("ak", k, 0, ak(k), f"ak k={k}")
    for name, img in images().items():
        add("seg", name, 0, segmentation(img), f"Boykov-Jolly segmentation of skimage.data {name} {img.shape[0]}x{img.shape[1]}")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(manifest)} instances to {out}")


if __name__ == "__main__":
    main(sys.argv[1])
