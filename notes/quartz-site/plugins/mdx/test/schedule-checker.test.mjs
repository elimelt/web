// Schedule checker: the conflict-graph test against brute force over serial
// orders, the phenomena against the Critique's own example histories, the
// strict 2PL simulation against MySQL 8.0's SERIALIZABLE recordings and
// against its own serializability, and the PostgreSQL model against the
// PostgreSQL 16 recordings of the same presets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/schedule-checker/model.ts");
const { presets } = await load("components/schedule-checker/presets.ts");
const { recorded } = await load("components/schedule-checker/mysql.ts");
const pg = await load("components/mvcc-lab/model.ts");
const { render } = await load("components/schedule-checker/render.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const recordings = JSON.parse(
  readFileSync(path.join(here, "../../../../content/systems/databases/isolation-experiments/anomalies.json"), "utf8"),
);

const toStep = ([op, t, key, x]) =>
  op === "add" ? { op: "w", t, key, add: x } : op === "w" ? { op: "w", t, key, set: x } : op === "r" ? { op, t, key } : { op, t };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random interleaving of 2 or 3 transactions over x and y, each ending in commit (or sometimes abort). */
function randomSchedule(rand) {
  const n = 2 + Math.floor(rand() * 2);
  const progs = [];
  for (let t = 1; t <= n; t++) {
    const ops = [];
    const len = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < len; i++) {
      const key = rand() < 0.5 ? "x" : "y";
      ops.push(rand() < 0.5 ? { op: "r", t, key } : rand() < 0.5 ? { op: "w", t, key, add: 1 + Math.floor(rand() * 9) } : { op: "w", t, key, set: Math.floor(rand() * 9) });
    }
    ops.push({ op: rand() < 0.85 ? "c" : "a", t });
    progs.push(ops);
  }
  const out = [];
  while (progs.some((p) => p.length)) {
    const live = progs.filter((p) => p.length);
    out.push(live[Math.floor(rand() * live.length)].shift());
  }
  return out;
}

/** Brute force: a serial order of the committed transactions that orders every conflicting pair as the schedule does. */
function conflictEquivalentOrder(steps) {
  const T = m.committed(steps);
  const pos = new Map();
  for (const order of m.permutations(T)) {
    order.forEach((t, i) => pos.set(t, i));
    let ok = true;
    for (let i = 0; i < steps.length && ok; i++)
      for (let j = i + 1; j < steps.length && ok; j++) {
        const a = steps[i], b = steps[j];
        if (!"rw".includes(a.op) || !"rw".includes(b.op) || a.op === "c" || b.op === "c") continue;
        if (a.op !== "r" && a.op !== "w") continue;
        if (b.op !== "r" && b.op !== "w") continue;
        if (a.t === b.t || a.key !== b.key || (a.op === "r" && b.op === "r")) continue;
        if (!pos.has(a.t) || !pos.has(b.t)) continue;
        if (pos.get(a.t) > pos.get(b.t)) ok = false;
      }
    if (ok) return order;
  }
  return null;
}

test("presets are the schedules replayed on the servers", () => {
  for (const [name, p] of Object.entries(presets)) {
    const run = recordings.runs[name].postgresql.rc;
    assert.deepEqual(p.steps, run.steps.map((s) => toStep(s.step)), name);
    assert.deepEqual(Object.keys(p.init).sort(), Object.keys(run.final).sort(), name);
  }
});

test("the conflict graph is acyclic exactly when a conflict-equivalent serial order exists", () => {
  const rand = rng(11);
  let cyclic = 0;
  for (let k = 0; k < 3000; k++) {
    const steps = randomSchedule(rand);
    const nodes = m.committed(steps);
    const edges = m.conflictGraph(steps);
    const cycle = m.findCycle(nodes, edges);
    const brute = conflictEquivalentOrder(steps);
    assert.equal(cycle === null, brute !== null, JSON.stringify(steps));
    if (cycle) {
      cyclic++;
      for (let i = 0; i + 1 < cycle.length; i++) assert.ok(edges.some((e) => e.from === cycle[i] && e.to === cycle[i + 1]));
    } else {
      const order = m.topoOrder(nodes, edges);
      const at = new Map(order.map((t, i) => [t, i]));
      for (const e of edges) assert.ok(at.get(e.from) < at.get(e.to));
    }
  }
  assert.ok(cyclic > 300, `only ${cyclic} cyclic schedules`);
});

test("phenomena match the Critique's example histories", () => {
  const on = (key) => new Set(m.phenomena(presets[key].steps).filter((p) => p.match).map((p) => p.id));
  assert.ok(on("H1_transfer_dirty_read").has("P1"));
  assert.ok(!on("H1_transfer_dirty_read").has("A1"));
  assert.ok(on("H2_transfer_fuzzy_read").has("P2"));
  assert.ok(!on("H2_transfer_fuzzy_read").has("A2"));
  assert.ok(on("P1_dirty_read").has("A1"));
  assert.ok(on("P2_fuzzy_read").has("A2"));
  assert.ok(on("P4_lost_update").has("P4"));
  assert.ok(on("A5A_read_skew").has("A5A"));
  assert.ok(on("A5B_write_skew").has("A5B"));
  assert.deepEqual([...on("P0_dirty_write")], ["P0"]);
  // A serial schedule exhibits nothing.
  const serial = [...presets.A5B_write_skew.steps.filter((s) => s.t === 1), ...presets.A5B_write_skew.steps.filter((s) => s.t === 2)];
  assert.equal(m.phenomena(serial).filter((p) => p.match).length, 0);
});

test("strict readings imply broad ones, and a P4 or A5 match implies P2", () => {
  const rand = rng(5);
  for (let k = 0; k < 3000; k++) {
    const steps = randomSchedule(rand);
    const on = new Set(m.phenomena(steps).filter((p) => p.match).map((p) => p.id));
    if (on.has("A1")) assert.ok(on.has("P1"));
    if (on.has("A2")) assert.ok(on.has("P2"));
    for (const id of ["P4", "A5A", "A5B"]) if (on.has(id)) assert.ok(on.has("P2"), `${id} without P2: ${JSON.stringify(steps)}`);
    // A schedule without P0, P1 or P2 is conflict serializable (the 2PL theorem's direction for these patterns).
    if (!on.has("P0") && !on.has("P1") && !on.has("P2")) {
      const committedOnly = steps;
      assert.equal(m.findCycle(m.committed(committedOnly), m.conflictGraph(committedOnly)), null, JSON.stringify(steps));
    }
  }
});

test("strict 2PL outcomes are serializable on random schedules", () => {
  const rand = rng(23);
  let deadlocks = 0, waits = 0;
  for (let k = 0; k < 3000; k++) {
    const steps = randomSchedule(rand);
    const init = { x: 10, y: 20 };
    const r = m.strict2pl(init, steps);
    const executed = r.executed.map((i) => steps[i]).filter((s) => r.committed.includes(s.t));
    assert.equal(m.findCycle(r.committed, m.conflictGraph(executed.concat(r.committed.map((t) => ({ op: "c", t }))))), null);
    const stuck = r.steps.some((s) => s.kind === "blocked");
    if (!stuck) assert.notEqual(m.serialOrder(init, steps, r), null, JSON.stringify(steps));
    deadlocks += r.victims.length;
    waits += r.steps.filter((s) => s.releasedAt !== undefined).length;
  }
  assert.ok(deadlocks > 50 && waits > 300, `deadlocks ${deadlocks}, waits ${waits}`);
});

test("strict 2PL reproduces MySQL SERIALIZABLE on every preset", () => {
  for (const [name, p] of Object.entries(presets)) {
    const sim = m.strict2pl(p.init, p.steps);
    const rec = recorded[name].ser;
    assert.deepEqual(sim.final, rec.final, name);
    assert.deepEqual(sim.committed, rec.committed, name);
    sim.steps.forEach((s, i) => {
      const kind = (x) => (x.kind === "error" ? "error" : x.kind);
      assert.equal(kind(s), kind(rec.steps[i]), `${name} step ${i}`);
      if (p.steps[i].op === "r" && s.kind === "ok") assert.equal(s.value, rec.steps[i].value, `${name} step ${i}`);
      assert.equal(s.releasedAt !== undefined, rec.steps[i].releasedAt !== undefined, `${name} step ${i} waited`);
    });
  }
});

test("the PostgreSQL model matches the PostgreSQL 16 recordings, and read uncommitted is read committed", () => {
  for (const [name, p] of Object.entries(presets)) {
    const rec = recordings.runs[name].postgresql;
    assert.deepEqual(rec.ru, rec.rc, name);
    for (const lv of ["rc", "rr", "ser"]) {
      const s = pg.run(p.init, p.steps, lv);
      assert.deepEqual(pg.finalState(s), rec[lv].final, `${name} ${lv}`);
      rec[lv].steps.forEach((r, i) => {
        const got = s.results[i];
        const failed = got.kind === "error" || got.releasedKind === "error";
        assert.equal(failed, r.status === "error", `${name} ${lv} step ${i}`);
        if (r.status === "error") assert.equal(r.error, got.error.code, `${name} ${lv} step ${i}`);
        if (p.steps[i].op === "r" && r.status === "ok") assert.equal(got.value, r.value, `${name} ${lv} step ${i}`);
        assert.equal(got.kind === "blocked", r.waited === true, `${name} ${lv} step ${i} waited`);
      });
    }
  }
});

test("renders every preset", () => {
  for (const key of Object.keys(presets)) {
    const html = render({ preset: key });
    assert.match(html, /<figure class="sc"/);
    assert.ok(!html.includes("undefined") && !html.includes("NaN"), key);
  }
});
