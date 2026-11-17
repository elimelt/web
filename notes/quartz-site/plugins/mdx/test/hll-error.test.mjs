// The HyperLogLog figure's estimators against an independent Python
// implementation of the published formulas (content/algorithms/probabilistic/
// sketch-experiments/figure_check.py), plus statistical checks of the
// simulation against the asymptotic standard error 1.04/sqrt(m).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(path.join(here, "../../../../content/algorithms/probabilistic/sketch-experiments/figure-check.json"), "utf8"));
const m = await load("components/hll-error/model.ts");
const r = await load("components/hll-error/render.ts");

test("estimators match the Python reference on 30 sketches", () => {
  for (const f of ref.hll) {
    const got = m.estimates(f.C, f.p);
    for (const e of ["raw", "orig", "ertl"]) {
      const want = f.est[e];
      assert.ok(Math.abs(got[e] - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${e} p=${f.p} n=${f.n}: ${got[e]} vs ${want}`);
    }
  }
});

test("empty sketch: raw gives alpha_m m, the others 0", () => {
  for (const p of [4, 6, 10]) {
    const C = new Int32Array(66 - p + 1);
    C[0] = 2 ** p;
    const e = m.estimates(C, p);
    assert.ok(Math.abs(e.raw - m.alphaM(2 ** p) * 2 ** p) < 1e-9);
    assert.equal(e.orig, 0);
    assert.equal(e.ertl, 0);
  }
});

test("register update reads rho from the bits after the index", () => {
  const p = 4;
  const reg = new Uint8Array(16);
  const C = new Int32Array(64);
  C[0] = 16;
  m.update(reg, C, p, 0x30000000, 0); // index 3, remaining 60 bits all zero -> rho = 61
  assert.equal(reg[3], 64 - p + 1);
  m.update(reg, C, p, 0x58000000, 0); // index 5, rest 1000... -> rho 1
  assert.equal(reg[5], 1);
  m.update(reg, C, p, 0x00000000, 0x40000000); // index 0, 28 zero bits then 01 -> rho 28 + 2
  assert.equal(reg[0], 30);
  assert.equal(C[0], 13);
});

test("simulated standard error matches 1.04/sqrt(m) for p = 8 at n = 20m", () => {
  const c = m.simulate(8, 600, 3, 20);
  const k = c.n.length - 1;
  const want = 1.04 / 16;
  assert.ok(Math.abs(c.sd[k] / (1.04 / 16) - 1) < 0.12, `sd ${c.sd[k]}`);
  assert.ok(Math.abs(c.q.ertl.mid[k]) < 3 * want / Math.sqrt(600) * 1.3, `median ${c.q.ertl.mid[k]}`);
});

test("the 2007 algorithm's spread widens just below 5m/2 and the improved one's does not", () => {
  // Below E = 5m/2 the 2007 rule switches between linear counting and the raw
  // estimate, so near the switch the 5-95% band mixes two estimators.
  const c = m.simulate(10, 400, 2, 8);
  let worst = 0;
  c.n.forEach((v, k) => {
    if (v < 1.8 * 1024 || v > 2.6 * 1024) return;
    const ratio = (c.q.orig.hi[k] - c.q.orig.lo[k]) / (c.q.ertl.hi[k] - c.q.ertl.lo[k]);
    worst = Math.max(worst, ratio);
  });
  assert.ok(worst > 1.2, `largest spread ratio ${worst}`);
  const k = c.n.length - 1;
  const far = (c.q.orig.hi[k] - c.q.orig.lo[k]) / (c.q.ertl.hi[k] - c.q.ertl.lo[k]);
  assert.ok(Math.abs(far - 1) < 0.1, `far ratio ${far}`);
});

test("renders a complete, disabled figure", () => {
  const html = r.render({});
  assert.match(html, /<figure class="hle"/);
  assert.match(html, /<svg class="hle-chart"/);
  assert.match(html, /name="p"[^>]*disabled/);
  assert.equal(r.yMax(16), 1.5);
  assert.equal(r.yMax(1024), 0.15);
});
