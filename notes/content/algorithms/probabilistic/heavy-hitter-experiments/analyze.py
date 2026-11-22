"""Summarizes the hh runs: point error on the true top keys, recall and
precision of the reported heavy hitters, the error bounds, and the
Misra-Gries / Space-Saving equivalence on the real stream.

Run in the directory holding agg.bin and the rec_*.bin and shuf_*.bin files
written by hh.  Writes summary.json and prints the tables.
"""
import glob
import json
import math
import struct
import sys

import numpy as np

NTOP = 5000
ALG = ["mg", "mg_m1", "ss", "cs", "cms", "cu"]
ROWS = {"cs": 5, "cms": 4, "cu": 4}

agg = np.fromfile("agg.bin", dtype=np.uint64).reshape(-1, 2)
N = int(agg[:, 1].sum())
order = np.lexsort((agg[:, 0], -agg[:, 1].astype(np.int64)))
top_keys = agg[order[:NTOP], 0]
top_cnt = agg[order[:NTOP], 1].astype(np.int64)
by_key = np.argsort(agg[:, 0])
sorted_keys = agg[by_key, 0]
sorted_cnt = agg[by_key, 1].astype(np.int64)
counts_desc = agg[order, 1].astype(np.float64)
csum = np.concatenate([[0.0], np.cumsum(counts_desc[:200000])])
sq_desc = counts_desc ** 2
sq_tail = np.concatenate([np.cumsum(sq_desc[::-1])[::-1], [0.0]])


def truth_of(keys):
    i = np.searchsorted(sorted_keys, keys)
    i = np.minimum(i, len(sorted_keys) - 1)
    ok = sorted_keys[i] == keys
    return np.where(ok, sorted_cnt[i], 0)


def res1(j):
    return N - csum[j]


def tail_bound(m):
    """Berinde et al. (2010): error <= F1res(j) / (m - j) for every j < m."""
    js = np.arange(0, min(m, 200000))
    return float(np.min((N - csum[js]) / (m - js)))


def read_runs(path):
    with open(path, "rb") as f:
        hdr = struct.unpack("<4i", f.read(16))
        runs = []
        while True:
            h = f.read(12)
            if len(h) < 12:
                break
            alg, m, n = struct.unpack("<3i", h)
            mn, off = struct.unpack("<2q", f.read(16))
            est = np.frombuffer(f.read(8 * NTOP), dtype=np.int64)
            cand = np.frombuffer(f.read(24 * n), dtype=np.int64).reshape(-1, 3) if n else np.zeros((0, 3), np.int64)
            runs.append({"alg": ALG[alg], "m": m, "min": mn, "off": off, "est": est, "cand": cand})
    return hdr, runs


PHIS = [1e-4, 1e-5]
out = []
equiv = []
for path in sorted(glob.glob("rec_*.bin")) + sorted(glob.glob("shuf_*.bin")):
    (ordr, seed, _, _), runs = read_runs(path)
    by = {}
    for r in runs:
        alg, m = r["alg"], r["m"]
        by[(alg, m)] = r
        est = r["est"].astype(np.float64)
        if alg in ("mg", "mg_m1", "ss"):
            est = np.where(est < 0, 0.0, est)
        err = est - top_cnt
        cand = r["cand"]
        ck = cand[:, 0].astype(np.uint64)
        ce = cand[:, 1].astype(np.float64)
        cerr = cand[:, 2].astype(np.float64)
        ct = truth_of(ck)
        rank = np.lexsort((ck, -ce))
        rep100 = set(ck[rank[:100]].tolist())
        true100 = set(top_keys[:100].tolist())
        row = {
            "file": path, "order": "file" if ordr == 0 else "shuffled", "seed": seed, "alg": alg, "m": m,
            "max_err_top100": float(np.max(np.abs(err[:100]))), "max_err_top1000": float(np.max(np.abs(err[:1000]))),
            "mean_err_top1000": float(np.mean(np.abs(err[:1000]))),
            "top100_recall": len(rep100 & true100) / 100,
            "monitored_top100": int(np.sum(r["est"][:100] >= 0)) if alg in ("mg", "mg_m1", "ss") else None,
            "min": int(r["min"]), "off": int(r["off"]),
        }
        if alg in ("mg", "mg_m1"):
            k = m - 1 if alg == "mg_m1" else m
            row["bound"] = (N - float(ce.sum())) / (k + 1)
            row["bound_tail"] = tail_bound(k + 1)
        elif alg == "ss":
            row["bound"] = float(r["min"])
            row["bound_tail"] = tail_bound(m)
            row["sum_counts"] = int(ce.sum())
        else:
            w = (3 * m) // ROWS[alg]
            row["w"] = w
            row["bound"] = math.e * N / w if alg != "cs" else math.sqrt(3 / w) * math.sqrt(float(sq_tail[0]))
        for phi in PHIS:
            thr = phi * N
            truth_set = set(top_keys[top_cnt >= thr].tolist())
            rep = set(ck[ce >= thr].tolist())
            tp = len(rep & truth_set)
            row[f"recall_{phi:g}"] = tp / len(truth_set)
            row[f"precision_{phi:g}"] = tp / len(rep) if rep else None
            row[f"reported_{phi:g}"] = len(rep)
            if alg == "ss":
                g = set(ck[(ce - cerr) >= thr].tolist())
                row[f"guaranteed_{phi:g}"] = len(g)
                row[f"guaranteed_fp_{phi:g}"] = len(g - truth_set)
        out.append(row)
    for m in sorted({r["m"] for r in runs}):
        if ("ss", m) in by and ("mg_m1", m) in by:
            ss, mg = by[("ss", m)], by[("mg_m1", m)]
            mn = ss["min"]
            a = {int(k): int(v) - mn for k, v, _ in ss["cand"] if int(v) - mn > 0}
            b = {int(k): int(v) for k, v, _ in mg["cand"]}
            equiv.append({"file": path, "m": m, "equal": a == b, "ss_min": int(mn), "mg_bound_k1": (N - sum(b.values())) / m})

json.dump({"N": N, "runs": out, "equivalence": equiv}, open("summary.json", "w"), indent=1)

def agg_rows(order_name, alg, m, key):
    v = [r[key] for r in out if r["order"] == order_name and r["alg"] == alg and r["m"] == m and r.get(key) is not None]
    return (min(v), max(v), len(v)) if v else None

print("N", N)
print("equivalence checks", len(equiv), "all equal", all(e["equal"] for e in equiv), "min == MG bound", all(abs(e["ss_min"] - e["mg_bound_k1"]) < 1e-6 for e in equiv))
for key in ["max_err_top100", "max_err_top1000", "mean_err_top1000", "top100_recall", "recall_0.0001", "precision_0.0001", "reported_0.0001", "recall_1e-05", "precision_1e-05", "bound", "bound_tail", "guaranteed_0.0001", "guaranteed_fp_0.0001", "guaranteed_1e-05", "guaranteed_fp_1e-05"]:
    print("==", key)
    for alg in ["mg", "ss", "cs", "cms", "cu"]:
        line = [alg]
        for m in [250, 1000, 4000, 16000, 64000]:
            for o in ["file", "shuffled"]:
                a = agg_rows(o, alg, m, key)
                line.append("-" if not a else (f"{a[0]:.4g}" if a[0] == a[1] else f"{a[0]:.4g}..{a[1]:.4g}"))
        print("  ".join(line))
