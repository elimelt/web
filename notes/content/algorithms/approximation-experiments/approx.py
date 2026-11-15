"""Approximation ratios for vertex cover and set cover, measured against exact optima.

Every optimum here is computed exactly by an integer program solved with HiGHS
(through scipy.optimize.milp). Every heuristic is the plain textbook version.

    python3 -m pip install scipy numpy networkx
    python3 approx.py > results.json

The script prints one JSON object. See approximation-algorithms.mdx for the
tables built from it.
"""

from __future__ import annotations

import json
import math
import platform
import random
import sys
import time

import networkx as nx
import numpy as np
import scipy
from scipy.optimize import Bounds, LinearConstraint, linprog, milp
from scipy.sparse import csr_matrix

SEEDS = range(30)


# ---------------------------------------------------------------- vertex cover


def edge_matrix(g: nx.Graph) -> tuple[csr_matrix, list]:
    nodes = list(g.nodes())
    index = {v: i for i, v in enumerate(nodes)}
    rows, cols = [], []
    for r, (u, v) in enumerate(g.edges()):
        rows += [r, r]
        cols += [index[u], index[v]]
    a = csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(g.number_of_edges(), len(nodes)))
    return a, nodes


def vc_exact(g: nx.Graph) -> int:
    if g.number_of_edges() == 0:
        return 0
    a, nodes = edge_matrix(g)
    res = milp(
        c=np.ones(len(nodes)),
        constraints=LinearConstraint(a, lb=1, ub=np.inf),
        integrality=np.ones(len(nodes)),
        bounds=Bounds(0, 1),
    )
    assert res.success, res.message
    return int(round(res.fun))


def vc_lp(g: nx.Graph) -> tuple[float, list]:
    """LP relaxation, solved by dual simplex so the answer is a vertex of the polytope."""
    a, nodes = edge_matrix(g)
    res = linprog(np.ones(len(nodes)), A_ub=-a, b_ub=-np.ones(a.shape[0]), bounds=(0, 1), method="highs-ds")
    assert res.status == 0, res.message
    return float(res.fun), list(res.x)


def vc_lp_round(g: nx.Graph) -> tuple[int, float, bool]:
    value, x = vc_lp(g)
    half_integral = all(min(abs(v), abs(v - 0.5), abs(v - 1)) < 1e-7 for v in x)
    nodes = list(g.nodes())
    cover = {nodes[i] for i, v in enumerate(x) if v >= 0.5 - 1e-9}
    assert is_cover(g, cover)
    return len(cover), value, half_integral


def is_cover(g: nx.Graph, cover: set) -> bool:
    return all(u in cover or v in cover for u, v in g.edges())


def vc_matching(g: nx.Graph, rng: random.Random) -> tuple[int, int, set]:
    """Scan edges in random order; take both ends of any edge still uncovered."""
    edges = list(g.edges())
    rng.shuffle(edges)
    cover: set = set()
    matched = 0
    for u, v in edges:
        if u not in cover and v not in cover:
            cover |= {u, v}
            matched += 1
    assert is_cover(g, cover)
    return len(cover), matched, cover


def prune(g: nx.Graph, cover: set, rng: random.Random) -> int:
    """Drop cover vertices whose every neighbour is already in the cover."""
    cover = set(cover)
    order = list(cover)
    rng.shuffle(order)
    for v in order:
        if all(w in cover for w in g.neighbors(v)):
            cover.discard(v)
    assert is_cover(g, cover)
    return len(cover)


def vc_max_degree(g: nx.Graph, rng: random.Random | None, prefer: set | None = None) -> int:
    """Repeatedly take a vertex of largest remaining degree.

    Ties go to a random vertex, or to a vertex in `prefer` when given (the
    adversarial tie-break used for the worst case)."""
    h = g.copy()
    taken = 0
    while h.number_of_edges():
        top = max(d for _, d in h.degree())
        cands = [v for v, d in h.degree() if d == top]
        if prefer is not None:
            pick = next((v for v in cands if v in prefer), cands[0])
        else:
            pick = rng.choice(cands)
        h.remove_node(pick)
        taken += 1
    return taken


def johnson_graph(k: int) -> tuple[nx.Graph, set]:
    """Bipartite graph where max-degree greedy can take ~k(H_k - 1) vertices but k suffice.

    Left side L has k vertices. For each i = 2..k there is a block R_i of
    floor(k/i) right vertices; each joins i left vertices, and the blocks of R_i
    use disjoint left vertices, so a left vertex gets at most one edge per block."""
    g = nx.Graph()
    left = [("L", j) for j in range(k)]
    g.add_nodes_from(left)
    right = set()
    for i in range(2, k + 1):
        for b in range(k // i):
            r = ("R", i, b)
            right.add(r)
            for j in range(b * i, b * i + i):
                g.add_edge(r, left[j])
    return g, right


def ratio_stats(values: list[float]) -> dict:
    a = np.array(values, dtype=float)
    return {"mean": round(float(a.mean()), 4), "min": round(float(a.min()), 4), "max": round(float(a.max()), 4)}


def vc_row(g: nx.Graph, seed: int) -> dict:
    rng = random.Random(seed)
    opt = vc_exact(g)
    m_size, matched, cover = vc_matching(g, rng)
    pruned = prune(g, cover, rng)
    lp_size, lp_value, half = vc_lp_round(g)
    deg = vc_max_degree(g, rng)
    return {
        "opt": opt,
        "matching": m_size,
        "matched_edges": matched,
        "matching_pruned": pruned,
        "lp_round": lp_size,
        "lp_value": round(lp_value, 4),
        "lp_half_integral": half,
        "max_degree": deg,
    }


def vc_family(name: str, make, seeds=SEEDS) -> dict:
    rows = []
    for s in seeds:
        g = make(s)
        g.remove_nodes_from(list(nx.isolates(g)))
        if g.number_of_edges() == 0:
            continue
        rows.append(vc_row(g, s))
    out = {"family": name, "runs": len(rows)}
    for key in ("matching", "matching_pruned", "lp_round", "max_degree"):
        out[key] = ratio_stats([r[key] / r["opt"] for r in rows])
    out["certificate"] = ratio_stats([r["matching"] / r["matched_edges"] / 1 for r in rows])  # always 2
    out["opt_over_matched"] = ratio_stats([r["opt"] / r["matched_edges"] for r in rows])
    out["lp_gap"] = ratio_stats([r["opt"] / r["lp_value"] for r in rows])
    out["half_integral_all"] = all(r["lp_half_integral"] for r in rows)
    out["mean_opt"] = round(float(np.mean([r["opt"] for r in rows])), 2)
    return out


REAL_GRAPHS = {
    "Florentine families (15 nodes, 20 edges)": nx.florentine_families_graph,
    "Zachary karate club (34, 78)": nx.karate_club_graph,
    "Davis southern women (32, 89)": nx.davis_southern_women_graph,
    "Les Misérables co-appearance (77, 254)": nx.les_miserables_graph,
}


def vertex_cover_experiments() -> dict:
    out = {"random": [], "real": [], "johnson": []}
    for n, c in [(60, 1), (60, 2), (60, 4), (60, 8), (60, 16), (200, 3)]:
        p = c / (n - 1)
        out["random"].append(vc_family(f"G(n={n}, average degree {c})", lambda s, n=n, p=p: nx.gnp_random_graph(n, p, seed=1000 + s)))
    for m in (1, 3):
        out["random"].append(vc_family(f"Barabási-Albert (n=100, m={m})", lambda s, m=m: nx.barabasi_albert_graph(100, m, seed=2000 + s)))
    out["random"].append(vc_family("Random geometric (n=100, r=0.15)", lambda s: nx.random_geometric_graph(100, 0.15, seed=3000 + s)))
    for name, make in REAL_GRAPHS.items():
        g = nx.Graph(make())
        fam = vc_family(name, lambda s, g=g: g)
        out["real"].append(fam)
    for k in (6, 10, 20, 40, 80):
        g, right = johnson_graph(k)
        opt = vc_exact(g)
        bad = vc_max_degree(g, None, prefer=right)
        rnd = [vc_max_degree(g, random.Random(s)) for s in range(10)]
        out["johnson"].append({
            "k": k, "vertices": g.number_of_nodes(), "edges": g.number_of_edges(), "opt": opt,
            "greedy_adversarial": bad, "ratio_adversarial": round(bad / opt, 4),
            "greedy_random_ties_mean": round(float(np.mean(rnd)) / opt, 4),
            "H_k_minus_1": round(sum(1 / i for i in range(2, k + 1)), 4),
            "right_side": len(right),
        })
    return out


# ------------------------------------------------------------------- set cover


def sc_exact(n: int, sets: list[set], costs: list[float] | None = None, relax: bool = False) -> float:
    m = len(sets)
    rows, cols = [], []
    for j, s in enumerate(sets):
        for e in s:
            rows.append(e)
            cols.append(j)
    a = csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, m))
    c = np.ones(m) if costs is None else np.array(costs, dtype=float)
    if relax:
        res = linprog(c, A_ub=-a, b_ub=-np.ones(n), bounds=(0, 1), method="highs")
        assert res.status == 0, res.message
        return float(res.fun)
    res = milp(c=c, constraints=LinearConstraint(a, lb=1, ub=np.inf), integrality=np.ones(m), bounds=Bounds(0, 1))
    assert res.success, res.message
    return float(res.fun)


def sc_greedy(n: int, sets: list[set], costs: list[float] | None = None, rng: random.Random | None = None) -> tuple[float, list[int]]:
    """Take the set with the lowest cost per newly covered element (most new elements when unweighted)."""
    uncovered = set(range(n))
    chosen: list[int] = []
    total = 0.0
    while uncovered:
        best, best_val = [], math.inf
        for j, s in enumerate(sets):
            new = len(s & uncovered)
            if not new:
                continue
            val = (1.0 if costs is None else costs[j]) / new
            if val < best_val - 1e-12:
                best, best_val = [j], val
            elif abs(val - best_val) <= 1e-12:
                best.append(j)
        j = rng.choice(best) if rng else best[0]
        chosen.append(j)
        total += 1.0 if costs is None else costs[j]
        uncovered -= sets[j]
    return total, chosen


def harmonic(d: int) -> float:
    return sum(1 / i for i in range(1, d + 1))


def random_instance(n: int, m: int, p: float, rng: random.Random) -> list[set]:
    sets = [{e for e in range(n) if rng.random() < p} for _ in range(m)]
    for e in range(n):
        if not any(e in s for s in sets):
            sets[rng.randrange(m)].add(e)
    return sets


def sc_row(n: int, sets: list[set], seed: int) -> dict:
    rng = random.Random(seed)
    opt = sc_exact(n, sets)
    alg, _ = sc_greedy(n, sets, rng=rng)
    lp = sc_exact(n, sets, relax=True)
    d = max(len(s) for s in sets)
    k = int(round(opt))
    return {
        "n": n, "m": len(sets), "d": d, "opt": k, "greedy": int(alg), "lp": round(lp, 4),
        "bound_Hd": round(harmonic(d) * k, 4),
        "bound_ceil_k_ln_n": math.ceil(k * math.log(n)),
        "bound_k_ln_n_over_k_plus_k": round(k * math.log(n / k) + k, 4) if k else 0,
    }


def sc_family(name: str, make, seeds=SEEDS) -> dict:
    rows = []
    for s in seeds:
        n, sets = make(s)
        rows.append(sc_row(n, sets, s))
    ratios = [r["greedy"] / r["opt"] for r in rows]
    return {
        "family": name, "runs": len(rows), "mean_opt": round(float(np.mean([r["opt"] for r in rows])), 2),
        "ratio": ratio_stats(ratios),
        "optimal_runs": sum(1 for r in rows if r["greedy"] == r["opt"]),
        "Hd": ratio_stats([r["bound_Hd"] / r["opt"] for r in rows]),
        "mean_d": round(float(np.mean([r["d"] for r in rows])), 1),
        "lp_gap": ratio_stats([r["opt"] / r["lp"] for r in rows]),
        "any_bound_violated": any(
            r["greedy"] > r["bound_Hd"] + 1e-9 or r["greedy"] > r["bound_ceil_k_ln_n"] or r["greedy"] > r["bound_k_ln_n_over_k_plus_k"] + 1e-9
            for r in rows
        ),
    }


def domination_instance(g: nx.Graph) -> tuple[int, list[set]]:
    nodes = list(g.nodes())
    index = {v: i for i, v in enumerate(nodes)}
    sets = [{index[v]} | {index[w] for w in g.neighbors(v)} for v in nodes]
    return len(nodes), sets


def two_rows(m: int) -> tuple[int, list[set], list[str]]:
    """Two rows of 2^m - 1 columns. OPT takes the two rows; greedy takes the m column blocks.

    Block j (j = 1..m) holds columns [2^(j-1) - 1, 2^j - 1) in both rows, so it has
    2^j elements, one more than the 2^j - 1 that a row still has uncovered when
    greedy considers it."""
    cols = 2**m - 1
    top = set(range(cols))
    bottom = set(range(cols, 2 * cols))
    sets, names = [top, bottom], ["top row", "bottom row"]
    for j in range(1, m + 1):
        lo, hi = 2 ** (j - 1) - 1, 2**j - 1
        sets.append(set(range(lo, hi)) | set(range(cols + lo, cols + hi)))
        names.append(f"block {j}")
    return 2 * cols, sets, names


def set_cover_experiments() -> dict:
    out = {"random": [], "domination": [], "two_rows": [], "weighted_tight": []}
    for n, m, p in [(100, 50, 0.03), (100, 50, 0.06), (100, 50, 0.12), (200, 100, 0.03), (200, 100, 0.08), (50, 200, 0.05)]:
        out["random"].append(sc_family(f"n={n} elements, m={m} sets, density {p}", lambda s, n=n, m=m, p=p: (n, random_instance(n, m, p, random.Random(5000 + s)))))
    for name, make in REAL_GRAPHS.items():
        g = nx.Graph(make())
        out["domination"].append(sc_family(f"Dominating set: {name}", lambda s, g=g: domination_instance(g)))
    out["domination"].append(sc_family("Dominating set: G(n=100, average degree 4)", lambda s: domination_instance(nx.gnp_random_graph(100, 4 / 99, seed=6000 + s))))
    out["domination"].append(sc_family("Dominating set: random geometric (n=100, r=0.15)", lambda s: domination_instance(nx.random_geometric_graph(100, 0.15, seed=7000 + s))))
    for m in range(2, 13):
        n, sets, names = two_rows(m)
        alg, chosen = sc_greedy(n, sets)
        out["two_rows"].append({
            "m": m, "n": n, "opt": int(sc_exact(n, sets)), "greedy": int(alg),
            "greedy_order": [names[j] for j in chosen],
            "bound_ceil_k_ln_n": math.ceil(2 * math.log(n)), "bound_Hn_k": round(2 * harmonic(n), 3),
            "bound_Hd_k": round(2 * harmonic(max(len(s) for s in sets)), 3),
        })
    for n in (4, 10, 100, 1000):
        eps = 0.01
        sets = [{i} for i in range(n)] + [set(range(n))]
        costs = [1 / (i + 1) for i in range(n)] + [1 + eps]
        alg, chosen = sc_greedy(n, sets, costs)
        out["weighted_tight"].append({"n": n, "greedy_cost": round(alg, 4), "opt_cost": round(sc_exact(n, sets, costs), 4), "H_n": round(harmonic(n), 4), "sets_taken": len(chosen)})
    return out


def main() -> None:
    t0 = time.time()
    result = {
        "environment": {
            "python": sys.version.split()[0], "numpy": np.__version__, "scipy": scipy.__version__,
            "networkx": nx.__version__, "machine": platform.machine(), "processor": platform.processor(),
        },
        "vertex_cover": vertex_cover_experiments(),
        "set_cover": set_cover_experiments(),
    }
    result["seconds"] = round(time.time() - t0, 1)
    json.dump(result, sys.stdout, indent=1, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
