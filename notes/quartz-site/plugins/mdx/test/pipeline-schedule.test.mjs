// Checks the pipeline schedule figure's simulator against pipeline_sim.py, a
// separate Python implementation (fixtures written by
// content/ml/serving-systems/parallelism/pipeline_sim.py), and against the
// closed forms of Huang et al. (2019), Narayanan et al. (2021) and
// Korthikanti et al. (2022).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(path.join(here, "../../../../content/ml/serving-systems/parallelism/pipeline-fixtures.json"), "utf8"));
const model = await load("components/pipeline-schedule/model.ts");
const view = await load("components/pipeline-schedule/render.ts");

const opsText = (r) => {
  const per = Array.from({ length: r.p }, () => []);
  for (const o of [...r.ops].sort((a, b) => a.device - b.device || a.start - b.start)) per[o.device].push(`${o.phase}${o.mb}.${o.chunk}@${o.start}`);
  return per.map((x) => x.join(" "));
};

test("every operation's device, order and start time match pipeline_sim.py", () => {
  assert.ok(fixtures.length > 200);
  for (const f of fixtures) {
    const r = model.simulate(f.kind, f.p, f.m, f.v);
    const tag = `${f.kind} p=${f.p} m=${f.m} v=${f.v}`;
    assert.equal(r.makespan, f.makespan, tag);
    assert.deepEqual(opsText(r), f.ops, tag);
    assert.deepEqual(r.peak, f.peak, tag);
  }
});

test("bubble fraction and peak in-flight microbatches match the closed forms on the figure's whole range", () => {
  let n = 0;
  for (let p = 1; p <= 8; p++)
    for (let m = 1; m <= 16; m++)
      for (const [kind, vs] of [["gpipe", [1]], ["1f1b", [1]], ["interleaved", [2, 3, 4]]])
        for (const v of vs) {
          if (!model.valid(kind, p, m)) continue;
          const r = model.simulate(kind, p, m, v);
          assert.ok(Math.abs(r.bubble - model.closedBubble(kind, p, m, v)) < 1e-12, `${kind} ${p} ${m} ${v}: ${r.bubble}`);
          for (let i = 0; i < p; i++) assert.ok(Math.abs(r.peak[i] - model.closedPeak(kind, p, m, v, i)) < 1e-12, `${kind} ${p} ${m} ${v} device ${i}`);
          n++;
        }
  assert.ok(n > 300, `${n} cases`);
});

test("no device runs two operations at once, and every dependency finishes first", () => {
  for (const [kind, p, m, v] of [["gpipe", 5, 7, 1], ["1f1b", 6, 9, 1], ["interleaved", 4, 12, 3], ["interleaved", 3, 3, 4]]) {
    const r = model.simulate(kind, p, m, v);
    const S = p * r.v;
    const end = new Map(r.ops.map((o) => [`${o.phase}${o.mb}:${o.chunk * p + o.device}`, o.end]));
    for (let i = 0; i < p; i++) {
      const mine = r.ops.filter((o) => o.device === i).sort((a, b) => a.start - b.start);
      assert.equal(mine.length, 2 * m * r.v);
      for (let k = 1; k < mine.length; k++) assert.ok(mine[k].start >= mine[k - 1].end);
    }
    for (const o of r.ops) {
      const s = o.chunk * p + o.device;
      const dep = o.phase === "F" ? (s === 0 ? null : `F${o.mb}:${s - 1}`) : s === S - 1 ? `F${o.mb}:${s}` : `B${o.mb}:${s + 1}`;
      if (dep) assert.ok(end.get(dep) <= o.start, `${kind} ${o.phase}${o.mb} stage ${s}`);
    }
  }
});

test("1F1B and GPipe take (m + p - 1)(t_f + t_b); interleaving shortens it by (p - 1)(1 - 1/v)(t_f + t_b)", () => {
  const p = 4;
  const m = 8;
  assert.equal(model.simulate("gpipe", p, m).makespan, (m + p - 1) * 3);
  assert.equal(model.simulate("1f1b", p, m).makespan, (m + p - 1) * 3);
  const r = model.simulate("interleaved", p, m, 2);
  assert.equal(r.makespan / 2, (m + (p - 1) / 2) * 3);
  assert.deepEqual(model.simulate("1f1b", p, m).peak, [4, 3, 2, 1]);
  assert.deepEqual(model.simulate("gpipe", p, m).peak, [8, 8, 8, 8]);
  // Korthikanti et al.: the first device holds p (1 + (p - 1)/(p v)) microbatches.
  assert.equal(r.peak[0], p * (1 + (p - 1) / (p * 2)));
});

test("the figure renders, rejects interleaving when p does not divide m, and two copies have no shared ids", () => {
  const html = view.render({ schedules: "gpipe,1f1b,interleaved", p: 4, m: 8, v: 2 });
  assert.match(html, /bubble 3\/8 of busy time = 37\.5%/);
  assert.match(html, /bubble 3\/16 of busy time = 18\.8%/);
  assert.ok(!/ id=/.test(html), "the figure uses no ids");
  assert.equal((html.match(/disabled/g) ?? []).length, 3);
  const bad = view.chartHtml(view.stateFrom({ schedules: "interleaved", p: 4, m: 6, v: 2 }));
  assert.match(bad, /not a multiple of p = 4/);
  const two = view.stateFrom({ schedules: "1f1b", p: 99, m: 0 });
  assert.equal(two.p, 8);
  assert.equal(two.m, 1);
});
