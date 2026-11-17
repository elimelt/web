"""Write skew under load on PostgreSQL: the on-call doctors check.

Each shift has two doctors, both on call; the invariant is that every shift
keeps at least one doctor on call. A trial takes one fresh shift and two
connections, started together on a barrier, each running

  BEGIN;
  SELECT count(*) FROM doctors WHERE shift = s AND on_call;   -- (or FOR UPDATE)
  -- optional think time, standing in for an application round trip
  UPDATE doctors SET on_call = false WHERE id = <me>;          -- only if count >= 2
  COMMIT;

and retrying from BEGIN on SQLSTATE 40001. P pairs run trials at once, on
shifts far apart in the index so that their reads land on different pages.
The table holds many more shifts than the trials use (50,000 by default), so
the planner reads through the index; a sequential scan would take a
relation-level SIREAD lock under SERIALIZABLE and make every pair conflict
with every other.
A trial violates the invariant when its shift ends with nobody on call.

  python3 write_skew.py --out write_skew.json
"""
import argparse, json, threading, time
import psycopg
from psycopg import errors

LEVELS = {"ru": "read uncommitted", "rc": "read committed",
          "rr": "repeatable read", "ser": "serializable"}


def leave(conn, cur, shift, me, variant, think):
    """Take doctor `me` off call if two are on call. Returns (left, retries)."""
    retries = 0
    while True:
        try:
            if variant == "for_update":
                cur.execute("SELECT id FROM doctors WHERE shift = %s AND on_call FOR UPDATE", (shift,))
                n = len(cur.fetchall())
            else:
                cur.execute("SELECT count(*) FROM doctors WHERE shift = %s AND on_call", (shift,))
                (n,) = cur.fetchone()
            if think:
                time.sleep(think)
            left = n >= 2
            if left:
                cur.execute("UPDATE doctors SET on_call = false WHERE id = %s", (me,))
            conn.commit()
            return left, retries
        except errors.SerializationFailure:
            conn.rollback()
            retries += 1


def pair_worker(dsn, level, variant, think, shifts, side, barrier, out):
    with psycopg.connect(dsn) as conn:
        conn.execute(f"SET default_transaction_isolation = '{LEVELS[level]}'")
        conn.commit()
        cur = conn.cursor()
        for s in shifts:
            barrier.wait()
            out.append((s, side) + leave(conn, cur, s, 2 * s + side, variant, think))


def run(dsn, level, variant, think, pairs, trials, table_shifts):
    n_shifts = pairs * trials
    stride = table_shifts // pairs
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS doctors")
        conn.execute("CREATE TABLE doctors (id int PRIMARY KEY, shift int NOT NULL, on_call bool NOT NULL)")
        conn.execute("INSERT INTO doctors SELECT g, g / 2, true FROM generate_series(0, %s) g", (2 * table_shifts - 1,))
        conn.execute("CREATE INDEX ON doctors (shift)")
        conn.execute("VACUUM ANALYZE doctors")
        plan = "\n".join(r[0] for r in conn.execute(
            "EXPLAIN SELECT count(*) FROM doctors WHERE shift = 7 AND on_call").fetchall())
    out = []
    ts = []
    for p in range(pairs):
        shifts = [p * stride + i for i in range(trials)]  # pair p starts its own block
        barrier = threading.Barrier(2)
        for side in (0, 1):
            ts.append(threading.Thread(target=pair_worker,
                      args=(dsn, level, variant, think, shifts, side, barrier, out)))
    t0 = time.perf_counter()
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    elapsed = time.perf_counter() - t0
    with psycopg.connect(dsn) as conn:
        oncall = dict(conn.execute(
            "SELECT shift, count(*) FILTER (WHERE on_call) FROM doctors GROUP BY shift").fetchall())
    used = [p * stride + i for p in range(pairs) for i in range(trials)]
    violations = sum(1 for s in used if oncall[s] == 0)
    unchanged = sum(1 for s in used if oncall[s] == 2)
    retries = sum(r for (_, _, _, r) in out)
    trials_with_retry = len({s for (s, _, _, r) in out if r})
    return {"level": level, "variant": variant, "think_ms": think * 1000, "pairs": pairs,
            "trials": n_shifts, "violations": violations, "unchanged": unchanged, "retries": retries,
            "trials_with_retry": trials_with_retry, "seconds": round(elapsed, 3), "plan": plan}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default="host=localhost port=5433 user=postgres dbname=postgres")
    ap.add_argument("--pairs", type=int, default=4)
    ap.add_argument("--trials", type=int, default=250, help="trials per pair")
    ap.add_argument("--table-shifts", type=int, default=50000,
                    help="shifts in the table, so the planner reads through the index")
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--out", default="write_skew.json")
    a = ap.parse_args()
    rows = []
    for rep in range(a.reps):
        for variant, think in [("plain", 0.0), ("plain", 0.002), ("for_update", 0.002)]:
            for level in LEVELS:
                r = run(a.dsn, level, variant, think, a.pairs, a.trials, a.table_shifts)
                r["rep"] = rep
                rows.append(r)
                print(json.dumps({k: v for k, v in r.items() if k != "plan"}), flush=True)
    with psycopg.connect(a.dsn) as conn:
        version = conn.execute("SHOW server_version").fetchone()[0]
    json.dump({"server_version": version, "runs": rows}, open(a.out, "w"), indent=1)
