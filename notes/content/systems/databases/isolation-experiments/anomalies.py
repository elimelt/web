"""Replay the Critique's anomaly schedules on PostgreSQL and MySQL (InnoDB).

Each schedule is a list of steps in the Critique's notation. Every transaction
gets its own connection and worker thread; the driver issues the steps in
order, waits up to WAIT seconds for each, and if it has not finished records
it as blocked and moves on. Later steps of a blocked transaction queue behind
it, as they would in an application that issues statements in order. After
the last step the driver waits for every queue to drain (lock waits time out
after 5 s) and records what each step returned, which steps waited, which
failed with which error, and the final rows.

  python3 anomalies.py --out anomalies.json
"""
import argparse, json, queue, threading, time
import psycopg
import pymysql

WAIT = 0.4
LEVELS = {"ru": "READ UNCOMMITTED", "rc": "READ COMMITTED",
          "rr": "REPEATABLE READ", "ser": "SERIALIZABLE"}

# Step forms: ("r", t, key) | ("count", t, grp) | ("w", t, key, value) |
# ("add", t, key, delta)  (writes last value t read for key + delta) |
# ("ins", t, key, grp, value) | ("c", t) | ("a", t)
SCHEDULES = {
    "P0_dirty_write": {
        "rows": [("x", 0, 0)],
        "steps": [("w", 1, "x", 1), ("w", 2, "x", 2), ("a", 1), ("c", 2)],
        "note": "w1[x] w2[x] a1 c2",
    },
    "P1_dirty_read": {
        "rows": [("x", 0, 50), ("y", 0, 50)],
        "steps": [("w", 1, "x", 10), ("r", 2, "x"), ("a", 1), ("c", 2)],
        "note": "w1[x] r2[x] a1 c2; T2 reads 10 if the read is dirty",
    },
    "P2_fuzzy_read": {
        "rows": [("x", 0, 50)],
        "steps": [("r", 1, "x"), ("w", 2, "x", 5), ("c", 2), ("r", 1, "x"), ("c", 1)],
        "note": "r1[x] w2[x] c2 r1[x] c1; fuzzy if T1's two reads differ",
    },
    "P3_phantom": {
        "rows": [("x", 1, 10), ("y", 1, 10), ("z", 2, 10)],
        "steps": [("count", 1, 1), ("ins", 2, "n", 1, 10), ("c", 2), ("count", 1, 1), ("c", 1)],
        "note": "r1[P] w2[insert y in P] c2 r1[P] c1; phantom if the two counts differ",
    },
    "P4_lost_update": {
        "rows": [("x", 0, 100)],
        "steps": [("r", 1, "x"), ("r", 2, "x"), ("add", 2, "x", 20), ("c", 2),
                  ("add", 1, "x", 10), ("c", 1)],
        "note": "r1[x] r2[x] w2[x] c2 w1[x] c1; lost if x ends at 110",
    },
    "A5A_read_skew": {
        "rows": [("x", 0, 50), ("y", 0, 50)],
        "steps": [("r", 1, "x"), ("w", 2, "x", 40), ("w", 2, "y", 60), ("c", 2),
                  ("r", 1, "y"), ("c", 1)],
        "note": "r1[x] w2[x] w2[y] c2 r1[y] c1; skew if T1 sees x + y = 110",
    },
    "A5B_write_skew": {
        "rows": [("x", 0, 1), ("y", 0, 1)],
        "steps": [("r", 1, "x"), ("r", 1, "y"), ("r", 2, "x"), ("r", 2, "y"),
                  ("w", 1, "x", 0), ("w", 2, "y", 0), ("c", 1), ("c", 2)],
        "note": "r1[x,y] r2[x,y] w1[x] w2[y] c1 c2; skew if both commit and x + y = 0",
    },
    "H1_transfer_dirty_read": {
        "rows": [("x", 0, 50), ("y", 0, 50)],
        "steps": [("r", 1, "x"), ("add", 1, "x", -40), ("r", 2, "x"), ("r", 2, "y"), ("c", 2),
                  ("r", 1, "y"), ("add", 1, "y", 40), ("c", 1)],
        "note": "Critique H1: T1 moves 40 from x to y; T2 reads x + y = 60 mid-transfer (P1 but not A1)",
    },
    "H2_transfer_fuzzy_read": {
        "rows": [("x", 0, 50), ("y", 0, 50)],
        "steps": [("r", 1, "x"), ("r", 2, "x"), ("add", 2, "x", -40), ("r", 2, "y"), ("add", 2, "y", 40),
                  ("c", 2), ("r", 1, "y"), ("c", 1)],
        "note": "Critique H2: T2 moves 40 from x to y; T1 reads x = 50 before and y = 90 after (P2 but not A2)",
    },
}


class PG:
    name = "postgresql"
    def __init__(self, dsn): self.dsn = dsn
    def connect(self):
        c = psycopg.connect(self.dsn)
        c.execute("SET lock_timeout = '5s'"); c.commit()
        return c
    def setup(self, rows):
        with psycopg.connect(self.dsn, autocommit=True) as c:
            c.execute("DROP TABLE IF EXISTS t")
            c.execute("CREATE TABLE t (k text PRIMARY KEY, grp int NOT NULL, v int NOT NULL)")
            c.execute("CREATE INDEX ON t (grp)")
            for k, g, v in rows:
                c.execute("INSERT INTO t VALUES (%s, %s, %s)", (k, g, v))
    def begin(self, c, level):
        c.execute(f"BEGIN ISOLATION LEVEL {LEVELS[level]}")
    def error(self, e):
        return getattr(e, "sqlstate", None) or type(e).__name__
    def version(self):
        with psycopg.connect(self.dsn) as c:
            return c.execute("SHOW server_version").fetchone()[0]
    ph = "%s"


class MySQL:
    name = "mysql"
    def connect(self):
        c = pymysql.connect(unix_socket="/var/run/mysqld/mysqld.sock", user="root", database="exp",
                            autocommit=True)
        with c.cursor() as cur:
            cur.execute("SET SESSION innodb_lock_wait_timeout = 5")
        return c
    def setup(self, rows):
        c = self.connect()
        with c.cursor() as cur:
            cur.execute("DROP TABLE IF EXISTS t")
            cur.execute("CREATE TABLE t (k varchar(8) PRIMARY KEY, grp int NOT NULL, v int NOT NULL, KEY (grp)) ENGINE=InnoDB")
            for k, g, v in rows:
                cur.execute("INSERT INTO t VALUES (%s, %s, %s)", (k, g, v))
        c.close()
    def begin(self, c, level):
        with c.cursor() as cur:
            cur.execute(f"SET TRANSACTION ISOLATION LEVEL {LEVELS[level]}")
            cur.execute("START TRANSACTION")
    def error(self, e):
        return str(e.args[0]) if e.args else type(e).__name__
    def version(self):
        c = self.connect()
        with c.cursor() as cur:
            cur.execute("SELECT version()"); v = cur.fetchone()[0]
        c.close(); return v
    ph = "%s"


def execute(db, conn, step, last):
    op = step[0]
    cur = conn.cursor()
    if op == "r":
        cur.execute("SELECT v FROM t WHERE k = %s", (step[2],))
        v = cur.fetchone()[0]; last[step[2]] = v; return v
    if op == "count":
        cur.execute("SELECT count(*) FROM t WHERE grp = %s", (step[2],))
        return cur.fetchone()[0]
    if op == "w":
        cur.execute("UPDATE t SET v = %s WHERE k = %s", (step[3], step[2])); return None
    if op == "add":
        v = last[step[2]] + step[3]
        cur.execute("UPDATE t SET v = %s WHERE k = %s", (v, step[2])); return v
    if op == "ins":
        cur.execute("INSERT INTO t VALUES (%s, %s, %s)", (step[2], step[3], step[4])); return None
    if op == "c":
        conn.commit(); return None
    if op == "a":
        conn.rollback(); return None


def worker(db, level, inbox, results):
    conn = db.connect()
    db.begin(conn, level)
    last, dead = {}, False
    while True:
        item = inbox.get()
        if item is None:
            break
        i, step = item
        if dead:
            results[i] = {"status": "skipped"}; continue
        t0 = time.perf_counter()
        try:
            v = execute(db, conn, step, last)
            results[i] = {"status": "ok", "value": v, "done_at": time.perf_counter()}
        except Exception as e:
            results[i] = {"status": "error", "error": db.error(e), "message": str(e).splitlines()[0][:160],
                          "done_at": time.perf_counter()}
            dead = True
            try: conn.rollback()
            except Exception: pass
    try: conn.rollback()
    except Exception: pass
    conn.close()


def replay(db, level, sched):
    db.setup(sched["rows"])
    steps = sched["steps"]
    txns = sorted({s[1] for s in steps})
    inboxes = {t: queue.Queue() for t in txns}
    results = [None] * len(steps)
    threads = {t: threading.Thread(target=worker, args=(db, level, inboxes[t], results)) for t in txns}
    for th in threads.values(): th.start()
    time.sleep(0.2)  # connections open and BEGIN issued
    issued_at = []
    for i, step in enumerate(steps):
        issued_at.append(time.perf_counter())
        inboxes[step[1]].put((i, step))
        deadline = time.perf_counter() + WAIT
        while results[i] is None and time.perf_counter() < deadline:
            time.sleep(0.005)
    for t in txns: inboxes[t].put(None)
    for th in threads.values(): th.join(timeout=30)
    out = []
    for i, (step, res) in enumerate(zip(steps, results)):
        r = dict(res or {"status": "lost"})
        if "done_at" in r:
            waited = r.pop("done_at") - issued_at[i]
            r["waited"] = waited > WAIT
            # which later step had been issued when it finished
            r["released_after_step"] = max(j for j in range(len(steps)) if issued_at[j] <= issued_at[i] + waited) if r["waited"] else None
        out.append({"step": list(step), **r})
    db_rows = {}
    if isinstance(db, PG):
        with psycopg.connect(db.dsn) as c:
            db_rows = dict(c.execute("SELECT k, v FROM t ORDER BY k").fetchall())
    else:
        c = db.connect()
        with c.cursor() as cur:
            cur.execute("SELECT k, v FROM t ORDER BY k"); db_rows = dict(cur.fetchall())
        c.close()
    return {"steps": out, "final": db_rows}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default="host=localhost port=5433 user=postgres dbname=postgres")
    ap.add_argument("--out", default="anomalies.json")
    ap.add_argument("--only", default=None)
    a = ap.parse_args()
    dbs = [PG(a.dsn), MySQL()]
    res = {"versions": {d.name: d.version() for d in dbs}, "wait_s": WAIT,
           "schedules": {k: v["note"] for k, v in SCHEDULES.items()}, "runs": {}}
    for name, sched in SCHEDULES.items():
        if a.only and a.only != name: continue
        for d in dbs:
            for level in LEVELS:
                r = replay(d, level, sched)
                res["runs"].setdefault(name, {}).setdefault(d.name, {})[level] = r
                brief = " | ".join(
                    f"{s['step'][0]}{s['step'][1]}:" + (str(s.get('value')) if s['status'] == 'ok' else s['status'] + ':' + s.get('error', ''))
                    + ("(waited)" if s.get("waited") else "") for s in r["steps"])
                print(f"{name:16} {d.name:10} {level:3} {brief} final={r['final']}", flush=True)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
