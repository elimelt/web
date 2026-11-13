#!/bin/sh
# Experiment C: what each isolation level costs on pgbench's TPC-B-like
# workload. Every transaction updates one account, one teller and one branch
# row; with scale 10 there are only 10 branch rows, so concurrent
# transactions collide on them often. pgbench retries serialization failures
# (up to 10 tries) and reports how many transactions needed a retry and how
# many failed for good.
#
# The tables are rebuilt before every run so each one starts from the same
# state. The last condition is SERIALIZABLE with sequential scans turned off:
# pgbench_branches is small enough that the planner reads it with a
# sequential scan, which takes a predicate lock on the whole table.
#
# Run (about 8 minutes):  sh pgbench.sh > pgbench.txt
set -e
PGB=${PGBENCH:-/usr/lib/postgresql/16/bin/pgbench}
CONN="-h localhost -p 5433 -U postgres"
psql $CONN -d postgres -qc "drop database if exists bench" -c "create database bench"
# Each level is written with an escaped space, as PGOPTIONS requires.
for rep in 1 2 3; do
  for cond in "read\\ committed" "repeatable\\ read" "serializable" "serializable -c enable_seqscan=off"; do
    $PGB $CONN -i -q -s 10 bench >/dev/null 2>&1
    echo "### level=$cond rep=$rep"
    PGOPTIONS="-c default_transaction_isolation=$cond" \
      $PGB $CONN -c 8 -j 4 -T 30 --max-tries=10 bench 2>/dev/null \
      | grep -E "tps|latency average|number of (transactions actually|failed|transactions retried)|total number of retries"
  done
done
