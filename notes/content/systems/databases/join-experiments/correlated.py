"""Correlated predicates: the independence assumption and CREATE STATISTICS.

customers_corr is customers_10000000 (1,000,000 customers) with three columns
that are functions of one another:
    country   = id % 50         (50 values, 2% each)
    region    = country / 10    (5 values, 20% each)
    continent = (region >= 3)   (2 values; region 0-2 -> false, 60%)
The predicate country = 7 AND region = 0 AND NOT continent matches the 20,000
customers with country 7. Under independence the planner multiplies
0.02 * 0.2 * 0.6 = 0.0024 and expects 2,400. The query joins those customers
to orders_rand_10000000 (10 orders each).

The query runs with the planner's choice and with each join method forced,
first with per-column statistics only, then after CREATE STATISTICS
(dependencies, mcv) and ANALYZE, then once more with random_page_cost
lowered from 4 to 1.1.

Run: python3 correlated.py correlated.json
"""
import json
import sys

from common import connect
from sweep import FORCE, run_case

SQL = (
    "select sum(o.total) from customers_corr c join orders_rand_10000000 o "
    "on o.cust_id = c.id where c.country = 7 and c.region = 0 and not c.continent"
)


def scan_estimate(c):
    plan = c.execute(
        "explain (analyze, timing off, format json) select count(*) from customers_corr c "
        "where c.country = 7 and c.region = 0 and not c.continent"
    ).fetchone()[0][0]["Plan"]
    scan = plan["Plans"][0]
    return scan["Plan Rows"], scan["Actual Rows"]


def main(out):
    res = []
    with connect() as c:
        c.execute("drop table if exists customers_corr")
        c.execute(
            """create table customers_corr as
               select id, seg, name, id % 50 as country, (id % 50) / 10 as region,
                      ((id % 50) / 10) >= 3 as continent
               from customers_10000000 order by id"""
        )
        c.execute("alter table customers_corr add primary key (id)")
        c.execute("vacuum analyze customers_corr")
        stages = (
            "per-column statistics",
            "create statistics (dependencies, mcv)",
            "create statistics, random_page_cost 1.1",
        )
        for stage in stages:
            if stage.endswith("1.1"):
                c.execute("set random_page_cost = 1.1")
            elif stage.startswith("create"):
                c.execute(
                    "create statistics customers_corr_dep (dependencies, mcv) "
                    "on country, region, continent from customers_corr"
                )
                c.execute("analyze customers_corr")
            est, act = scan_estimate(c)
            print(stage, "filter estimate", est, "actual", act, flush=True)
            for method in FORCE:
                r = run_case(c, SQL, method)
                r.update(stage=stage, filter_est_rows=est, filter_act_rows=act)
                res.append(r)
                print(f"  {method:8} {r['join']:12} {r['median_ms']:9.1f} ms cost {r['est_cost']:.0f}", flush=True)
    json.dump(res, open(out, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
