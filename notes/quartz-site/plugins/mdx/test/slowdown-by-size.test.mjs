// Checks the slowdown-by-size chart: it reads the recorded experiment, plots
// every policy the note names, and renders without NaN at every load.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const model = await load("components/slowdown-by-size/model.ts");
const view = await load("components/slowdown-by-size/render.ts");

test("recorded data covers every policy, load and size bucket", () => {
  assert.deepEqual(model.LOADS, ["0.5", "0.7", "0.9"]);
  assert.equal(model.BUCKETS.length, 13);
  assert.equal(model.POLICIES.length, Object.keys(model.NAMES).length);
  for (const l of model.LOADS)
    for (const p of model.POLICIES) {
      const d = model.series(l, p);
      assert.equal(d.length, 13);
      for (const [m, lo, hi] of d) assert.ok(lo <= m * (1 + 1e-9) && m <= hi * (1 + 1e-9) && lo >= 0.99, `${l} ${p}`);
    }
});

test("processor sharing gives every size the slowdown 1/(1 - rho)", () => {
  for (const l of model.LOADS)
    for (const [m] of model.series(l, "ps")) assert.ok(Math.abs(m * (1 - Number(l)) - 1) < 0.1, `${l}: ${m}`);
});

test("SRPT beats PS for 99.9% of sizes at load 0.9", () => {
  const srpt = model.series("0.9", "srpt");
  const ps = model.series("0.9", "ps");
  srpt.forEach(([m], i) => assert.ok(m < ps[i][0], `bucket ${i}`));
});

test("renders every preset in the note at every load without NaN", () => {
  for (const policies of ["fifo,sjf,ps,srpt", "ps,fb,mlfq,mlfq16", "ps,mlfq,mlfq_boost1s", "ps,srpt,srpt_est1,srpt_bounce1"])
    for (const rho of [0.5, 0.7, 0.9]) {
      const html = view.render({ policies, rho, caption: "c" });
      assert.ok(!/NaN|undefined|Infinity/.test(html), `${policies} ${rho}`);
      assert.equal((html.match(/<polyline/g) ?? []).length, policies.split(",").length);
    }
  const s = view.stateFrom({ policies: "ps,bogus", rho: 0.3 });
  assert.deepEqual(s.policies, ["ps"]);
  assert.equal(s.load, "0.9");
});
