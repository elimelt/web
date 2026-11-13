"""Experiment A: what one idle snapshot does to an update-heavy table.

Three writer threads update random rows of a 10,000-row table at a fixed
total rate. In the "held" condition a REPEATABLE READ transaction reads one
row at t=0 and then sits idle until HOLD seconds, which pins the xmin
horizon; in the "none" condition nothing holds a snapshot. Every SAMPLE
seconds a sampler records the table and index size, dead tuples, the HOT
update share, and point-read latency from a fresh session (and, while it
is open, from the old snapshot itself).

Run (about 21 minutes):  python3 bloat.py --reps 3 > bloat.json
"""
import argparse
import json
import random
import sys
import threading
import time

from common import connect, ensure_db, median

ROWS = 10_000


def setup():
    ensure_db()
    with connect() as c:
        c.execute("drop table if exists accounts")
        c.execute("create table accounts (id int primary key, balance bigint not null, filler text not null)")
        c.execute("insert into accounts select g, 0, repeat('x', 80) from generate_series(1, %s) g", (ROWS,))
        c.execute("vacuum (analyze) accounts")
        c.execute("select pg_stat_reset()")


def writer(stop, rate, counter, lock, seed):
    rng = random.Random(seed)
    period = 1.0 / rate
    with connect() as c:
        nxt = time.perf_counter()
        n = 0
        while not stop.is_set():
            c.execute("update accounts set balance = balance + 1 where id = %s", (rng.randint(1, ROWS),))
            n += 1
            nxt += period
            d = nxt - time.perf_counter()
            if d > 0:
                time.sleep(d)
        with lock:
            counter[0] += n


def point_reads(conn, rng, k=200):
    """Server-side execution time (us, median) and buffers touched (mean) of a
    primary-key lookup, from EXPLAIN (ANALYZE, BUFFERS), over k random ids."""
    lat, bufs = [], []
    for _ in range(k):
        i = rng.randint(1, ROWS)
        plan = conn.execute(
            "explain (analyze, buffers, timing off, format json) select balance from accounts where id = %s", (i,)
        ).fetchone()[0][0]
        lat.append(plan["Execution Time"] * 1e3)
        node = plan["Plan"]
        bufs.append(node.get("Shared Hit Blocks", 0) + node.get("Shared Read Blocks", 0))
    return median(lat), sum(bufs) / len(bufs)


def sizes(conn):
    r = conn.execute(
        "select pg_relation_size('accounts'), pg_relation_size('accounts_pkey'), "
        "n_dead_tup, n_live_tup, n_tup_upd, n_tup_hot_upd, autovacuum_count "
        "from pg_stat_user_tables where relname='accounts'"
    ).fetchone()
    return dict(heap_bytes=r[0], index_bytes=r[1], dead=r[2], live=r[3], upd=r[4], hot_upd=r[5], autovac=r[6])


def run(cond, total, hold, sample, rate, seed):
    setup()
    rng = random.Random(seed)
    old = None
    if cond == "held":
        old = connect(autocommit=False)
        old.execute("begin isolation level repeatable read")
        old.execute("select balance from accounts where id = 1").fetchone()
    stop = threading.Event()
    counter, lock = [0], threading.Lock()
    ws = [threading.Thread(target=writer, args=(stop, rate / 3, counter, lock, seed * 10 + k)) for k in range(3)]
    t0 = time.perf_counter()
    for w in ws:
        w.start()
    fresh = connect()
    samples = []
    released = False
    while True:
        t = time.perf_counter() - t0
        if old is not None and not released and t >= hold:
            old.rollback()
            old.close()
            released = True
        s = dict(t=round(t, 1), **sizes(fresh))
        s["fresh_read_us"], s["fresh_read_bufs"] = point_reads(fresh, rng)
        if old is not None and not released:
            s["old_read_us"], s["old_read_bufs"] = point_reads(old, rng)
        tc = time.perf_counter()
        fresh.execute("select count(*) from accounts").fetchone()
        s["seqscan_ms"] = (time.perf_counter() - tc) * 1e3
        samples.append(s)
        print(cond, json.dumps(s), file=sys.stderr, flush=True)
        if t >= total:
            break
        time.sleep(max(0.0, sample - ((time.perf_counter() - t0) - t)))
    stop.set()
    for w in ws:
        w.join()
    elapsed = time.perf_counter() - t0
    fresh.close()
    return dict(cond=cond, seed=seed, updates=counter[0], elapsed=elapsed, samples=samples)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--total", type=float, default=210)
    ap.add_argument("--hold", type=float, default=150)
    ap.add_argument("--sample", type=float, default=5)
    ap.add_argument("--rate", type=float, default=1500)
    a = ap.parse_args()
    with connect("postgres") as c:
        settings = dict(c.execute(
            "select name, setting from pg_settings where name in "
            "('server_version','autovacuum','autovacuum_naptime','autovacuum_vacuum_scale_factor',"
            "'autovacuum_vacuum_threshold','shared_buffers','block_size')").fetchall())
    runs = []
    for rep in range(a.reps):
        for cond in ("none", "held"):
            runs.append(run(cond, a.total, a.hold, a.sample, a.rate, seed=rep + 1))
    json.dump(dict(settings=settings, args=vars(a), rows=ROWS, runs=runs), sys.stdout, indent=1)


if __name__ == "__main__":
    main()
