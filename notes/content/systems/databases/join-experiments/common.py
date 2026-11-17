"""Connection settings shared by the join experiments."""
import os

import psycopg

DSN = os.environ.get("JOIN_DSN", "host=localhost port=5434 user=postgres")
DB = os.environ.get("JOIN_DB", "joins")

# Orders per scale; each scale has orders/10 customers, so 10 orders per customer.
SCALES = [100_000, 1_000_000, 10_000_000]


def connect(dbname=DB, autocommit=True):
    return psycopg.connect(f"{DSN} dbname={dbname}", autocommit=autocommit)


def ensure_db():
    with connect("postgres") as c:
        if not c.execute("select 1 from pg_database where datname=%s", (DB,)).fetchone():
            c.execute(f'create database "{DB}"')
