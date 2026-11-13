"""Experiment D: which open snapshots stop VACUUM from removing dead versions?

Updates every row of a 10,000-row table 5 times (50,000 dead versions), then
runs VACUUM (VERBOSE) while one REPEATABLE READ transaction holds a snapshot
taken before the updates. The holder never touches the table. Conditions:
nobody holding, a holder in the same database, a holder in another database
of the same cluster, a READ COMMITTED holder idle between statements (it
keeps no snapshot), and the same READ COMMITTED holder after it has been
given a transaction id, as any transaction that has written has.

Run (a few seconds):  python3 horizon.py > horizon.json
"""
import json
import re
import sys

from common import connect, ensure_db


def vacuum_counts(conn):
    notices = []
    conn.add_notice_handler(lambda d: notices.append(d.message_primary))
    conn.execute("vacuum (verbose) churn")
    text = "\n".join(notices)
    m = re.search(r"tuples: (\d+) removed, (\d+) remain, (\d+) are dead but not yet removable", text)
    h = re.search(r"removable cutoff: (\d+)", text)
    return dict(removed=int(m[1]), remain=int(m[2]), dead_not_removable=int(m[3]), cutoff=int(h[1]) if h else None)


def trial(where, level, xid=False):
    ensure_db("mvcc")
    ensure_db("other")
    with connect() as c:
        c.execute("drop table if exists churn")
        c.execute("create table churn (id int primary key, v int)")
        c.execute("insert into churn select g, 0 from generate_series(1, 10000) g")
        c.execute("vacuum churn")
    holder = None
    seen = None
    if where:
        holder = connect(where, autocommit=False)
        holder.execute(f"begin isolation level {level}")
        holder.execute("select 1").fetchone()
        if xid:
            holder.execute("select txid_current()").fetchone()
        seen = holder.execute("select current_setting('transaction_isolation'), txid_current_if_assigned() is not null").fetchone()
    with connect() as c:
        for _ in range(5):
            c.execute("update churn set v = v + 1")
        res = vacuum_counts(c)
    if holder:
        holder.rollback()
        holder.close()
    return dict(holder_db=where, holder_level=level if where else None, holder_level_seen=seen and seen[0], holder_has_xid=seen and seen[1], **res)


def main():
    out = [
        trial(None, None),
        trial("mvcc", "repeatable read"),
        trial("other", "repeatable read"),
        trial("mvcc", "read committed"),
        trial("mvcc", "read committed", xid=True),
    ]
    for r in out:
        print(r, file=sys.stderr)
    json.dump(out, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
