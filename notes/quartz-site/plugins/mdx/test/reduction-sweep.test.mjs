// Checks the reductions figure against independent references: the analysis
// script's summary for every plotted point, a closed form for the break-even
// size, a separate interpolation for the dispatch model, and the separately
// measured spawn curve, which the model must predict from the pooled curve
// and the dispatch-only benchmark.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bench = path.join(here, "../../../../content/systems/operating-systems/benchmarks");
const summary = JSON.parse(readFileSync(path.join(bench, "reductions_bench-summary.json"), "utf8"));
const m = await load("components/reduction-sweep/model.ts");
const r = await load("components/reduction-sweep/render.ts");

test("every plotted value equals the analysis summary", () => {
  assert.deepEqual([...m.SIZES], summary.sizes);
  assert.equal(m.CLOCK_GHZ, Math.round(summary.clock_ghz.median * 1e4) / 1e4);
  for (const v of m.VARIANTS) {
    const cells = summary.cells[v.id];
    assert.equal(cells.length, m.SIZES.length, v.id);
    cells.forEach((c, i) => {
      assert.equal(m.ns(v.id, i), c.ns_per_elem, `${v.id} ${c.bytes}`);
      assert.equal(m.nsMin(v.id, i), c.min);
      assert.equal(m.nsMax(v.id, i), c.max);
      // The summary rounds GB/s to 3 decimals.
      assert.ok(Math.abs(m.gbs(m.ns(v.id, i)) - c.gbs) <= 5e-4 + 1e-9, `${v.id} ${c.bytes} GB/s`);
      assert.ok(c.min <= c.ns_per_elem && c.ns_per_elem <= c.max);
    });
  }
  assert.equal(m.DISPATCH_US.spawn, summary.dispatch.spawn.median_us);
  assert.equal(m.DISPATCH_US.poolHot, summary.dispatch.pool_hot.median_us);
  assert.equal(m.DISPATCH_US.poolCold, summary.dispatch.pool_cold.median_us);
});

test("break-even matches the closed form for constant per-element costs", () => {
  const sizes = Array.from({ length: 19 }, (_, i) => 16384 * 2 ** i);
  for (const [a, b, d, hot] of [
    [0.06, 0.02, 80, 0.5],
    [0.6, 0.15, 90, 0.7],
    [0.3, 0.29, 5, 1],
    [0.05, 0.03, 0.7, 0.6],
  ]) {
    const want = (8000 * (d - hot)) / (a - b); // bytes where b + 8000(d-hot)/bytes = a
    const got = m.breakEven(sizes.map(() => a), sizes.map(() => b), sizes, d, hot);
    if (want < sizes[0]) assert.equal(got, sizes[0]);
    else if (want > sizes.at(-1)) assert.equal(got, null);
    else assert.ok(Math.abs(got / want - 1) < 1e-6, `a=${a} b=${b} d=${d}: ${got} vs ${want}`);
  }
  // A threaded curve that is never faster never breaks even.
  assert.equal(m.breakEven(sizes.map(() => 0.1), sizes.map(() => 0.2), sizes, 1, 0.5), null);
});

test("interpolation is exact at measured sizes and log-linear between them", () => {
  const vals = m.series("all_pool");
  m.SIZES.forEach((b, i) => assert.ok(Math.abs(m.interp(vals, m.SIZES, b) - vals[i]) < 1e-12));
  for (let i = 1; i < m.SIZES.length; i++) {
    const mid = Math.sqrt(m.SIZES[i - 1] * m.SIZES[i]); // half an octave
    const want = Math.sqrt(vals[i - 1] * vals[i]); // geometric mean
    assert.ok(Math.abs(m.interp(vals, m.SIZES, mid) / want - 1) < 1e-9);
  }
});

test("the dispatch model at the measured spawn cost predicts the measured spawn curve", () => {
  // all_spawn was measured directly; the model sees only all_pool and the
  // empty-call benchmark. Up to 2 MiB the call is dominated by dispatch; the spawn cost itself varies by about a third (10th to 90th percentile).
  const pred = r.modelPoints(m.DISPATCH_US.spawn);
  m.SIZES.forEach((b, i) => {
    if (b > 2 * 1024 * 1024) return;
    const meas = m.ns("all_spawn", i);
    assert.ok(Math.abs(pred[i] / meas - 1) < 0.2, `${b}: predicted ${pred[i]} measured ${meas}`);
  });
  // At the spinning pool's own cost the model returns the pooled curve.
  r.modelPoints(m.DISPATCH_US.poolHot).forEach((p, i) => assert.ok(Math.abs(p - m.ns("all_pool", i)) < 1e-12));
});

test("break-even sizes on the measured data fall between the measured crossovers", () => {
  const single = m.bestSingleSeries();
  const pool = m.series("all_pool");
  const spawn = m.breakEven(single, pool, m.SIZES, m.DISPATCH_US.spawn);
  const hot = m.breakEven(single, pool, m.SIZES, m.DISPATCH_US.poolHot);
  // The measured crossover is the first measured size where the threaded
  // variant wins, so the model's continuous break-even lies within the octave
  // below it (or at it).
  const meas = summary.crossover_bytes;
  assert.ok(hot <= meas.all_pool && hot > meas.all_pool / 4, `hot ${hot}`);
  assert.ok(spawn <= meas.all_spawn * 2 && spawn > meas.all_spawn / 4, `spawn ${spawn}`);
  // A larger dispatch cost never moves break-even to a smaller size.
  let prev = 0;
  for (let p = 0; p <= m.SLIDER_MAX; p += 5) {
    const be = m.breakEven(single, pool, m.SIZES, m.sliderToUs(p));
    if (be === null) break;
    assert.ok(be >= prev - 1e-6, `slider ${p}`);
    prev = be;
  }
});

test("slider mapping round-trips and spans the measured costs", () => {
  for (let p = 0; p <= m.SLIDER_MAX; p++) assert.equal(m.usToSlider(m.sliderToUs(p)), p);
  assert.ok(Math.abs(m.sliderToUs(0) - m.DISPATCH_US.poolHot) < 1e-12);
  assert.ok(m.sliderToUs(m.SLIDER_MAX) >= m.DISPATCH_US.poolCold);
});

test("render draws one line per shown variant, at both widths, for every preset", () => {
  for (const id of m.PRESET_IDS) {
    const s = r.initialState(id);
    for (const narrow of [false, true]) {
      const svg = r.chartSvg(s, narrow);
      assert.equal((svg.match(/<polyline class="rs-line /g) || []).length, s.shown.size, id);
      assert.equal((svg.match(/<polyline class="rs-model"/g) || []).length, s.model ? 1 : 0);
      assert.ok(!/NaN|Infinity/.test(svg), `${id} narrow=${narrow}`);
    }
  }
  const html = r.render({ preset: "threads" });
  assert.ok(html.includes('name="preset-threads" aria-pressed="true"'));
  assert.ok(!/ id="/.test(html), "no page-global ids");
  // Every control is rendered disabled until the script enables it.
  for (const tag of html.match(/<(button|input)[^>]*>/g)) assert.ok(tag.includes("disabled"), tag);
});
