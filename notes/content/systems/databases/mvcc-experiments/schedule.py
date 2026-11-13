"""Replay a fixed interleaving of transactions against PostgreSQL, step by step.

Each transaction gets its own connection and a worker thread. The schedule is
a list of steps such as ["r", 1, "x"] (T1 reads x), ["w", 2, "x", {"add": 1}]
(T2 writes x = the value it last saw + 1, computed in the client, as an
application's read-modify-write would), ["w", 1, "x", 5], ["c", 1] (commit)
or ["a", 1] (rollback). A transaction begins at its first step, at the
isolation level given for the run. If a step is still running after BLOCK
seconds it is recorded as blocked and the replay moves on; when it finishes
later the record says at which step it was released and how it ended. A
step for a transaction that is still blocked queues behind the waiting one.

The rows live in kv(k text primary key, v int) with fillfactor 50, so every
update can be a heap-only (HOT) update and the index is never touched, and
sessions run with enable_seqscan off so reads are single-row index lookups.
Both keep PostgreSQL's SIREAD locks at row granularity, which is what the
note's figure models.

Run:  python3 schedule.py schedules.json > pg_outcomes.json      (about a minute)
      python3 schedule.py random_schedules.json > pg_random.json (about 15 minutes)

random_schedules.json holds 80 random interleavings made by randomSchedule()
in the figure's test (plugins/mdx/test/mvcc-lab.test.mjs, seeds 1 to 80). The
test replays both files through the figure's model and requires every step
to match what PostgreSQL did.
"""
import json
import queue
import sys
import threading
import time

import psycopg
from psycopg import errors

from common import connect, ensure_db

# A database of its own: the open transactions in these replays would
# otherwise hold back cleanup for the other experiments (see horizon.py).
DB = "sched"

BLOCK = 0.5
LEVELS = {"rc": "read committed", "rr": "repeatable read", "ser": "serializable"}


class Txn:
    def __init__(self, name, level):
        self.name = name
        self.level = level
        self.conn = connect(DB, autocommit=True)
        self.conn.execute("set enable_seqscan = off")
        self.conn.execute("set deadlock_timeout = '200ms'")
        self.began = False
        self.dead = False
        self.last = {}
        self.q = queue.Queue()
        self.th = threading.Thread(target=self.loop, daemon=True)
        self.th.start()

    def loop(self):
        while True:
            item = self.q.get()
            if item is None:
                return
            step, box, done = item
            if self.dead:
                # An earlier queued statement failed and rolled back.
                box["skipped"] = True
                done.set()
                continue
            try:
                box["result"] = self.do(step)
            except psycopg.Error as e:
                box["error"] = e.sqlstate
                box["message"] = (e.diag.message_primary or str(e)).strip()
                self.dead = True
                try:
                    self.conn.execute("rollback")
                except psycopg.Error:
                    pass
            done.set()

    def do(self, step):
        op = step[0]
        if not self.began and op in ("r", "w"):
            self.conn.execute(f"begin isolation level {LEVELS[self.level]}")
            self.began = True
        if op == "r":
            row = self.conn.execute("select v from kv where k = %s", (step[2],)).fetchone()
            self.last[step[2]] = row[0]
            return row[0]
        if op == "w":
            val = step[3]
            if isinstance(val, dict):
                val = self.last[step[2]] + val["add"]
            self.conn.execute("update kv set v = %s where k = %s", (val, step[2]))
            self.last[step[2]] = val
            return val
        if op == "c":
            self.conn.execute("commit")
            return "committed"
        if op == "a":
            self.conn.execute("rollback")
            return "aborted"
        raise ValueError(op)

    def submit(self, step):
        box, done = {}, threading.Event()
        self.q.put((step, box, done))
        return box, done


def replay(init, steps, level):
    ensure_db(DB)
    with connect(DB) as c:
        c.execute("drop table if exists kv")
        c.execute("create table kv (k text primary key, v int not null) with (fillfactor = 50)")
        for k, v in init.items():
            c.execute("insert into kv values (%s, %s)", (k, v))
        c.execute("vacuum analyze kv")
    txns = {}
    out = []
    pending = {}  # txn -> [(index, box, done)], the blocked step and those queued behind it

    def settle(now):
        for t, items in list(pending.items()):
            while items and items[0][2].is_set():
                i, box, done = items.pop(0)
                out[i]["released_at"] = now
                out[i].update({k: box[k] for k in box})
            if not items:
                del pending[t]

    for i, step in enumerate(steps):
        t = step[1]
        if t not in txns:
            txns[t] = Txn(t, level)
        tx = txns[t]
        rec = {"step": step}
        out.append(rec)
        if tx.dead and t not in pending:
            rec["skipped"] = True
            continue
        box, done = tx.submit(step)
        if t in pending:
            # The client is still waiting for an earlier statement, so this
            # one queues behind it, as it would in a real client.
            rec["blocked"] = True
            pending[t].append((i, box, done))
        elif done.wait(BLOCK):
            rec.update(box)
        else:
            rec["blocked"] = True
            pending[t] = [(i, box, done)]
        time.sleep(0.05)
        settle(i)
    deadline = time.time() + 10
    while pending and time.time() < deadline:
        time.sleep(0.05)
        settle(len(steps))
    with connect(DB) as c:
        final = dict(c.execute("select k, v from kv order by k").fetchall())
    for tx in txns.values():
        tx.q.put(None)
        try:
            tx.conn.close()
        except Exception:
            pass
    return dict(level=level, steps=out, final=final)


def main():
    scen = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "schedules.json"))
    with connect("postgres") as c:
        version = c.execute("show server_version").fetchone()[0]
    res = {"server_version": version, "inits": {n: s["init"] for n, s in scen.items()}, "scenarios": {}}
    for name, s in scen.items():
        res["scenarios"][name] = {lvl: replay(s["init"], s["steps"], lvl) for lvl in ("rc", "rr", "ser")}
        print(name, {lvl: (r["final"], [st.get("error") for st in r["steps"]]) for lvl, r in res["scenarios"][name].items()}, file=sys.stderr)
    json.dump(res, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
