"""Prints the tables in the note from lost_update.json and write_skew.json."""
import json, statistics as st
from collections import defaultdict


def rng(xs, fmt="{:.0f}"):
    return f"{fmt.format(st.mean(xs))} ({fmt.format(min(xs))}–{fmt.format(max(xs))})"


for f in ["lost_update.json", "lost_update_mysql.json"]:
  lu = json.load(open(f))
  print(f, "server", lu["server_version"])
  g = defaultdict(list)
  for r in lu["runs"]:
    g[(r["variant"], r["level"])].append(r)
  for (v, l), rs in g.items():
    print(f"{v:11} {l:4} lost% {rng([100 * r['lost'] / r['committed'] for r in rs], '{:.1f}')}  "
          f"retries/commit {rng([r['retries'] / r['committed'] for r in rs], '{:.2f}')}  "
          f"commits/s {rng([r['commits_per_s'] for r in rs])}")

ws = json.load(open("write_skew.json"))
print("write_skew.json, server", ws["server_version"])
g = defaultdict(list)
for r in ws["runs"]:
    g[(r["variant"], r["think_ms"], r["level"])].append(r)
for (v, t, l), rs in g.items():
    print(f"{v:10} think {t:3.0f}ms {l:4} violations% {rng([100 * r['violations'] / r['trials'] for r in rs], '{:.1f}')}  "
          f"trials retried% {rng([100 * r['trials_with_retry'] / r['trials'] for r in rs], '{:.1f}')}  "
          f"retries/trial {rng([r['retries'] / r['trials'] for r in rs], '{:.2f}')}  unchanged {sum(r['unchanged'] for r in rs)}")
print(set(r["plan"].splitlines()[1].strip()[:40] for r in ws["runs"]))
