"""Measure nested loop, hash and merge joins on the tables setup.py builds.

For each scale, each orders layout (rand, clu) and each outer size k, run

    select sum(o.total) from customers_n c join orders_<layout>_n o
      on o.cust_id = c.id where c.seg < k

four ways: forced nested loop, forced hash join, forced merge join (by turning
the other two enable_* settings off), and the planner's own choice. Each is run
once to warm the cache, then RUNS times (3 when every run exceeds 2 s) under EXPLAIN (ANALYZE, BUFFERS,
TIMING OFF, FORMAT JSON). The planner's estimated total cost, estimated and
actual rows, node types and execution time are recorded.

A forced method stops growing k once one run exceeds CAP_S seconds, so the
largest points of the slow methods are absent, not extrapolated.

Run: python3 sweep.py results.json
"""
import json
import statistics
import sys
import time

from common import SCALES, connect

RUNS = 5
CAP_S = 20.0
FORCE = {
    "nestloop": ("enable_hashjoin", "enable_mergejoin"),
    "hash": ("enable_nestloop", "enable_mergejoin"),
    "merge": ("enable_nestloop", "enable_hashjoin"),
    "planner": (),
}


def ks(m):
    out, k = [], 1
    while k < m:
        out += [k, 3 * k] if 3 * k < m else [k]
        k *= 10
    return out + [m]


def nodes(plan, acc):
    acc.append(plan["Node Type"] + (f"[{plan['Join Type']}]" if "Join Type" in plan else ""))
    for p in plan.get("Plans", []):
        nodes(p, acc)
    return acc


def join_node(plan):
    if plan["Node Type"] in ("Nested Loop", "Hash Join", "Merge Join"):
        return plan
    for p in plan.get("Plans", []):
        j = join_node(p)
        if j:
            return j
    return None


def explain(c, sql):
    row = c.execute("explain (analyze, buffers, timing off, format json) " + sql).fetchone()[0][0]
    return row


def run_case(c, sql, method):
    for s in ("enable_nestloop", "enable_hashjoin", "enable_mergejoin"):
        c.execute(f"set {s} = {'off' if s in FORCE[method] else 'on'}")
    explain(c, sql)  # warm-up
    times, last = [], None
    for _ in range(RUNS):
        last = explain(c, sql)
        times.append(last["Execution Time"])
        if last["Execution Time"] > CAP_S * 1000:
            break
        if len(times) >= 3 and min(times) > 2000:
            break  # slow cases: 3 runs instead of RUNS
    plan = last["Plan"]
    j = join_node(plan)
    return {
        "method": method,
        "times_ms": times,
        "median_ms": statistics.median(times),
        "est_cost": plan["Total Cost"],
        "startup_cost": plan["Startup Cost"],
        "join": j["Node Type"] if j else None,
        "join_est_rows": j["Plan Rows"] if j else None,
        "join_act_rows": j["Actual Rows"] if j else None,
        "nodes": nodes(plan, []),
        "planning_ms": last["Planning Time"],
        "shared_hit": plan.get("Shared Hit Blocks"),
        "shared_read": plan.get("Shared Read Blocks"),
        "temp_written": plan.get("Temp Written Blocks"),
        "hash_batches": find(plan, "Hash Batches"),
    }


def find(plan, key):
    if key in plan:
        return plan[key]
    for p in plan.get("Plans", []):
        v = find(p, key)
        if v is not None:
            return v
    return None


def main(out):
    try:
        results = json.load(open(out))
    except FileNotFoundError:
        results = {"meta": {}, "cases": []}
    done = {(r["scale"], r["layout"], r["k"], r["method"]) for r in results["cases"]}
    with connect() as c:
        results["meta"] = {
            "version": c.execute("select version()").fetchone()[0],
            "settings": dict(
                c.execute(
                    """select name, setting from pg_settings where name in
                    ('shared_buffers','work_mem','random_page_cost','seq_page_cost',
                     'cpu_tuple_cost','cpu_index_tuple_cost','cpu_operator_cost',
                     'effective_cache_size','max_parallel_workers_per_gather','jit')"""
                ).fetchall()
            ),
            "relpages": dict(
                c.execute(
                    "select relname, relpages from pg_class where relname ~ '^(customers|orders)_'"
                ).fetchall()
            ),
        }
        for n in SCALES:
            m = n // 10
            for layout in ("rand", "clu"):
                capped = set()
                for k in ks(m):
                    sql = (
                        f"select sum(o.total) from customers_{n} c join orders_{layout}_{n} o "
                        f"on o.cust_id = c.id where c.seg < {k}"
                    )
                    for method in FORCE:
                        if (n, layout, k, method) in done or method in capped:
                            continue
                        t0 = time.time()
                        r = run_case(c, sql, method)
                        r.update(scale=n, layout=layout, k=k)
                        results["cases"].append(r)
                        print(
                            f"{n:>9} {layout:4} k={k:>8} {method:8} {r['join']:12} "
                            f"{r['median_ms']:10.2f} ms  cost {r['est_cost']:12.1f} "
                            f"({time.time()-t0:.0f}s)",
                            flush=True,
                        )
                        if max(r["times_ms"]) > CAP_S * 1000:
                            capped.add(method)
                        json.dump(results, open(out, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
