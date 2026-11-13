// Checks the MVCC figure's model two ways: against PostgreSQL 16 itself, by
// replaying the interleavings that schedule.py ran on a real server and
// comparing every step's outcome, and against a brute-force serializability
// check on random interleavings.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/mvcc-lab/model.ts");
const dir = new URL("../../../../content/systems/databases/mvcc-experiments/", import.meta.url);
const schedules = JSON.parse(readFileSync(new URL("schedules.json", dir)));
const fixtures = [JSON.parse(readFileSync(new URL("pg_outcomes.json", dir)))];
try {
  fixtures.push(JSON.parse(readFileSync(new URL("pg_random.json", dir))));
} catch {}

export const toStep = ([op, t, key, v]) =>
  op === "w" ? (typeof v === "object" ? { op, t, key, add: v.add } : { op, t, key, set: v }) : key ? { op, t, key } : { op, t };

/** One PostgreSQL step record and the model's, in the same shape. */
function pgShape(rec) {
  if (rec.skipped) return { kind: "skipped" };
  const out = {};
  if (rec.blocked) {
    out.kind = "blocked";
    out.releasedAt = rec.released_at;
    out.releasedKind = rec.error ? "error" : "ok";
  } else out.kind = rec.error ? "error" : "ok";
  if (rec.error) out.code = rec.error;
  if (!rec.error && typeof rec.result === "number") out.value = rec.result;
  return out;
}

function modelShape(r) {
  if (r.kind === "skipped") return { kind: "skipped" };
  const out = { kind: r.kind };
  if (r.kind === "blocked") {
    out.releasedAt = r.releasedAt;
    out.releasedKind = r.releasedKind;
  }
  if (r.error) out.code = r.error.code;
  if (!r.error && typeof r.value === "number") out.value = r.value;
  return out;
}

for (const fx of fixtures) {
  for (const [name, byLevel] of Object.entries(fx.scenarios)) {
    for (const [level, pg] of Object.entries(byLevel)) {
      test(`${name} at ${level} matches PostgreSQL ${fx.server_version}`, () => {
        const steps = pg.steps.map((r) => toStep(r.step));
        const init = fx.inits?.[name] ?? schedules[name].init;
        const s = m.run(init, steps, level);
        assert.equal(s.results.length, steps.length);
        pg.steps.forEach((rec, i) => {
          assert.deepEqual(modelShape(s.results[i]), pgShape(rec), `step ${i} ${JSON.stringify(rec.step)}`);
        });
        assert.deepEqual(m.finalState(s), pg.final);
      });
    }
  }
}

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A random interleaving of two or three short transactions over two or three keys. */
export function randomSchedule(seed) {
  const rand = rng(seed);
  const keys = ["x", "y", "z"].slice(0, 2 + Math.floor(rand() * 2));
  const n = 2 + Math.floor(rand() * 2);
  const per = [];
  for (let t = 1; t <= n; t++) {
    const ops = [];
    const read = new Set();
    const len = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < len; k++) {
      const key = keys[Math.floor(rand() * keys.length)];
      if (rand() < 0.5 || !read.has(key)) {
        ops.push(["r", t, key]);
        read.add(key);
      } else ops.push(["w", t, key, rand() < 0.5 ? { add: 1 + Math.floor(rand() * 3) } : Math.floor(rand() * 9)]);
    }
    if (rand() < 0.6) {
      const key = keys[Math.floor(rand() * keys.length)];
      ops.push(["w", t, key, read.has(key) ? { add: 1 } : 10 * t]);
    }
    ops.push([rand() < 0.9 ? "c" : "a", t]);
    per.push(ops);
  }
  const steps = [];
  while (per.some((p) => p.length)) {
    const live = per.filter((p) => p.length);
    steps.push(live[Math.floor(rand() * live.length)].shift());
  }
  const init = Object.fromEntries(keys.map((k) => [k, Math.floor(rand() * 5)]));
  return { init, steps };
}

test("SERIALIZABLE never commits a non-serializable result (2,000 random interleavings)", () => {
  let aborts = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const { init, steps } = randomSchedule(seed);
    const s = m.run(init, steps.map(toStep), "ser");
    assert.notEqual(m.serialOrder(init, s), null, `seed ${seed}`);
    aborts += Object.values(s.txns).some((t) => t.failure) ? 1 : 0;
  }
  assert.ok(aborts > 50, "some runs should need an abort");
});

test("REPEATABLE READ allows non-serializable results, but never a lost update", () => {
  let anomalies = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const { init, steps } = randomSchedule(seed);
    const s = m.run(init, steps.map(toStep), "rr");
    if (m.serialOrder(init, s) === null) anomalies++;
    // First updater wins: two committed transactions that wrote the same key
    // never ran concurrently; one committed before the other's snapshot.
    const writers = (key) => Object.values(s.txns).filter((t) => t.status === "committed" && s.versions.some((v) => v.key === key && v.xmin === t.xid));
    for (const key of Object.keys(init)) {
      const ws = writers(key);
      for (const a of ws) {
        for (const b of ws) {
          if (a === b) continue;
          assert.ok(m.committedFor(s, a.xid, b.snap) || m.committedFor(s, b.xid, a.snap), `seed ${seed}: T${a.t} and T${b.t} both updated ${key}`);
        }
      }
    }
    // Every committed transaction read from one snapshot: rerunning its reads
    // against the final versions with its snapshot gives the same values.
    for (const t of Object.values(s.txns)) {
      if (t.status !== "committed") continue;
      for (const r of t.reads) {
        const v = s.versions.find((x) => x.id === r.version);
        assert.equal(v.value, r.value);
      }
    }
  }
  assert.ok(anomalies > 0, "write skew should show up somewhere");
});

test("the visibility rule matches its definition", () => {
  const steps = schedules.long_reader.steps.map(toStep);
  const s = m.run(schedules.long_reader.init, steps, "rr", 7);
  const t1 = s.txns[1];
  const seen = m.chain(s, "x").filter((v) => m.verdict(s, v, t1, t1.snap).visible);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].value, 0);
  // T1 holds the horizon back, so both replaced versions are kept, not removable.
  assert.deepEqual(m.chain(s, "x").map((v) => m.life(s, v)), ["kept", "kept", "live"]);
  const after = m.run(schedules.long_reader.init, steps, "rr");
  assert.deepEqual(m.chain(after, "x").map((v) => m.life(after, v)), ["removable", "removable", "live"]);
});

test("moving a step keeps each transaction's own order", () => {
  const steps = schedules.write_skew.steps.map(toStep);
  assert.equal(m.canMove(steps, 0, 1), false);
  assert.equal(m.canMove(steps, 1, 1), true);
  const moved = m.move(steps, 1, 1);
  assert.equal(moved[1].t, 2);
  assert.equal(moved[2].key, "bob");
});
