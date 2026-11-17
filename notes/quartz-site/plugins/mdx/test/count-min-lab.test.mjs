// The Count-Min figure against a NumPy recomputation of the same sketch on the
// same hourly Wikipedia counts (content/algorithms/probabilistic/
// sketch-experiments/figure_check.py), plus the guarantees of Theorem 1 that
// hold deterministically (no underestimates).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(path.join(here, "../../../../content/algorithms/probabilistic/sketch-experiments/figure-check.json"), "utf8")).cms;
const m = await load("components/count-min-lab/model.ts");
const r = await load("components/count-min-lab/render.ts");
const counts = m.expandCounts();

test("decodes the hourly counts", () => {
  assert.equal(counts.length, ref.pages);
  let N = 0;
  for (const c of counts) N += c;
  assert.equal(N, ref.views);
  assert.equal(counts[0], 216595);
  assert.equal(counts[counts.length - 1], 1);
});

test("fmix32 matches MurmurHash3's finalizer", () => {
  assert.equal(m.fmix32(0), 0);
  assert.equal(m.fmix32(1), 0x514e28b7);
});

test("summary statistics match the NumPy reference exactly", () => {
  for (const c of ref.cases) {
    const s = m.analyze(counts, c.logw, c.d, c.seed, [0, 1, 2]);
    assert.ok(Math.abs(s.meanErr - c.meanErr) < 1e-6, `meanErr ${s.meanErr} vs ${c.meanErr}`);
    assert.equal(s.exceed, c.exceed);
    assert.equal(s.exact, c.exact);
    assert.equal(s.medianSingle, c.medianSingle);
    assert.ok(Math.abs(s.top100Rel - c.top100Rel) < 1e-9);
  }
});

test("never underestimates", () => {
  const est = m.sketch(counts, 9, 3, 11);
  for (let i = 0; i < counts.length; i++) assert.ok(est[i] >= counts[i]);
});

test("one row's mean error is close to N/w", () => {
  const s = m.analyze(counts, 12, 1, 3, [0]);
  const N = ref.views;
  assert.ok(Math.abs(s.meanErr / (N / 4096) - 1) < 0.1, `${s.meanErr} vs ${N / 4096}`);
});

test("renders a complete, disabled figure", () => {
  const html = r.render({});
  assert.match(html, /<figure class="cml"/);
  assert.match(html, /name="logw"[^>]*disabled/);
  assert.match(html, /1,370,576/);
});
