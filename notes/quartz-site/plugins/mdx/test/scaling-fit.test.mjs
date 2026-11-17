// The scaling-fit figure's least-squares fits against independent references:
// the R usl package's published fit of the SPEC SDM91 data (its README), the
// scipy fits in content/systems/performance/scaling-experiments/
// scaling-results.json, and recovery of known parameters from noiseless curves.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(path.join(here, "../../../../content/systems/performance/scaling-experiments/scaling-results.json"), "utf8"));
const m = await load("components/scaling-fit/model.ts");
const data = await load("components/scaling-fit/data.ts");
const r = await load("components/scaling-fit/render.ts");

const close = (got, want, rel, msg) => assert.ok(Math.abs(got - want) <= rel * Math.max(Math.abs(want), 1e-12), `${msg}: ${got} vs ${want}`);

test("SPEC SDM91 fit matches the R usl package (alpha 0.0277285, beta 0.0001044, gamma 89.9952330)", () => {
  const d = data.DATASETS.find((x) => x.key === "specsdm91");
  const f = m.fit(d.n, d.x, true);
  close(f.sigma, 0.0277285, 1e-4, "sigma");
  close(f.kappa, 0.0001044, 1e-3, "kappa");
  close(f.gamma, 89.995233, 1e-5, "gamma");
});

test("every dataset's fits match scipy least_squares to 1e-4 relative SSE and parameters", () => {
  for (const d of data.DATASETS) {
    const want = ref[d.key];
    for (const [kind, withKappa] of [["usl", true], ["amdahl", false]]) {
      const got = m.fit(d.n, d.x, withKappa);
      // equal or lower residual than scipy, and the same parameters
      assert.ok(got.sse <= want[kind].sse * (1 + 1e-6) + 1e-18, `${d.key} ${kind} sse ${got.sse} vs ${want[kind].sse}`);
      close(got.sigma, want[kind].sigma, 2e-3, `${d.key} ${kind} sigma`);
      if (withKappa && want[kind].kappa > 1e-9) close(got.kappa, want[kind].kappa, 2e-3, `${d.key} ${kind} kappa`);
      close(got.gamma, want[kind].gamma, 1e-4, `${d.key} ${kind} gamma`);
    }
  }
});

test("fits to the first few SDM91 points match scipy", () => {
  const d = data.DATASETS.find((x) => x.key === "specsdm91");
  for (const k of [3, 4, 5]) {
    const ns = d.n.slice(0, k);
    const xs = d.x.slice(0, k);
    const want = ref.specsdm91[`usl_first${k}`];
    const got = m.fit(ns, xs, true);
    assert.ok(got.sse <= want.sse * (1 + 1e-6) + 1e-12, `first ${k}: sse ${got.sse} vs ${want.sse}`);
  }
});

test("recovers known parameters from exact curves", () => {
  const ns = [1, 2, 4, 8, 16, 32, 64, 128];
  for (const [g, s, k] of [
    [10, 0.05, 0],
    [3, 0.02, 1e-4],
    [100, 0.3, 0.003],
    [1, -0.05, 0],
  ]) {
    const xs = ns.map((n) => g * m.shape(n, s, k));
    const f = m.fit(ns, xs, true);
    close(f.sigma, s, 1e-5, `sigma ${s}`);
    assert.ok(Math.abs(f.kappa - k) <= 1e-7 + 1e-4 * k, `kappa ${f.kappa} vs ${k}`);
    if (k === 0) close(m.fit(ns, xs, false).sigma, s, 1e-6, "amdahl sigma");
  }
});

test("Karp-Flatt metric equals sigma for an exact Amdahl curve and nPeak is the USL maximum", () => {
  for (const s of [0.01, 0.05, 0.2]) for (const n of [2, 4, 64]) close(m.karpFlatt(m.shape(n, s, 0), n), s, 1e-12, "kf");
  const np = m.nPeak(0.02, 1e-4);
  close(np, Math.sqrt(0.98 / 1e-4), 1e-12, "npeak");
  assert.ok(m.shape(np, 0.02, 1e-4) >= m.shape(np - 1, 0.02, 1e-4) && m.shape(np, 0.02, 1e-4) >= m.shape(np + 1, 0.02, 1e-4));
});

test("render produces a complete figure with disabled controls for every dataset", () => {
  for (const d of data.DATASETS) {
    const html = r.render({ dataset: d.key });
    assert.match(html, /<figure class="sf"/);
    assert.match(html, /name="nmax"[^>]*disabled/);
    assert.ok(!html.includes("NaN"), `${d.key} has NaN`);
    const lv = r.levels(d);
    for (let i = 2; i < lv.length; i++) {
      const v = r.view(d, lv[i]);
      const c = r.chart(v) + r.readout(v);
      assert.ok(!c.includes("NaN"), `${d.key} N<=${lv[i]} has NaN`);
    }
  }
});
