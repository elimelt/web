"""Lost update under load on PostgreSQL.

C clients each commit M increments of one counter row, at one isolation
level, with one of three read-modify-write patterns:

  rmw         SELECT v; UPDATE counter SET v = <v+1>   (value computed in the client)
  atomic      UPDATE counter SET v = v + 1
  for_update  SELECT v FOR UPDATE; UPDATE counter SET v = <v+1>

A transaction that fails with SQLSTATE 40001 (serialization failure), or on
MySQL with a deadlock (1213), is retried until it commits, as an application
would. After the run,
lost = committed increments - final counter value.

  python3 lost_update.py --dsn "host=localhost port=5433 user=postgres" --out lost_update.json
  python3 lost_update.py --mysql --variants rmw --out lost_update_mysql.json
"""
import argparse, json, threading, time
import psycopg
from psycopg import errors
try:
    import pymysql
except ImportError:  # only needed with --mysql
    pymysql = None

MYSQL = dict(unix_socket="/var/run/mysqld/mysqld.sock", user="root", database="exp")

LEVELS = {"ru": "READ UNCOMMITTED", "rc": "READ COMMITTED",
          "rr": "REPEATABLE READ", "ser": "SERIALIZABLE"}


def one_txn(cur, variant):
    if variant == "atomic":
        cur.execute("UPDATE counter SET v = v + 1 WHERE id = 1")
        return
    lock = " FOR UPDATE" if variant == "for_update" else ""
    cur.execute("SELECT v FROM counter WHERE id = 1" + lock)
    (v,) = cur.fetchone()
    cur.execute("UPDATE counter SET v = %s WHERE id = 1", (v + 1,))


def client(dsn, level, variant, m, start, out):
    retries = 0
    with psycopg.connect(dsn) as conn:
        conn.execute(f"SET default_transaction_isolation = '{LEVELS[level].lower()}'")
        conn.commit()
        cur = conn.cursor()
        start.wait()
        done = 0
        while done < m:
            try:
                one_txn(cur, variant)
                conn.commit()
                done += 1
            except errors.SerializationFailure:
                conn.rollback()
                retries += 1
    out.append(retries)


def mysql_client(level, variant, m, start, out):
    retries = 0
    conn = pymysql.connect(**MYSQL, autocommit=False)
    cur = conn.cursor()
    cur.execute(f"SET SESSION TRANSACTION ISOLATION LEVEL {LEVELS[level]}")
    start.wait()
    done = 0
    while done < m:
        try:
            one_txn(cur, variant)
            conn.commit()
            done += 1
        except pymysql.err.OperationalError as e:
            if e.args[0] not in (1213, 1205):
                raise
            conn.rollback()
            retries += 1
    conn.close()
    out.append(retries)


def run_mysql(level, variant, clients, m):
    conn = pymysql.connect(**MYSQL, autocommit=True)
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS counter")
        cur.execute("CREATE TABLE counter (id int PRIMARY KEY, v bigint NOT NULL) ENGINE=InnoDB")
        cur.execute("INSERT INTO counter VALUES (1, 0)")
    start = threading.Barrier(clients + 1)
    out = []
    ts = [threading.Thread(target=mysql_client, args=(level, variant, m, start, out)) for _ in range(clients)]
    for t in ts:
        t.start()
    start.wait()
    t0 = time.perf_counter()
    for t in ts:
        t.join()
    elapsed = time.perf_counter() - t0
    with conn.cursor() as cur:
        cur.execute("SELECT v FROM counter WHERE id = 1")
        (final,) = cur.fetchone()
    conn.close()
    committed = clients * m
    return {"level": level, "variant": variant, "clients": clients, "per_client": m,
            "committed": committed, "final": final, "lost": committed - final,
            "retries": sum(out), "seconds": round(elapsed, 3),
            "commits_per_s": round(committed / elapsed, 1)}


def run(dsn, level, variant, clients, m):
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS counter")
        conn.execute("CREATE TABLE counter (id int PRIMARY KEY, v bigint NOT NULL)")
        conn.execute("INSERT INTO counter VALUES (1, 0)")
        conn.execute("VACUUM ANALYZE counter")
    start = threading.Barrier(clients + 1)
    out = []
    ts = [threading.Thread(target=client, args=(dsn, level, variant, m, start, out)) for _ in range(clients)]
    for t in ts:
        t.start()
    start.wait()
    t0 = time.perf_counter()
    for t in ts:
        t.join()
    elapsed = time.perf_counter() - t0
    with psycopg.connect(dsn) as conn:
        (final,) = conn.execute("SELECT v FROM counter WHERE id = 1").fetchone()
    committed = clients * m
    return {"level": level, "variant": variant, "clients": clients, "per_client": m,
            "committed": committed, "final": final, "lost": committed - final,
            "retries": sum(out), "seconds": round(elapsed, 3),
            "commits_per_s": round(committed / elapsed, 1)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default="host=localhost port=5433 user=postgres dbname=postgres")
    ap.add_argument("--clients", type=int, default=8)
    ap.add_argument("--per-client", type=int, default=500)
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--out", default="lost_update.json")
    ap.add_argument("--mysql", action="store_true", help="run against the local MySQL server instead")
    ap.add_argument("--variants", default="rmw,atomic,for_update")
    a = ap.parse_args()
    rows = []
    for rep in range(a.reps):
        for variant in a.variants.split(","):
            for level in LEVELS:
                r = (run_mysql(level, variant, a.clients, a.per_client) if a.mysql
                     else run(a.dsn, level, variant, a.clients, a.per_client))
                r["rep"] = rep
                rows.append(r)
                print(json.dumps(r), flush=True)
    if a.mysql:
        c = pymysql.connect(**MYSQL)
        with c.cursor() as cur:
            cur.execute("SELECT version()")
            version = cur.fetchone()[0]
    else:
        with psycopg.connect(a.dsn) as conn:
            version = conn.execute("SHOW server_version").fetchone()[0]
    json.dump({"server_version": version, "runs": rows}, open(a.out, "w"), indent=1)
