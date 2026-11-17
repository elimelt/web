"""Record the planner's estimated cost of each join method, without running it.

For every (scale, layout, k) of sweep.py and several values of
random_page_cost, EXPLAIN (no ANALYZE) the query with each method forced and
with the planner's free choice. Comparing these estimates with the times
sweep.py measured shows where the cost model puts the crossover between
nested loop and hash join, and how far that is from the measured one.

For random_page_cost other than the default 4, the planner's choice is also
run (EXPLAIN ANALYZE, warm-up plus 3 runs) so its time is measured directly.

Run: python3 planner_costs.py planner_costs.json
"""
import json
import sys

from common import SCALES, connect
from sweep import FORCE, join_node, ks, run_case
import sweep

RPC = [4.0, 2.0, 1.1, 1.0]


def main(out):
    rows = []
    with connect() as c:
        for rpc in RPC:
            c.execute(f"set random_page_cost = {rpc}")
            for n in SCALES:
                for layout in ("rand", "clu"):
                    for k in ks(n // 10):
                        sql = (
                            f"select sum(o.total) from customers_{n} c join orders_{layout}_{n} o "
                            f"on o.cust_id = c.id where c.seg < {k}"
                        )
                        row = {"rpc": rpc, "scale": n, "layout": layout, "k": k}
                        for method in FORCE:
                            for s in ("enable_nestloop", "enable_hashjoin", "enable_mergejoin"):
                                c.execute(f"set {s} = {'off' if s in FORCE[method] else 'on'}")
                            plan = c.execute("explain (format json) " + sql).fetchone()[0][0]["Plan"]
                            row[method] = plan["Total Cost"]
                            if method == "planner":
                                row["choice"] = join_node(plan)["Node Type"]
                        if rpc != 4.0:
                            # The planner's own choice under this setting, run as in sweep.py
                            # but 3 times, since sweep.py already timed every forced method.
                            sweep.RUNS = 3
                            r = run_case(c, sql, "planner")
                            row["choice_ms"] = r["median_ms"]
                            row["choice_times_ms"] = r["times_ms"]
                        rows.append(row)
                        print(row, flush=True)
        # Inputs for the textbook page-I/O model: heap pages, B-tree height and
        # rows per page of each orders table (pageinspect's bt_metap gives the
        # root's level; a descent reads level + 1 pages).
        c.execute("create extension if not exists pageinspect")
        relstats = {}
        for n in SCALES:
            for layout in ("rand", "clu"):
                t = f"orders_{layout}_{n}"
                pages, tuples = c.execute(
                    "select relpages, reltuples from pg_class where relname = %s", (t,)
                ).fetchone()
                level = c.execute(f"select level from bt_metap('{t}_cust_id_idx')").fetchone()[0]
                cpages = c.execute(
                    "select relpages from pg_class where relname = %s", (f"customers_{n}",)
                ).fetchone()[0]
                relstats[f"{n}/{layout}"] = {
                    "orders_pages": pages,
                    "orders_rows": tuples,
                    "customers_pages": cpages,
                    "index_levels": level + 1,
                }
    json.dump({"rows": rows, "relstats": relstats}, open(out, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
