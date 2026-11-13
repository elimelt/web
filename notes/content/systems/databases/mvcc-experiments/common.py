"""Shared helpers for the MVCC experiments: connection settings and stats."""
import os
import statistics

import psycopg

DSN = os.environ.get("MVCC_DSN", "host=localhost port=5433 user=postgres")


def connect(dbname="mvcc", autocommit=True):
    return psycopg.connect(f"{DSN} dbname={dbname}", autocommit=autocommit)


def ensure_db(name="mvcc"):
    with connect("postgres") as c:
        if not c.execute("select 1 from pg_database where datname=%s", (name,)).fetchone():
            c.execute(f'create database "{name}"')


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def median(xs):
    return statistics.median(xs) if xs else float("nan")
