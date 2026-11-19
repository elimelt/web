# Writes figure-check.json: estimates and register histograms from the NumPy
# reference (figure_ref.py) for the hash-family figure's test.
import json
import figure_ref as ref
cases = []
for ks in ["dense", "stride", "scrambled"]:
    for fam in ref.FAMS:
        for n, seed in [(4096, 1), (4096, 77), (65536, 5)]:
            e, h = ref.run(ks, fam, n, seed)
            cases.append({"ks": ks, "family": fam, "n": n, "seed": seed, "estimate": e, "hist": h})
fm = [{"x": x, "fmix32": int(ref.fmix32(__import__("numpy").array([x], dtype="uint64"))[0]), "scramble31": int(ref.scramble31(__import__("numpy").array([x], dtype="uint64"))[0])} for x in [0, 1, 2, 12345, 2**31 - 1, 2**32 - 1]]
json.dump({"cases": cases, "mix": fm}, open("figure-check.json", "w"), indent=0)
print(len(cases))
