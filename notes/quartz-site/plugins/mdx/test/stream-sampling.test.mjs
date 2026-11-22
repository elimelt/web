// The stream-sampling figure against an independent Python implementation of
// the same samplers on the same recorded substream
// (content/algorithms/probabilistic/sampling-experiments/figure_ref.py), and
// against the properties each sampler claims: Algorithm L's uniform
// inclusion, and unbiased subset sums from priority sampling and from
// weighted sampling without replacement.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/algorithms/probabilistic/sampling-experiments");
const ref = JSON.parse(readFileSync(path.join(dir, "figure-check.json"), "utf8"));
const initial = JSON.parse(readFileSync(path.join(dir, "initial.json"), "utf8"));
const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8"));
const m = await load("components/stream-sampling/model.ts");
const r = await load("components/stream-sampling/render.ts");
const rnd = await load("shared/random.ts");
const data = m.decode(new Uint8Array(gunzipSync(readFileSync(path.join(dir, "records.bin.gz")))), meta.names);
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test("the decoded substream matches the reference and the metadata", () => {
  assert.equal(data.n, ref.n);
  assert.equal(data.n, meta.records);
  assert.equal(data.total, ref.total);
  assert.equal(data.total, meta.views);
  for (const s of m.SUBSETS) assert.ok(m.subsetMask(data, s.id).some((x) => x === 1), s.id);
});

test("quickselect returns the k-th smallest value", () => {
  const g = rnd.mulberry32(9);
  for (let trial = 0; trial < 50; trial++) {
    const n = 1 + Math.floor(g() * 300);
    const a = Float64Array.from({ length: n }, () => Math.floor(g() * 20) + (g() < 0.5 ? g() : 0));
    const sorted = [...a].sort((x, y) => x - y);
    for (const k of [0, n - 1, Math.floor(g() * n)]) assert.equal(m.kthSmallest(a, k), sorted[k]);
  }
});

test(`${ref.cases.length} runs match the reference sample by sample`, () => {
  for (const c of ref.cases) {
    const what = `K=${c.K} subset=${c.subset} base=${c.base}`;
    const mask = m.subsetMask(data, c.subset);
    const out = m.run(data, c.K, mask, c.base, c.trials);
    assert.equal(out.truth, c.truth, `${what}: truth`);
    assert.equal(out.records, c.records, `${what}: records`);
    for (const name of m.METHODS) {
      out.est[name].forEach((e, i) => assert.ok(close(e, c.est[name][i]), `${what}: ${name} trial ${i}: ${e} vs ${c.est[name][i]}`));
    }
    out.pvar.forEach((v, i) => assert.ok(close(v, c.pvar[i], 1e-7), `${what}: variance estimate ${i}`));
    assert.deepEqual(out.first.idx, c.first.idx, `${what}: first priority sample`);
    assert.equal(out.first.tau, c.first.tau, `${what}: tau`);
    assert.deepEqual(m.uniformSample(data, c.K, rnd.mulberry32(m.trialSeed(c.base, 0, 0))).idx, c.firstIdx.uniform, `${what}: first uniform sample`);
    assert.deepEqual(m.ppsworSample(data, c.K, rnd.mulberry32(m.trialSeed(c.base, 0, 2))).idx, c.firstIdx.ppswor, `${what}: first PPSWOR sample`);
  }
});

test("every sampler keeps exactly K records", () => {
  for (const K of m.KS) {
    for (const name of m.METHODS) {
      const s = m.SAMPLERS[name](data, K, rnd.mulberry32(K + name.length));
      assert.equal(s.idx.length, K, `${name} K=${K}`);
      assert.equal(new Set(s.idx).size, K, `${name} K=${K}: distinct`);
    }
  }
});

test("Algorithm L includes every position with probability K/n", () => {
  // 400 positions, K = 8, 20,000 runs: each count is binomial with mean 400.
  const n = 400;
  const K = 8;
  const runs = 20000;
  const counts = new Float64Array(n);
  const g = rnd.mulberry32(77);
  for (let t = 0; t < runs; t++) for (const i of m.algorithmL(n, K, g)) counts[i]++;
  const e = (runs * K) / n;
  const chi2 = counts.reduce((s, c) => s + (c - e) ** 2 / e, 0);
  // 399 degrees of freedom: mean 399, standard deviation about 28.
  assert.ok(chi2 < 399 + 5 * 28.2, `chi-square ${chi2}`);
  assert.ok(chi2 > 399 - 5 * 28.2, `chi-square ${chi2}`);
});

test("all three subset-sum estimators are unbiased", () => {
  // Mean of 400 estimates of a heavy subset (German Wikipedia) and a light one
  // (records with 1 view) within 5 standard errors of the truth.
  for (const id of ["p:de", "w:1"]) {
    const mask = m.subsetMask(data, id);
    const out = m.run(data, 200, mask, 31, 400);
    for (const name of ["priority", "ppswor", "uniform"]) {
      const e = out.est[name];
      const mean = e.reduce((a, b) => a + b, 0) / e.length;
      const sd = Math.sqrt(e.reduce((a, b) => a + (b - mean) ** 2, 0) / (e.length - 1));
      assert.ok(Math.abs(mean - out.truth) < (5 * sd) / Math.sqrt(e.length), `${id} ${name}: mean ${mean}, truth ${out.truth}`);
    }
  }
});

test("the build-time view is the reference's default run", () => {
  const mask = m.subsetMask(data, initial.subset);
  const out = m.run(data, initial.K, mask, 1);
  for (const name of m.METHODS) out.est[name].forEach((e, i) => assert.ok(close(e, initial.est[name][i]), `${name} trial ${i}`));
  const html = r.render({ base: "/x/" });
  assert.ok(html.includes('data-base="/x/"'));
  assert.ok(html.includes("<svg"));
  const v = r.initialView();
  assert.equal(v.kept.length, initial.K);
  for (let i = 1; i < v.kept.length; i++) assert.ok(v.kept[i - 1].w >= v.kept[i].w);
});
