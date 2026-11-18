"""Combine the stage outputs in OUT_DIR into results.json beside the note, and
write the whole-model sweep the figure plots into prune-layer.json.

usage: python3 merge.py
"""
import glob
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("OUT_DIR", "/home/claude/pwork/out")

res = {}
for p in sorted(glob.glob(f"{OUT}/*.json")):
    res[os.path.basename(p)[:-5]] = json.load(open(p))
with open(os.path.join(HERE, "results.json"), "w") as f:
    json.dump(res, f, indent=1)
print("results.json:", ", ".join(res))

if "sweep" in res and "main-base" in res:
    sw = res["sweep"]
    dense = sw["dense"]["eval"]["ppl"]
    levels = sorted({r["sparsity"] for r in sw["runs"]})
    labels = {"magnitude": "magnitude, per output", "magnitude-layer": "magnitude, whole layer",
              "wanda": "Wanda, per output", "sparsegpt": "SparseGPT"}
    curves = []
    for key, label in labels.items():
        by = {r["sparsity"]: r["eval"]["ppl"] for r in sw["runs"] if r["label"] == key}
        if len(by) == len(levels):
            curves.append({"key": key, "label": label, "ppl": [round(dense, 3)] + [round(by[s], 3) for s in levels]})
    nm = []
    main = res["main-base"]["runs"]
    for key, label in (("magnitude", "magnitude"), ("wanda", "Wanda"), ("sparsegpt", "SparseGPT")):
        for pat in ("2:4", "4:8"):
            rows = [r["eval"]["ppl"] for r in main if r["label"] == key and r["sparsity"] == pat]
            if rows:
                nm.append({"key": key, "label": label, "pattern": pat, "ppl": round(float(np.exp(np.mean(np.log(rows)))), 3)})
    path = os.path.join(HERE, "prune-layer.json")
    P = json.load(open(path))
    P["sweep"] = {"dense": round(dense, 3), "sparsity": [0.0] + levels, "curves": curves, "nm": nm}
    with open(path, "w") as f:
        json.dump(P, f, separators=(",", ":"))
    print("prune-layer.json sweep:", [c["key"] for c in curves], len(nm), "n:m points")
