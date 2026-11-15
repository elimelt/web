"""Prints the tables in network-flows.mdx from results.json.

    python3 analyze.py results.json

Growth exponents are least-squares slopes of log(median) against log(n) over
the sizes of a family at which the algorithm finished every run.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict

ALGOS = ("ek", "dinic", "pr")


def ms(x: float) -> str:
    return f"{x * 1000:.3g}" if x < 1 else f"{x * 1000:,.0f}"


def cell(e: dict | None) -> str:
    if e is None:
        return "not run"
    if "median_s" not in e:
        return "over limit"
    return f"{ms(e['median_s'])} ({ms(e['min_s'])}–{ms(e['max_s'])})"


def slope(points):
    if len(points) < 3:
        return None
    xs = [math.log(x) for x, _ in points]
    ys = [math.log(y) for _, y in points]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)


def main(path: str) -> None:
    data = json.load(open(path))
    rows = defaultdict(dict)
    for e in data["summary"]:
        rows[(e["family"], e["size"])][e["algo"]] = e
    print("## Segmentation\n")
    print("| image | n | m | EK ms | Dinic ms | push-relabel ms | augmentations | Dinic phases | pushes | relabels |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for (fam, size), r in sorted(rows.items(), key=lambda kv: (kv[0][0], -next(iter(kv[1].values()))["n"])):
        if fam != "seg":
            continue
        d, p = r.get("dinic", {}), r.get("pr", {})
        any_ = next(iter(r.values()))
        print(f"| {size} | {any_['n']:,} | {any_['m']:,} | {cell(r.get('ek'))} | {cell(r.get('dinic'))} | {cell(r.get('pr'))} "
              f"| {d.get('augmentations', 0):,.0f} | {d.get('phases', 0):,.0f} | {p.get('pushes', 0):,.0f} | {p.get('relabels', 0):,.0f} |")
    for fam in ("genrmf-long", "genrmf-wide", "rlg-wide", "ak"):
        print(f"\n## {fam}\n")
        print("| size | n | m | EK ms | Dinic ms | push-relabel ms | augmentations | phases | pushes | relabels | global relabels |")
        print("|---|---|---|---|---|---|---|---|---|---|---|")
        for (f, size), r in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1] if isinstance(kv[0][1], int) else 0)):
            if f != fam:
                continue
            d, p = r.get("dinic", {}), r.get("pr", {})
            e = r.get("ek", {})
            aug = d.get("augmentations", e.get("augmentations", 0))
            any_ = next(iter(r.values()))
            print(f"| {size} | {any_['n']:,} | {any_['m']:,} | {cell(r.get('ek'))} | {cell(r.get('dinic'))} | {cell(r.get('pr'))} "
                  f"| {aug:,.0f} | {d.get('phases', 0):,.0f} | {p.get('pushes', 0):,.0f} | {p.get('relabels', 0):,.0f} | {p.get('global_relabels', 0):,.1f} |")
        print()
        for algo in ALGOS:
            pts = [(r[algo]["n"], r[algo]["median_s"]) for (f, _), r in rows.items() if f == fam and algo in r and "median_s" in r[algo]]
            pts.sort()
            s = slope(pts)
            extra = ""
            key = {"ek": "augmentations", "dinic": "phases", "pr": "relabels"}[algo]
            ops = [(r[algo]["n"], r[algo][key]) for (f, _), r in rows.items() if f == fam and algo in r and key in r[algo] and r[algo][key] > 0]
            ops.sort()
            so = slope(ops)
            if so is not None:
                extra = f", {key} ~ n^{so:.2f}"
            if s is not None:
                print(f"- {algo}: time ~ n^{s:.2f} over n = {pts[0][0]:,}..{pts[-1][0]:,}{extra}")
    # Edmonds-Karp augmentation counts against the O(nm) bound
    print("\n## Augmentations relative to n*m/2 (largest instance each algorithm finished)\n")
    for (f, size), r in sorted(rows.items(), key=lambda kv: str(kv[0])):
        e = r.get("dinic") or r.get("ek")
        if e and "augmentations" in e:
            print(f"- {f} {size}: augmentations {e['augmentations']:,.0f}, n*m/2 = {e['n'] * e['m'] / 2:,.0f}, ratio {e['augmentations'] / (e['n'] * e['m'] / 2):.2e}; phases {r.get('dinic', {}).get('phases', 0):,.0f} vs n-1 = {e['n'] - 1:,}")


if __name__ == "__main__":
    main(sys.argv[1])
