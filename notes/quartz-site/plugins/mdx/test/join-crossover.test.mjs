// Checks the join crossover charts against the raw experiment output: the
// summary the charts draw from must match medians recomputed here from
// results.json and planner_costs.json, the fastest method and the planner's
// pick must match a brute-force pass over the raw runs, and the crossovers the
// figure computes must agree with the ones summarize.py computes in Python.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/join-crossover/model.ts");
const r = await load("components/join-crossover/render.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/systems/databases/join-experiments");
const raw = JSON.parse(readFileSync(path.join(dir, "results.json"), "utf8")).cases;
const costs = JSON.parse(readFileSync(path.join(dir, "planner_costs.json"), "utf8")).rows;
const python = JSON.parse(readFileSync(path.join(dir, "join-summary-crossovers.json"), "utf8"));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const NAME = { "Nested Loop": "nestloop", "Hash Join": "hash", "Merge Join": "merge" };

test("the summary matches medians recomputed from the raw runs", () => {
  let n = 0;
  for (const c of raw) {
    const p = m.timed(String(c.scale), c.layout, c.method, c.k);
    assert.ok(p, `${c.scale} ${c.layout} ${c.method} ${c.k}`);
    assert.ok(Math.abs(median(c.times_ms) - p.median) < 0.001);
    assert.ok(Math.abs(Math.min(...c.times_ms) - p.min) < 0.001);
    assert.ok(Math.abs(Math.max(...c.times_ms) - p.max) < 0.001);
    assert.equal(c.times_ms.length, p.runs);
    n++;
  }
  assert.ok(n > 200);
});

test("fastest and the default planner pick match a brute-force pass over the raw runs", () => {
  const groups = new Map();
  for (const c of raw) {
    const key = `${c.scale}/${c.layout}/${c.k}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const [key, cs] of groups) {
    const [scale, layout, k] = key.split("/");
    const forced = cs.filter((c) => c.method !== "planner");
    const best = forced.reduce((a, b) => (median(b.times_ms) < median(a.times_ms) ? b : a));
    assert.equal(m.fastest(scale, layout, +k).method, best.method, key);
    const planner = cs.find((c) => c.method === "planner");
    assert.equal(m.pick("4", scale, layout, +k).method, NAME[planner.join], key);
  }
});

test("estimated costs and the rpc 1.1 picks match planner_costs.json", () => {
  for (const row of costs.filter((c) => c.rpc === 4 || c.rpc === 1.1)) {
    const rpc = row.rpc === 4 ? "4" : "1.1";
    const e = m.estimate(rpc, String(row.scale), row.layout, row.k);
    for (const meth of m.METHODS) assert.ok(Math.abs(e[meth] - row[meth]) <= 0.05 + 1e-9);
    if (rpc === "1.1") {
      const p = m.pick(rpc, String(row.scale), row.layout, row.k);
      assert.equal(p.method, NAME[row.choice]);
      assert.ok(Math.abs(p.ms - median(row.choice_times_ms)) < 0.001);
    }
  }
});

test("crossovers agree with the independent Python computation", () => {
  for (const [key, want] of Object.entries(python)) {
    const parts = key.split("/");
    let got;
    if (parts[0] === "io") {
      got = m.ioModel(parts[1], parts[2]).crossover;
    } else if (parts[0] === "time") {
      const [, scale, layout] = parts;
      got = m.crossover(m.ks(scale, layout), m.timeOf(scale, layout), "nestloop", "hash");
    } else {
      const [, rpc, scale, layout] = parts;
      if (rpc !== "4" && rpc !== "1.1") continue;
      got = m.crossover(m.ks(scale, layout), m.costOf(rpc, scale, layout), "nestloop", "hash");
    }
    if (want === null) assert.equal(got, undefined, key);
    else assert.ok(Math.abs(got / want - 1) < 1e-6, `${key}: ${got} vs ${want}`);
  }
});

test("crossover interpolates on log k between the bracketing points", () => {
  const pts = [1, 10, 100];
  const vals = { nestloop: { 1: 1, 10: 10, 100: 100 }, hash: { 1: 10, 10: 10, 100: 10 } };
  const v = (meth, k) => vals[meth]?.[k];
  // equal at k=10, so hash becomes cheaper just after 10; interpolation lands at 10
  assert.ok(Math.abs(m.crossover(pts, v, "nestloop", "hash") - 10) < 1e-9);
  const v2 = (meth, k) => ({ nestloop: { 1: 1, 10: 100, 100: 1e4 }, hash: { 1: 10, 10: 10, 100: 10 } })[meth][k];
  // log ratio goes from -1 at k=1 to +1 at k=10: crosses at sqrt(10)
  assert.ok(Math.abs(m.crossover(pts, v2, "nestloop", "hash") - Math.sqrt(10)) < 1e-9);
  assert.equal(m.crossover(pts, (meth) => (meth === "hash" ? 0.5 : 1), "nestloop", "hash"), undefined);
});

test("every preset renders at every table and layout with one strip cell per k", () => {
  for (const key of Object.keys(m.PRESETS)) {
    const html = r.render({ preset: key });
    assert.ok(!/NaN|undefined/.test(html), key);
    for (const scale of m.SCALES)
      for (const layout of m.LAYOUTS)
        for (const rpc of m.RPCS) {
          const v = { ...r.viewOf(key), scale, layout, rpc };
          const svg = r.chart(v, m.ks(scale, layout)[0]);
          assert.ok(!/NaN|undefined/.test(svg), `${key} ${scale} ${layout} ${rpc}`);
          assert.equal((svg.match(/class="jx-cell/g) || []).length, 2 * m.ks(scale, layout).length);
          for (const k of m.ks(scale, layout)) assert.ok(!/NaN|undefined/.test(r.readout(v, k)));
        }
  }
});
