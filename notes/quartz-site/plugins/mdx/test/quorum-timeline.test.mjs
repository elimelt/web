// Checks the quorum timeline's model against two independent references: a
// brute-force search over every possible quorum, and the etcd measurements in
// managing-critical-state-experiments/figure-data.json, which the model was
// calibrated on only at 0 ms of added delay.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/quorum-timeline/model.ts");
const r = await load("components/quorum-timeline/render.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  readFileSync(
    path.join(here, "../../../../content/systems/distributed-systems/managing-critical-state-experiments/figure-data.json"),
    "utf8",
  ),
);

test("embedded data matches the experiment's figure-data.json", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(m.CAL)), data.calibration);
  for (const [k, v] of Object.entries(data.points)) assert.deepEqual(m.measuredByKey(k), v, k);
});

test("commit time equals the best quorum found by brute force", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 3000; trial++) {
    const followers = 1 + Math.floor(rand() * 6);
    const s = {
      rtts: Array.from({ length: followers }, () => Math.round(rand() * 400) / 10),
      down: Array.from({ length: followers }, () => rand() < 0.25),
      op: rand() < 0.5 ? "put" : "get-linearizable",
      via: 0,
    };
    const o = m.simulate(s);
    const b = m.bruteDecided(s);
    if (b === null) assert.equal(o.decided, null);
    else assert.ok(Math.abs(o.decided - b) < 1e-9, `${JSON.stringify(s)}: ${o.decided} vs ${b}`);
  }
});

test("latency does not depend on followers beyond the quorum and never decreases when one fails", () => {
  const base = { rtts: [1, 3, 10, 30], down: [false, false, false, false], op: "put", via: 0 };
  const t = (s) => m.simulate(s).done;
  assert.equal(t({ ...base, rtts: [1, 3, 10, 300] }), t(base));
  assert.equal(t({ ...base, rtts: [1, 3, 50, 300] }), t(base));
  for (let i = 0; i < 4; i++) {
    const down = [...base.down];
    down[i] = true;
    assert.ok(t({ ...base, down }) >= t(base));
  }
  assert.equal(m.simulate({ ...base, down: [true, true, true, false] }).done, null);
});

test("the model predicts every etcd measurement within 1 ms or 12%", () => {
  const rows = [];
  for (const [k, v] of Object.entries(data.points)) {
    const [rt, downs, op, via] = k.split("|");
    const rtts = rt.split(",").map(Number);
    const killed = downs ? downs.split(",").map(Number) : [];
    const s = { rtts, down: rtts.map((_, i) => killed.includes(i + 1)), op, via: Number(via) };
    const pred = m.simulate(s).done;
    const err = pred - v.p50;
    rows.push([k, pred.toFixed(2), v.p50.toFixed(2), err.toFixed(2)]);
    assert.ok(Math.abs(err) <= Math.max(1, 0.12 * v.p50), `${k}: model ${pred} vs measured ${v.p50}`);
  }
  assert.ok(rows.length >= 30);
});

test("every preset renders, with a measurement for its starting setting", () => {
  for (const key of Object.keys(m.PRESETS)) {
    const html = r.render({ preset: key });
    assert.match(html, /<svg/);
    assert.match(html, /etcd 3\.6, same setting/);
    assert.doesNotMatch(html, /NaN|undefined/);
  }
  assert.match(r.render({ preset: "nope" }), /data-preset="five"/);
});

test("every control state of each preset renders without errors", () => {
  const five = m.PRESETS.five.setting;
  for (let mask = 0; mask < 16; mask++) {
    const s = { ...five, down: five.down.map((_, i) => Boolean(mask & (1 << i))) };
    const out = r.chart(s) + r.readout(s) + r.legend(s);
    assert.doesNotMatch(out, /NaN|undefined|Infinity/);
  }
  for (const rtt of m.RTT_CHOICES)
    for (const op of m.OPS) {
      const s = { rtts: [rtt, rtt], down: [false, false], op, via: 0 };
      assert.match(r.readout(s), /etcd 3\.6, same setting/, `${rtt} ${op}`);
      assert.doesNotMatch(r.chart(s), /NaN|undefined|Infinity/);
    }
  for (let via = 0; via < 3; via++) {
    const s = { ...m.PRESETS.via.setting, via };
    assert.match(r.readout(s), /etcd 3\.6, same setting/);
  }
});

test("axis ends are round and cover the data", () => {
  for (const t of [0.3, 1.2, 4.9, 11.6, 33, 52, 140]) {
    const { end, step } = r.axis(t);
    assert.ok(end >= t && end / step <= 6 && Number.isInteger(Math.round((end / step) * 1e6) / 1e6));
  }
});
