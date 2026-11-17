// The router load figure's model against an independent numpy implementation
// (content/ml/serving-systems/mixture-of-experts/figure_check.py) on the same
// recorded Switch-Base routing: pool shares exactly, the independent-token
// drop rate against its exact binomial expectation, and the whole-sequence drop
// rate against numpy's Monte Carlo estimate. Then properties of one batch.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/ml/serving-systems/mixture-of-experts");
const expected = JSON.parse(readFileSync(path.join(dir, "figure-check.json"), "utf8"));
const m = await load("components/router-load/model.ts");
const render = await load("components/router-load/render.ts");
const routes = (model, layer) => m.loadRoutes(JSON.parse(readFileSync(path.join(dir, `router-${model}-layer${layer}.json`), "utf8")));

test("decodes every data file", () => {
  for (const model of ["e8", "e64"])
    for (const layer of [1, 7, 11]) {
      const r = routes(model, layer);
      assert.equal(r.N, model === "e8" ? 8 : 64);
      assert.equal(r.layer, layer);
      for (const d of m.DOMAINS) assert.equal(r.choices[d].length, 8192);
    }
});

for (const e of expected) {
  const name = `${e.model} block ${e.layer + 1}, ${e.traffic}, B=${e.batch}, c=${e.cf}`;
  test(`matches the numpy reference: ${name}`, () => {
    const r = routes(e.model, e.layer);
    const f = m.poolLoad(r, e.traffic);
    e.pool.forEach((v, i) => assert.ok(Math.abs(f[i] - v) < 1e-12, `share of expert ${i}`));
    assert.equal(m.capacity(e.cf, e.batch, r.N), e.C);
    const R = e.batch >= 1024 ? 3000 : 20000;
    const tok = m.simulate(r, { traffic: e.traffic, batch: e.batch, mode: "tokens", cf: e.cf, draw: 0 }, R);
    // exact expectation; per-batch drop fraction has sd < 0.25, so 4 standard errors
    const tolTok = Math.max(0.004, (4 * 0.25) / Math.sqrt(R) * (e.batch >= 1024 ? 0.2 : 1));
    assert.ok(Math.abs(tok.meanDrop - e.tokensDrop) < tolTok, `tokens: ${tok.meanDrop} vs exact ${e.tokensDrop}`);
    const seq = m.simulate(r, { traffic: e.traffic, batch: e.batch, mode: "sequences", cf: e.cf, draw: 0 }, R);
    const R0 = e.batch >= 1024 ? 4000 : 20000;
    const seJs = e.sequencesSE * Math.sqrt(R0 / R);
    const tolSeq = 5 * Math.hypot(e.sequencesSE, seJs) + 1e-4;
    assert.ok(Math.abs(seq.meanDrop - e.sequencesDrop) < tolSeq, `sequences: ${seq.meanDrop} vs numpy ${e.sequencesDrop} ± ${tolSeq}`);
  });
}

test("one batch: counts add up, drops fall as capacity rises, none when C >= B", () => {
  const r = routes("e64", 11);
  for (const mode of ["tokens", "sequences"])
    for (const B of m.BATCHES) {
      const b = m.sampleBatch(m.pool(r, "mixed"), B, mode, () => 0.37);
      const n = m.counts(b, r.N);
      assert.equal(n.reduce((a, v) => a + v, 0), B);
      let prev = Infinity;
      for (let c = 1; c <= 3.001; c += 0.05) {
        const d = m.dropped(n, m.capacity(c, B, r.N));
        assert.ok(d <= prev);
        prev = d;
      }
      assert.equal(m.dropped(n, m.capacity(r.N, B, r.N)), 0);
    }
});

test("whole sequences of 256 or more never repeat a window", () => {
  const r = routes("e8", 7);
  const ws = m.pool(r, "code");
  const b = m.sampleBatch(ws.map((w, i) => new Uint8Array(w.length).fill(i % 256)), 4096, "sequences", Math.random);
  const seen = new Set();
  for (let j = 0; j < 4096; j += 256) seen.add(b[j]);
  assert.equal(seen.size, 16);
});

test("build-time markup", () => {
  const html = render.render({ base: "/x/" });
  assert.match(html, /^<figure class="rl" data-base="\/x\/">/);
  assert.ok(!/<button(?![^>]*disabled)/.test(html), "every button starts disabled");
  assert.match(html, /aria-pressed="true"[^>]*>All four</);
  assert.match(html, /capacity 40/); // ceil(1.25 * 256 / 8)
});
