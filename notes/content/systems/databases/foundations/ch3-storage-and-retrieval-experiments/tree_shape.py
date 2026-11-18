#!/usr/bin/env python3
"""Print the page count, cell count and free bytes per level of the SQLite
B-tree in DB (a database written by bench), using the dbstat virtual table.
Usage: python3 -I tree_shape.py dbs/sqlite-1000000-s1/db.sqlite"""
import sqlite3, sys

c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
q = """SELECT length(path) - length(replace(path, '/', '')) AS level, pagetype,
              count(*), avg(ncell), avg(unused), sum(pgsize)
       FROM dbstat WHERE name = 'kv' GROUP BY level, pagetype ORDER BY level"""
print("level type      pages   cells/page  unused bytes/page  fill")
for level, kind, pages, cells, unused, size in c.execute(q):
    print(f"{level:5} {kind:8} {pages:7}  {cells:10.1f}  {unused:17.0f}  {1 - unused * pages / size:5.1%}")
