// The failure-detector figure's model against an independent Python
// implementation (content/systems/distributed-systems/
// failure-detector-experiments/reference.py, output in figure-check.json),
// plus closed-form checks of phi and of the threshold-to-timeout mapping.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(path.join(here, "../../../../content/systems/distributed-systems/failure-detector-experiments/figure-check.json"), "utf8"));
const m = await load("components/phi-detector/model.ts");
const r = await load("components/phi-detector/render.ts");

test("normal tail matches known values", () => {
  // Q(0) = 1/2, Q(1.959964) = 0.025, Q(5.612) ~ 1e-8, Q(10) = 7.6198530241605e-24
  const cases = [
    [0, Math.log(0.5)],
    [1.959964, Math.log(0.025)],
    [10, Math.log(7.6198530241605e-24)],
    [-3, Math.log(1 - 0.0013498980316301)],
  ];
  for (const [x, want] of cases) assert.ok(Math.abs(m.lnQ(x) - want) < 2e-6 * Math.max(1, Math.abs(want)), `lnQ(${x}) = ${m.lnQ(x)}, want ${want}`);
  assert.ok(Math.abs(m.zForPhi(8) - 5.612) < 2e-3);
  assert.ok(Math.abs(m.zForPhi(2) - 2.3263) < 1e-3);
});

test("phi at the computed timeout equals the threshold", () => {
  const a = Float64Array.from({ length: 400 }, (_, i) => i * 100 + ((i * 7919) % 13));
  const st = m.windowStats(a, 100);
  for (const thr of [0.5, 2, 8, 16]) {
    for (const kind of ["phiNormal", "phiExp"]) {
      const tau = m.timeouts(kind, thr, st, 150);
      for (const k of [150, 260, 398]) assert.ok(Math.abs(m.level(kind, tau[k - 150], st, k) - thr) < 1e-6, `${kind} ${thr} at ${k}`);
    }
  }
});

test("sliding-window statistics match a direct computation", () => {
  const a = Float64Array.from({ length: 600 }, (_, i) => i * 100 + 40 * Math.sin(i * 1.7) + (i % 97 === 0 ? 300 : 0));
  const st = m.windowStats(a, 50);
  for (const k of [1, 10, 50, 51, 300, 599]) {
    const d = [];
    for (let i = Math.max(1, k - 49); i <= k; i++) d.push(a[i] - a[i - 1]);
    const mean = d.reduce((x, y) => x + y, 0) / d.length;
    const sd = Math.sqrt(d.reduce((x, y) => x + (y - mean) ** 2, 0) / d.length);
    assert.ok(Math.abs(st.mean[k] - mean) < 1e-7 && Math.abs(st.sd[k] - sd) < 1e-6, `k=${k}`);
  }
});

test("timeouts and QoS match the Python reference on recorded heartbeats", () => {
  let arr = null;
  for (const c of ref.cases) {
    if (c.arrivals) arr = Float64Array.from(c.arrivals);
    const st = m.windowStats(arr, ref.window);
    const tau = m.timeouts(c.kind, c.threshold, st, ref.start);
    c.taus.forEach((want, i) => assert.ok(Math.abs(tau[i * 50] - want) < 1e-3 * Math.max(1, want) + 1e-6, `${c.kind} ${c.threshold} seed ${c.seed}: tau[${i * 50}] ${tau[i * 50]} vs ${want}`));
    const q = m.quality(arr, tau, ref.start);
    assert.equal(q.mistakes, c.mistakes, `${c.kind} ${c.threshold} seed ${c.seed} mistakes`);
    assert.ok(Math.abs(q.detection - c.detection) < 1e-3 * c.detection, `${c.kind} detection`);
    assert.ok(Math.abs(q.accuracy - c.accuracy) < 1e-6, `${c.kind} accuracy`);
  }
});

test("larger thresholds never shorten the timeout or add mistakes", () => {
  const md = r.model(1000);
  for (const kind of m.KINDS) {
    const c = md.curves[kind];
    for (let i = 1; i < c.length; i++) {
      assert.ok(c[i].q.detection >= c[i - 1].q.detection - 1e-9, `${kind} detection monotone`);
      assert.ok(c[i].q.mistakes <= c[i - 1].q.mistakes, `${kind} mistakes monotone`);
    }
  }
});

test("the trace decodes to the recorded length and the figure renders", () => {
  const a = r.arrivals();
  assert.ok(a.length > 5000);
  for (let i = 1; i < a.length; i++) assert.ok(a[i] >= a[i - 1]);
  const html = r.render();
  assert.match(html, /<figure class="phd">/);
  assert.match(html, /wrong suspicion/);
  for (const k of m.KINDS) for (let pos = 0; pos <= 100; pos++) assert.ok(Math.abs(r.positionOf(k, r.thresholdAt(k, pos)) - pos) <= 1, `${k} ${pos}`);
  assert.equal(r.thresholdAt("phiNormal", r.positionOf("phiNormal", 8)), 8);
});
