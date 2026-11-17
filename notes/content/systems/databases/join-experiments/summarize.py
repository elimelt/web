"""Reduce results.json, planner_costs.json and correlated.json to the small
join-summary.json the note's figure loads, and print the tables the note cites.

Also writes join-summary-crossovers.json, the nested loop to hash join
crossovers computed here, which the figure's test checks its own code against.

Run: python3 summarize.py results.json planner_costs.json correlated.json join-summary.json
"""
import json
import math
import sys

METHODS = ["nestloop", "hash", "merge"]


def crossover(points, a, b):
    """Smallest k (log-interpolated) at which method b becomes cheaper than a.

    points: list of dicts with k and a value per method, sorted by k.
    Returns None if b never becomes cheaper, or if b is cheaper at the first k.
    """
    prev = None
    for p in points:
        if p.get(a) is None or p.get(b) is None:
            prev = None
            continue
        d = math.log(p[b]) - math.log(p[a])  # < 0 once b is cheaper
        if d < 0:
            if prev is None:
                return None
            k0, d0 = prev
            t = d0 / (d0 - d)
            return math.exp(math.log(k0) + t * (math.log(p["k"]) - math.log(k0)))
        prev = (p["k"], d)
    return None


def main(res_path, est_path, corr_path, out_path):
    res = json.load(open(res_path))
    est_all = json.load(open(est_path))
    est, relstats = est_all["rows"], est_all["relstats"]
    corr = json.load(open(corr_path)) if corr_path != "-" else []
    measured = {}
    for r in res["cases"]:
        s = measured.setdefault(str(r["scale"]), {}).setdefault(r["layout"], {})
        s.setdefault(r["method"], []).append(
            {
                "k": r["k"],
                "median": round(r["median_ms"], 3),
                "min": round(min(r["times_ms"]), 3),
                "max": round(max(r["times_ms"]), 3),
                "runs": len(r["times_ms"]),
                **({"join": r["join"]} if r["method"] == "planner" else {}),
            }
        )
    for layouts in measured.values():
        for methods in layouts.values():
            for pts in methods.values():
                pts.sort(key=lambda p: p["k"])
    estimated = {}
    for r in est:
        e = estimated.setdefault(f"{r['rpc']:g}", {}).setdefault(str(r["scale"]), {}).setdefault(r["layout"], [])
        row = {"k": r["k"], **{m: round(r[m], 1) for m in METHODS}, "choice": r["choice"]}
        if "choice_ms" in r:
            row["choice_ms"] = round(r["choice_ms"], 3)
        e.append(row)
    summary = {
        "meta": {
            "version": res["meta"]["version"].split(" on ")[0],
            "settings": res["meta"]["settings"],
            "relpages": res["meta"]["relpages"],
        },
        "relstats": relstats,
        "measured": measured,
        # The figure offers the default random_page_cost and 1.1; the other
        # values stay in planner_costs.json and the crossovers file.
        "estimated": {r: estimated[r] for r in ("4", "1.1")},
    }
    json.dump(summary, open(out_path, "w"), separators=(",", ":"))

    # NL -> hash crossovers, computed here independently of the figure's
    # TypeScript, for the figure's test to compare against.
    cross = {}
    for scale, layouts in measured.items():
        for layout, ms in layouts.items():
            pts = {}
            for m in METHODS:
                for p in ms.get(m, []):
                    pts.setdefault(p["k"], {"k": p["k"]})[m] = p["median"]
            pts = [pts[k] for k in sorted(pts)]
            cross[f"time/{scale}/{layout}"] = crossover(pts, "nestloop", "hash")
            for rpc, by in estimated.items():
                cross[f"cost/{rpc}/{scale}/{layout}"] = crossover(by[scale][layout], "nestloop", "hash")
    for key, st in relstats.items():
        P, per_page = st["orders_pages"], st["orders_rows"] / st["orders_pages"]
        heap = P * (1 - (1 - 1 / P) ** 10) if key.endswith("rand") else 1 + 9 / per_page
        cross[f"io/{key}"] = P / (st["index_levels"] + heap)
        print(f"page-I/O model {key}: {st['index_levels'] + heap:.2f} pages per probe, "
              f"{P} orders pages, crossover k={P / (st['index_levels'] + heap):.0f}")
    json.dump(cross, open(out_path.replace(".json", "-crossovers.json"), "w"), indent=1)

    # Tables for the note.
    name = {"Nested Loop": "nestloop", "Hash Join": "hash", "Merge Join": "merge"}
    for scale, layouts in measured.items():
        for layout, ms in layouts.items():
            pts = {}
            for m in METHODS:
                for p in ms.get(m, []):
                    pts.setdefault(p["k"], {"k": p["k"]})[m] = p["median"]
            pts = [pts[k] for k in sorted(pts)]
            mx = crossover(pts, "nestloop", "hash")
            print(f"\n== {scale} {layout}: measured NL->hash crossover k={mx and round(mx)}")
            for rpc, by in estimated.items():
                ep = by[scale][layout]
                ex = crossover(ep, "nestloop", "hash")
                print(f"   rpc={rpc}: estimated NL->hash crossover k={ex and round(ex)}")
            print(f"{'k':>8} {'NL':>9} {'hash':>9} {'merge':>9}  fastest  planner(rpc4)   regret  | rpc1.1 choice ms")
            plan = {p["k"]: p for p in ms["planner"]}
            e11 = {p["k"]: p for p in estimated.get("1.1", {}).get(scale, {}).get(layout, [])}
            for p in pts:
                avail = {m: p[m] for m in METHODS if m in p}
                fast = min(avail, key=avail.get)
                pl = plan[p["k"]]
                regret = pl["median"] / avail[fast]
                q = e11.get(p["k"], {})
                print(
                    f"{p['k']:>8} "
                    + " ".join(f"{p.get(m, float('nan')):9.1f}" for m in METHODS)
                    + f"  {fast:8} {name.get(pl['join'], pl['join']):8} {pl['median']:8.1f} {regret:5.2f}x"
                    + (f"  | {name.get(q.get('choice'), q.get('choice')):8} {q.get('choice_ms', float('nan')):8.1f}" if q else "")
                )
    if corr:
        print("\n== correlated predicates")
        for r in corr:
            print(
                f"{r['stage'][:12]:12} est {r['filter_est_rows']:>6} act {r['filter_act_rows']:>6} "
                f"{r['method']:8} {r['join']:12} {r['median_ms']:9.1f} ms  ({min(r['times_ms']):.1f}-{max(r['times_ms']):.1f})"
            )


if __name__ == "__main__":
    main(*sys.argv[1:5])
