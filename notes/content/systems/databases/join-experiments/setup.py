"""Build the join tables for every scale.

For a scale of n orders:
  customers_n(id int primary key, seg int, name text)
      n/10 rows; seg is a random permutation of 0..n/10-1, so the predicate
      seg < k selects exactly k customers spread uniformly over the table.
  orders_rand_n(id, cust_id, total)   n rows in random physical order
  orders_clu_n(id, cust_id, total)    the same rows, physically sorted by cust_id
Both orders tables get a B-tree index on cust_id. Every customer has exactly 10
orders. Run: python3 setup.py
"""
from common import SCALES, connect, ensure_db


def build(c, n):
    m = n // 10
    print(f"scale {n}: building", flush=True)
    c.execute(f"drop table if exists customers_{n}, orders_rand_{n}, orders_clu_{n}")
    c.execute("select setseed(0.42)")
    c.execute(
        f"""create table customers_{n} as
            select i as id, (row_number() over (order by random())) - 1 as seg,
                   'customer ' || i as name
            from generate_series(1, {m}) i order by i"""
    )
    c.execute(f"alter table customers_{n} add primary key (id)")
    c.execute(f"alter table customers_{n} alter column seg type int")
    c.execute(
        f"""create table orders_rand_{n} as
            select row_number() over (order by random()) as id,
                   ((g - 1) % {m}) + 1 as cust_id,
                   (random() * 10000)::int as total
            from generate_series(1, {n}) g order by random()"""
    )
    c.execute(f"alter table orders_rand_{n} alter column cust_id type int")
    c.execute(
        f"create table orders_clu_{n} as select * from orders_rand_{n} order by cust_id, id"
    )
    for t in (f"orders_rand_{n}", f"orders_clu_{n}"):
        c.execute(f"create index on {t} (cust_id)")
    for t in (f"customers_{n}", f"orders_rand_{n}", f"orders_clu_{n}"):
        c.execute(f"vacuum analyze {t}")
    for t in (f"orders_rand_{n}", f"orders_clu_{n}"):
        corr = c.execute(
            "select correlation from pg_stats where tablename=%s and attname='cust_id'", (t,)
        ).fetchone()[0]
        print(f"  {t}: cust_id correlation {corr:.3f}", flush=True)


if __name__ == "__main__":
    ensure_db()
    with connect() as c:
        for n in SCALES:
            build(c, n)
