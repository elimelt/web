// The Bloom filter figure against an independent NumPy implementation of the
// same layouts and closed forms (content/algorithms/probabilistic/
// bloom-experiments/figure_ref.py), plus statistical checks of the effects
// the note describes.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(path.join(here, "../../../../content/algorithms/probabilistic/bloom-experiments/figure-check.json"), "utf8"));
const m = await load("components/bloom-lab/model.ts");
const r = await load("components/bloom-lab/render.ts");

test("fmix32 and the seed stream match the reference", () => {
  for (const x of ref.mix) assert.equal(m.fmix32(x.x >>> 0), x.fmix32);
  for (const [s, [s0, t]] of Object.entries(ref.seeds)) {
    const sd = m.seeds(Number(s));
    assert.equal(sd.s, s0);
    assert.deepEqual(sd.t, t);
  }
});

test("30 filters match the reference: probe positions, set bits and false positives exactly", () => {
  assert.equal(ref.cases.length, 30);
  const p = new Int32Array(m.KMAX);
  for (const c of ref.cases) {
    const sd = m.seeds(c.seed);
    c.probes.forEach((want, x) => {
      m.probes(c.layout, c.m, c.k, sd, x, p);
      assert.deepEqual(Array.from(p.slice(0, c.k)), want, `${c.layout} m=${c.m} k=${c.k} key ${x}`);
    });
    const f = m.build(c.layout, c.m, c.n, c.k, c.seed);
    assert.equal(m.ones(f), c.ones, `${c.layout} m=${c.m} ones`);
    assert.equal(m.falsePositives(f, c.q), c.fp, `${c.layout} m=${c.m} fp`);
  }
});

test("closed forms match theory.py", () => {
  for (const g of ref.formulas) {
    const close = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(b, 1e-300), `${what} b=${g.b} k=${g.k}: ${a} vs ${b}`);
    close(m.fprStandard(g.b, g.k), g.std, "std");
    close(m.fprBlockedPutze(g.b, g.k, 512), g.putze512, "putze512");
    close(m.fprBlockedExact(g.b, g.k, 512), g.exact512, "exact512");
    close(m.fprBlockedPutze(g.b, g.k, 64), g.putze64, "putze64");
    close(m.fprBlockedExact(g.b, g.k, 64), g.exact64, "exact64");
  }
});

test("the exact blocked rate is at least Putze's and approaches the standard rate for large blocks", () => {
  for (const b of [6, 10, 16]) {
    for (const k of [2, 5, 9]) {
      assert.ok(m.fprBlockedExact(b, k, 512) >= m.fprBlockedPutze(b, k, 512));
      assert.ok(m.fprBlockedExact(b, k, 64) >= m.fprBlockedPutze(b, k, 64));
      assert.ok(m.fprBlockedExact(b, k, 64) > m.fprBlockedExact(b, k, 512));
    }
  }
  const std = m.fprStandard(10, 7);
  const gaps = [64, 512, 4096].map((B) => m.fprBlockedExact(10, 7, B) / std - 1);
  assert.ok(gaps[0] > gaps[1] && gaps[1] > gaps[2] && gaps[2] > 0 && gaps[2] < 0.03, `${gaps}`);
});

test("measured rates agree with their closed forms within sampling error", () => {
  // z-scores against the binomial standard error; LevelDB's sequence is the exception the note describes
  for (const layout of ["standard", "partitioned", "double", "blocked512", "blocked64"]) {
    for (const [b, k] of [[8, 5], [10, 7], [14, 9]]) {
      const f = m.build(layout, m.M, Math.round(m.M / b), k, 11 * k + b);
      const fp = m.falsePositives(f, m.Q);
      const p = m.theory(layout, b, k);
      const z = (fp - p * m.Q) / Math.sqrt(p * (1 - p) * m.Q);
      assert.ok(Math.abs(z) < 4.5, `${layout} b=${b} k=${k}: ${fp} vs ${p * m.Q}, z=${z}`);
    }
  }
});

test("LevelDB's probe sequence has an excess rate on a filter of 2^20 bits", () => {
  const f = m.build("leveldb", m.M, Math.round(m.M / 10), 7, 3);
  const rate = m.falsePositives(f, m.Q) / m.Q;
  assert.ok(rate > 1.5 * m.fprStandard(10, 7), `${rate}`);
});

test("the third LevelDB probe takes few values", () => {
  // h + 2*rotr(h, 17) over a sample of h: the note's exhaustive count is 196,606 of 2^32
  const seen = new Set();
  let s = 1;
  for (let i = 0; i < 200000; i++) {
    s = m.fmix32((s + 0x9e3779b9) >>> 0);
    const d = ((s >>> 17) | (s << 15)) >>> 0;
    seen.add((s + 2 * d) >>> 0);
  }
  assert.ok(seen.size < 196607, `${seen.size}`);
  assert.ok(seen.size > 100000, `${seen.size}`);
});

test("the readout reports the counts it drew", () => {
  const pts = m.sweep("standard", 10, 1, 1 << 16, 1 << 14);
  assert.equal(pts.length, m.KMAX);
  const text = r.readout("standard", 10, 7, pts[6]);
  assert.ok(text.includes(pts[6].fp.toLocaleString("en-US")));
  assert.ok(text.includes("16,384"));
  const s = r.smallFilter("blocked512", 10, 7, 1, 0);
  assert.equal(new Set(s.probes.map((p) => p.pos >>> 9)).size, 1);
  const s64 = r.smallFilter("blocked64", 10, 7, 1, 0);
  assert.equal(new Set(s64.probes.map((p) => p.pos >>> 6)).size, 1);
  const checked = s.probes.filter((p) => p.checked);
  assert.ok(checked.every((p, i) => p.set || i === checked.length - 1));
  assert.equal(s.hit, s.probes.every((p) => p.set));
});

test("render produces one figure with its controls disabled until mounted", () => {
  const html = r.render({ seed: 1 });
  assert.equal((html.match(/<figure/g) || []).length, 1);
  assert.equal((html.match(/ disabled/g) || []).length, 5);
  assert.ok(!html.includes("NaN"));
});
