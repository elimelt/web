// Checks the fan-out tail figure against independent references: the
// percentiles analyze.py computed from the raw latencies (results.json), a
// Monte Carlo maximum of k draws from the same histogram, and the closed
// form 1 - 0.99^k for the share of roots slower than one leaf's p99.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/fanout-tail/model.ts");
const r = await load("components/fanout-tail/render.ts");
const { mulberry32 } = await load("shared/random.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const results = JSON.parse(
  readFileSync(path.join(here, "../../../../content/systems/performance/tail-latency-fanout/results.json"), "utf8"),
);
const QS = results.quantiles; // [50, 90, 95, 99, 99.9]
// One bin spans a factor of 10^(1/60) = 1.039; pooling three runs moves a
// percentile by less than its run-to-run spread, so allow 6%.
const TOL = 0.06;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a / b - 1) <= tol, `${msg}: ${a.toFixed(1)} vs ${b.toFixed(1)}`);

test("the histograms hold every recorded request", () => {
  assert.deepEqual(m.MEASURED, [1, 4, 16, 64]);
  for (const k of m.MEASURED) {
    const f = m.FANOUTS[k];
    assert.equal(f.root.counts.reduce((a, b) => a + b, 0), f.root.n);
    assert.equal(f.leaf.counts.reduce((a, b) => a + b, 0), f.leaf.n);
    assert.equal(f.root.n, 60000);
    assert.equal(f.leaf.n, 60000 * k);
  }
});

test("median, p90, p95 and p99 from the histograms match the raw-data percentiles", () => {
  for (const k of m.MEASURED) {
    const g = results.groups[`k${k}`];
    for (const [i, q] of QS.entries()) {
      if (q > 99) continue; // p99.9 differs between runs by more than the tolerance
      close(m.quantile(m.FANOUTS[k].root, q / 100), g.root.mean[i], TOL + g.root.sd[i] / g.root.mean[i], `root k=${k} p${q}`);
      close(m.quantile(m.FANOUTS[k].leaf, q / 100), g.leaf.mean[i], TOL + g.leaf.sd[i] / g.leaf.mean[i], `leaf k=${k} p${q}`);
    }
  }
});

test("cdf and quantile are inverses", () => {
  const h = m.FANOUTS[16].root;
  for (const p of [0.01, 0.1, 0.5, 0.9, 0.99, 0.999]) {
    const t = m.quantile(h, p);
    assert.ok(Math.abs(m.cdf(h, t) - p) < 1e-9, `p=${p}`);
  }
});

test("the independence prediction matches a Monte Carlo maximum of k draws", () => {
  const leaf = m.FANOUTS[1].leaf;
  const rand = mulberry32(7);
  // inverse-CDF sampling from the histogram
  const draw = () => m.quantile(leaf, rand());
  for (const k of [1, 3, 16, 50]) {
    const n = 20000;
    const maxes = Array.from({ length: n }, () => {
      let mx = 0;
      for (let j = 0; j < k; j++) mx = Math.max(mx, draw());
      return mx;
    }).sort((a, b) => a - b);
    for (const p of [0.5, 0.9]) close(m.predictedQuantile(leaf, k, p), maxes[Math.floor(p * n)], 0.03, `k=${k} p=${p}`);
    const t = m.quantile(leaf, 0.99);
    const mc = maxes.filter((x) => x > t).length / n;
    assert.ok(Math.abs(mc - (1 - m.predictedCdf(leaf, k, t))) < 0.015, `k=${k} share slower than leaf p99`);
  }
});

test("the predicted share slower than one leaf's p99 is 1 - 0.99^k", () => {
  for (const k of [1, 2, 4, 16, 37, 64]) {
    const s = m.summarize(k, "alone");
    assert.ok(Math.abs(s.pred.slow - (1 - 0.99 ** k)) < 1e-9, `k=${k}`);
  }
});

test("the measured share slower than one leaf's p99 matches the raw data", () => {
  for (const k of [4, 16, 64]) {
    const s = m.summarize(k, "alone");
    const raw = results.groups[`k${k}`].frac_root_over_leaf1_p99;
    assert.ok(Math.abs(s.meas.slow - raw) < 0.03, `k=${k}: ${s.meas.slow} vs ${raw}`);
  }
});

test("the loaded basis is used only at measured fan-outs", () => {
  assert.equal(m.summarize(16, "loaded").basis, "loaded");
  assert.equal(m.summarize(10, "loaded").basis, "alone");
  assert.equal(m.summarize(10, "alone").meas, null);
});

test("the figure renders every curve and a readout", () => {
  const html = r.render({ k: 16 });
  assert.match(html, /class="ft-pred"/);
  assert.match(html, /class="ft-meas"/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(r.chart(10, "alone"), /ft-meas/);
  assert.match(r.chart(64, "loaded"), /ft-leaf-loaded/);
  assert.doesNotMatch(r.render({ k: 16 }), /NaN|undefined/);
  for (let k = 1; k <= 64; k++) for (const b of ["alone", "loaded"]) assert.doesNotMatch(r.chart(k, b) + r.readout(k, b), /NaN|Infinity|undefined/);
});

test("numbers the note quotes", () => {
  const s16 = m.summarize(16, "alone");
  const s64 = m.summarize(64, "alone");
  // the measured root median at k = 16 is more than twice the independent prediction
  assert.ok(s16.meas.p50 / s16.pred.p50 > 2);
  // at k = 64 the measured median exceeds the prediction by more than 4x,
  // while the measured p99 is below the prediction from the same leaves at load
  assert.ok(s64.meas.p50 / s64.pred.p50 > 4);
  const l64 = m.summarize(64, "loaded");
  assert.ok(l64.meas.p99 < l64.pred.p99);
});
