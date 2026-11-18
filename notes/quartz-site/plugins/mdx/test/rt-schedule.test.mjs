// Checks the real-time schedule figure's model against tick_sim.py, a
// separate Python simulator (fixtures written by
// content/systems/scheduling/1-single-resource/rt-experiments/tick_sim.py),
// and against the theorems the note states: EDF meets every deadline iff
// U <= 1 (Liu and Layland 1973, Theorem 7), and for synchronous release the
// rate-monotonic simulation meets every deadline in the hyperperiod iff
// response-time analysis says so.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(path.join(here, "rt-schedule.fixture.json"), "utf8"));
const model = await load("components/rt-schedule/model.ts");
const view = await load("components/rt-schedule/render.ts");

const tasksOf = (f) => f.tasks.map(([c, t]) => ({ c, t }));
const missList = (run) => run.misses.map((j) => [j.task, j.k, j.deadline, j.finish]);

test("schedules, misses and response-time iterates match tick_sim.py", () => {
  assert.ok(fixtures.length >= 200);
  for (const f of fixtures) {
    const ts = tasksOf(f);
    const tag = JSON.stringify(f.tasks);
    for (const pol of ["rm", "edf"]) {
      const run = model.simulate(ts, pol);
      assert.deepEqual(run.schedule, f[pol].schedule, `${pol} ${tag}`);
      assert.deepEqual(missList(run), f[pol].misses, `${pol} misses ${tag}`);
    }
    assert.deepEqual(model.rta(ts).map((r) => [r.iterates, r.ok]), f.rta, `rta ${tag}`);
  }
});

test("random task sets: EDF misses nothing iff U <= 1; RM misses nothing iff RTA passes", () => {
  let seed = 12345;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  let checked = 0;
  for (let k = 0; k < 3000; k++) {
    const n = 1 + rnd(3);
    const ts = Array.from({ length: n }, () => {
      const t = 2 + rnd(15);
      return { c: 1 + rnd(t), t };
    });
    if (model.hyperperiod(ts) > 600) continue;
    checked++;
    const u = model.utilization(ts);
    const edf = model.simulate(ts, "edf");
    assert.equal(edf.misses.length === 0, u <= 1 + 1e-12, `edf ${JSON.stringify(ts)}`);
    const rm = model.simulate(ts, "rm");
    const firstMissOk = rm.misses.filter((j) => j.deadline <= model.hyperperiod(ts)).length === 0;
    assert.equal(firstMissOk, model.rta(ts).every((r) => r.ok), `rm ${JSON.stringify(ts)}`);
    // The Liu-Layland and hyperbolic bounds are sufficient: whenever they pass, RTA passes.
    if (u <= model.llBound(n)) assert.ok(model.rta(ts).every((r) => r.ok));
    if (model.hyperbolicProduct(ts) <= 2) assert.ok(model.rta(ts).every((r) => r.ok));
  }
  assert.ok(checked > 1500);
});

test("the separating example: RM misses tau2 at t = 7, EDF misses nothing", () => {
  const ts = [{ c: 2, t: 5 }, { c: 4, t: 7 }];
  const rm = model.simulate(ts, "rm");
  assert.deepEqual(rm.misses.map((j) => [j.task, j.deadline, j.finish]), [[1, 7, 8]]);
  assert.equal(model.simulate(ts, "edf").misses.length, 0);
  assert.deepEqual(model.rta(ts)[1].iterates, [4, 6, 8]);
  assert.equal(model.llBound(2).toFixed(3), "0.828");
});

test("render: build-time markup has disabled sliders and the RTA line", () => {
  const html = view.render({ tasks: "2:5, 4:7" });
  assert.match(html, /name="c0"[^>]*disabled/);
  assert.match(html, /4 → 6 → 8 &gt; 7|4 → 6 → 8 > 7/);
  assert.match(html, /τ₂ misses its deadline at t = 7/);
  const two = view.render({ tasks: "2:4, 2:8, 4:16" });
  assert.match(two, /every deadline met over the hyperperiod of 16/);
});
