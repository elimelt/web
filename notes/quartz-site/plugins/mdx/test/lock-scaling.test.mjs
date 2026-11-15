// Checks the lock throughput charts against the raw benchmark output: the
// summary the charts draw from must match medians recomputed here from
// lock_bench-results.csv, and the charts must draw exactly the recorded
// points. The last test pins the comparisons the note's prose makes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/lock-scaling/model.ts");
const r = await load("components/lock-scaling/render.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(path.join(here, "../../../../content/systems/operating-systems/v2-concurrency/lock_bench-results.csv"), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"));
const head = csv[0].split(",");
const rows = csv.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

test("the summary matches medians recomputed from the raw runs", () => {
  for (const [lock, points] of Object.entries(m.DATA)) {
    for (const p of points) {
      const runs = rows.filter((x) => x.lock === lock && +x.threads === p.threads);
      assert.equal(runs.length, p.runs);
      assert.ok(p.runs >= 5);
      const ops = runs.map((x) => +x.ops_per_sec);
      assert.ok(Math.abs(median(ops) - p.median) <= 1, `${lock} ${p.threads}`);
      assert.equal(Math.min(...ops), p.min);
      assert.equal(Math.max(...ops), p.max);
      const share = median(runs.map((x) => +x.min_thread_ops / (+x.total_ops / p.threads)));
      assert.ok(Math.abs(share - p.share) < 1e-4, `${lock} ${p.threads} share`);
    }
  }
});

test("every real lock kept the counter exact; only the racy counter lost updates", () => {
  for (const x of rows) {
    if (x.lock === "racy") continue;
    assert.equal(x.final_counter, x.total_ops, `${x.lock} ${x.threads}`);
  }
  for (const x of rows.filter((x) => x.lock === "racy" && +x.threads > 1)) {
    assert.ok(+x.final_counter < +x.total_ops);
  }
});

test("each chart draws one point per lock and thread count, and whiskers only for throughput", () => {
  for (const [key, p] of Object.entries(m.PRESETS)) {
    const html = r.render({ preset: key });
    const pts = p.locks.length * p.threads.length;
    assert.equal((html.match(/<circle /g) || []).length, pts, key);
    assert.equal((html.match(/ls-whisker/g) || []).length, p.metric === "throughput" ? pts : 0, key);
    assert.equal(/ls-over/.test(html), p.threads.at(-1) > m.CORES, key);
    assert.equal((html.match(/<li>/g) || []).length, p.locks.length);
    // Points sit inside the plot area.
    for (const [, cx, cy] of html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)) {
      assert.ok(+cx >= r.M.left && +cx <= r.W - r.M.right);
      assert.ok(+cy >= r.M.top - 0.5 && +cy <= r.H - r.M.bottom + 0.5);
    }
  }
  assert.match(r.render({ preset: "nope" }), /data-preset="contention"/);
});

test("the comparisons the note states", () => {
  const med = (l, t) => m.point(l, t).median;
  // Every lock is several times slower with two threads than with one.
  for (const l of ["tas", "ttas", "ticket", "mcs", "mutex"]) assert.ok(med(l, 2) < med(l, 1) / 3, l);
  // The fair locks give every thread an equal share up to the core count; TAS does not.
  for (const t of [2, 3, 4]) {
    assert.ok(m.point("ticket", t).share > 0.98 && m.point("mcs", t).share > 0.98);
  }
  assert.ok(m.point("tas", 4).share < 0.8);
  // Past the cores, the FIFO spinlocks fall by more than 100x; the mutex does not fall.
  for (const l of ["ticket", "mcs"]) assert.ok(med(l, 6) < med(l, 4) / 100, l);
  assert.ok(med("mutex", 16) > med("mutex", 4) * 0.8);
  // The mutex beats every spinlock at 16 threads.
  for (const l of ["tas", "ttas", "ticket", "mcs"]) assert.ok(med("mutex", 16) > med(l, 16) * 4, l);
  // fetch_add beats the best lock at 4 threads by about 3x.
  assert.ok(med("atomic", 4) > 3 * Math.max(...["tas", "ttas", "ticket", "mcs", "mutex"].map((l) => med(l, 4))));
  // With 4 threads the racy counter lost most of its updates.
  assert.ok(m.point("racy", 4).lost > 0.7);
});
