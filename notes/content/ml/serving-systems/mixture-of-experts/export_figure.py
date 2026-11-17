"""Write the RouterLoad figure's data: for each model and layer, the expert
each token chose (argmax of the router softmax), one byte per token, base64.
usage: python export_figure.py OUT_DIR"""
import sys, json, base64, numpy as np
DOMS = ["prose", "code", "shakespeare", "math"]
out = sys.argv[1]
for E in ["e8", "e64"]:
    z = np.load(f"routes_{E}.npz")
    for L in [1, 7, 11]:
        d = {"model": E, "layer": L, "N": int(z[f"prose/enc.{L}"].shape[1]), "win": 256, "domains": {}}
        for k in DOMS:
            ch = z[f"{k}/enc.{L}"].argmax(1).astype(np.uint8)
            assert ch.size % 256 == 0
            d["domains"][k] = base64.b64encode(ch.tobytes()).decode()
        json.dump(d, open(f"{out}/router-{E}-layer{L}.json", "w"), separators=(",", ":"))
