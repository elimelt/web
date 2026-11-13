"""Combine the stage outputs of run.py into results.json and print the tables
the note quotes.

usage: python3 merge.py OUT_DIR
"""
import json, pathlib, sys
import numpy as np

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/home/claude/qwork/out")
res = {}
for p in sorted(out.glob("*.json")):
    res[p.stem] = json.loads(p.read_text())
pathlib.Path("results.json").write_text(json.dumps(res, indent=1))

def fmt(e):
    lo, hi = e["dppl_pct_ci"]
    return f"{e['ppl']:7.2f} {e['dppl_pct']:+7.2f}% [{lo:+.2f}, {hi:+.2f}]"

if "weights" in res:
    w = res["weights"]
    print("== weights   fp", w["fp"])
    for r in w["runs"]:
        print(f"W{r['bits']} {str(r['gran']):8s} {'sym ' if r['sym'] else 'asym'}  go {fmt(r['eval'])}  sh {fmt(r['shakespeare'])}")
if "calibrated" in res:
    c = res["calibrated"]
    print("== calibrated   fp", c["fp"])
    for bits in (4, 3):
        for meth in ("rtn", "awq", "gptq"):
            rs = [r for r in c["runs"] if r["method"] == meth and r["bits"] == bits]
            if not rs: continue
            d = [r["eval"]["dppl_pct"] for r in rs]
            print(f"W{bits} g128 {meth:5s} n={len(d)} dppl mean {np.mean(d):+.2f}%  range [{min(d):+.2f}, {max(d):+.2f}]  ppl {np.mean([r['eval']['ppl'] for r in rs]):.2f}",
                  "" if meth != "awq" else f"alpha_mean {np.mean([r['alpha_mean'] for r in rs]):.2f}",
                  "ci0", [round(x, 2) for x in rs[0]["eval"]["dppl_pct_ci"]])
if "w8a8" in res:
    print("== w8a8   fp", res["w8a8"]["fp"])
    for r in res["w8a8"]["runs"]:
        extra = {k: v for k, v in r.items() if k not in ("eval", "seconds", "label")}
        print(f"{r['label']:12s} {extra}  {fmt(r['eval'])}")
for size in ("small", "base", "large"):
    k = f"outliers-{size}"
    if k not in res: continue
    o = res[k]
    L = o["linears"]
    def agg(sel):
        xs = [v for n, v in L.items() if sel(n)]
        return max(v["absmax"] for v in xs), np.median([v["median_channel_absmax"] for v in xs]), max(v["ratio"] for v in xs)
    rows = {
        "qkv/wi (after norm)": lambda n: n.endswith((".q", ".k", ".v", "wi_0", "wi_1")) and ".cross.k" not in n and ".cross.v" not in n,
        "attn out (o)": lambda n: n.endswith(".o"),
        "ffn out (wo)": lambda n: n.endswith(".wo"),
    }
    print(f"== outliers {size} d={o['d_model']} layers {o['n_enc']}+{o['n_dec']} resid max {o['residual_absmax']:.0f}")
    for lab, sel in rows.items():
        mx, med, ratio = agg(sel)
        print(f"   {lab:22s} max {mx:10.1f}  median-of-median-channel {med:6.2f}  worst max/median {ratio:8.1f}")
