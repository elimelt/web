// The outlier figure's model against an independent numpy implementation
// (content/ml/serving-systems/quantization/figure_check.py), on the same real
// layer data, plus the number-format primitives against known values.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/ml/serving-systems/quantization");
const data = JSON.parse(readFileSync(path.join(dir, "outlier-layer.json"), "utf8"));
const expected = JSON.parse(readFileSync(path.join(dir, "figure-check.json"), "utf8"));
const m = await load("components/outlier-lab/model.ts");
const draw = await load("components/outlier-lab/draw.ts");
const render = await load("components/outlier-lab/render.ts");
const L = m.loadLayer(data);

test("decodes the layer", () => {
  assert.equal(L.N, 2048);
  assert.equal(L.T, data.tokens.length);
  assert.equal(L.C, data.cols.length);
  assert.equal(m.halfToFloat(0x3c00), 1);
  assert.equal(m.halfToFloat(0xc000), -2);
  assert.equal(m.halfToFloat(0x7bff), 65504);
  assert.equal(m.bf16ToFloat(0x3f80), 1);
  assert.equal(m.bf16ToFloat(0xc040), -3);
});

test("E4M3 rounding and integer grid", () => {
  assert.equal(m.roundE4M3(448), 448);
  assert.equal(m.roundE4M3(1e6), 448);
  assert.equal(m.roundE4M3(1.0625), 1); // tie to even mantissa
  assert.equal(m.roundE4M3(1.07), 1.125);
  assert.equal(m.roundE4M3(-3.3), -3.25);
  assert.equal(m.roundE4M3(2 ** -9), 2 ** -9);
  assert.equal(m.roundE4M3(0.0009), 0);
  assert.equal(m.rint(2.5), 2);
  assert.equal(m.rint(-3.5), -4);
  assert.equal(m.qsym(1000, 1, 8), 127);
  assert.equal(m.qsym(-1000, 1, 8), -128);
});

test("matches the numpy reference on every checked setting", () => {
  for (const c of expected) {
    const r = m.quantize(L, { method: c.method, bits: c.bits, alpha: c.alpha, threshold: c.threshold });
    const label = `${c.method} b${c.bits} a${c.alpha} t${c.threshold}`;
    assert.ok(Math.abs(r.relErr - c.relErr) <= 1e-6 * Math.max(1, c.relErr), `${label}: relErr ${r.relErr} vs ${c.relErr}`);
    assert.ok(Math.abs(r.zeroFrac - c.zeroFrac) < 1e-9, `${label}: zeroFrac ${r.zeroFrac} vs ${c.zeroFrac}`);
    assert.equal(r.floatCols, c.floatCols, `${label}: floatCols`);
    for (let t = 0; t < L.T; t++) assert.ok(Math.abs(r.tokenErr[t] - c.tokenErr[t]) <= 1e-6 * Math.max(1, c.tokenErr[t]), `${label}: token ${t}`);
  }
});

test("smoothing with alpha moves magnitude from inputs to weights", () => {
  const lo = m.quantize(L, { method: "smooth", bits: 8, alpha: 0.2, threshold: 6 });
  const hi = m.quantize(L, { method: "smooth", bits: 8, alpha: 0.9, threshold: 6 });
  const max = (a) => a.reduce((x, y) => Math.max(x, y), 0);
  assert.ok(max(hi.xChan) / max(hi.wChan) < max(lo.xChan) / max(lo.wChan));
});

test("build markup renders a finished, disabled figure", () => {
  const html = render.render({ base: "/x/" });
  assert.match(html, /<figure class="ol" data-base="\/x\/">/);
  assert.ok(!/<button(?![^>]*disabled)/.test(html), "every button starts disabled");
  assert.equal((html.match(/class="ol-chip"/g) || []).length, L.T);
  assert.match(html, /Output error/);
  assert.equal(draw.THRESHOLDS.includes(6), true);
});
