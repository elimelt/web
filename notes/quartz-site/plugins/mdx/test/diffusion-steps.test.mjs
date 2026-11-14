// Checks the diffusion figure against diffusion2d.py, the NumPy harness that
// trained its weights: the schedules, the timestep subsequences, the network's
// noise predictions, and whole DDIM and DDPM trajectories from the same start
// and the same noise. The forward process is also checked against simulating
// the Markov chain step by step, which the closed form is meant to replace.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/ml/deep-learning/diffusion-2d");
const json = (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
const fixtures = json("fixtures.json");
const m = await load("components/diffusion-steps/model.ts");
const r = await load("components/diffusion-steps/component.ts");

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const flat = (rows) => Float64Array.from(rows.flat());

test("noise schedules match the harness", () => {
  const lin = m.linearAlphaBars();
  for (const [t, v] of Object.entries(fixtures.alpha_bars_linear)) close(lin[Number(t)], v, 1e-12, `linear index ${t}`);
  const cos = m.cosineAlphaBars();
  for (const [t, v] of Object.entries(fixtures.alpha_bars_cosine)) close(cos[Number(t) - 1], v, 1e-12, `cosine t=${t}`);
  // DDPM's linear schedule leaves about 4e-5 of the signal variance at t = T.
  assert.ok(lin[999] > 3e-5 && lin[999] < 5e-5, `alpha-bar_T = ${lin[999]}`);
});

test("timestep subsequences match numpy.linspace with Python rounding", () => {
  for (const [k, ts] of Object.entries(fixtures.timesteps)) assert.deepEqual(m.timesteps(Number(k)), ts, `k = ${k}`);
});

test("float16 decoding", () => {
  // 1.0, -2.0, 0.5, 65504 (largest half), 2^-24 (smallest subnormal), 0
  const bytes = Uint8Array.from([0x00, 0x3c, 0x00, 0xc0, 0x00, 0x38, 0xff, 0x7b, 0x01, 0x00, 0x00, 0x00]);
  const got = m.decodeHalf(Buffer.from(bytes).toString("base64"));
  assert.deepEqual(Array.from(got), [1, -2, 0.5, 65504, 2 ** -24, 0]);
});

for (const name of ["moons", "eight", "spiral"]) {
  const net = m.loadNet(json(`weights-${name}.json`));
  const fx = fixtures.datasets[name];

  test(`${name}: network predictions match NumPy`, () => {
    for (let i = 0; i < fx.t.length; i++) {
      const eps = m.predictNoise(net, Float64Array.from(fx.x[i]), fx.t[i]);
      close(eps[0], fx.eps[i][0], 1e-9, `eps x, case ${i}`);
      close(eps[1], fx.eps[i][1], 1e-9, `eps y, case ${i}`);
    }
  });

  test(`${name}: 10-step DDIM and DDPM trajectories match NumPy`, () => {
    const ab = m.linearAlphaBars();
    const ddim = m.sampler(net, flat(fx.start), 10, 0, ab, () => assert.fail("DDIM draws no noise"));
    while (ddim.step());
    fx.ddim10.forEach((state, i) => flat(state).forEach((v, j) => close(ddim.trajectory.states[i][j], v, 1e-9, `DDIM state ${i}`)));
    fx.ddim10_x0.forEach((pred, i) => flat(pred).forEach((v, j) => close(ddim.trajectory.x0[i][j], v, 1e-9, `DDIM x0 ${i}`)));
    const ddpm = m.sampler(net, flat(fx.start), 10, 1, ab, (step) => flat(fx.noises[step]));
    while (ddpm.step());
    fx.ddpm10.forEach((state, i) => flat(state).forEach((v, j) => close(ddpm.trajectory.states[i][j], v, 1e-9, `DDPM state ${i}`)));
  });
}

test("the closed form matches simulating the forward chain", () => {
  // x_t = sqrt(1 - beta_t) x_{t-1} + sqrt(beta_t) z, step by step, for a fixed x0.
  const lin = m.linearAlphaBars();
  const x0 = 1.7;
  const n = 20000;
  const z = m.gaussians(n * 1000, 99);
  const checks = { 50: [0, 0], 300: [0, 0], 1000: [0, 0] };
  for (let s = 0; s < n; s++) {
    let x = x0;
    for (let t = 1; t <= 1000; t++) {
      const beta = 1e-4 + ((0.02 - 1e-4) * (t - 1)) / 999;
      x = Math.sqrt(1 - beta) * x + Math.sqrt(beta) * z[s * 1000 + t - 1];
      if (checks[t]) {
        checks[t][0] += x;
        checks[t][1] += x * x;
      }
    }
  }
  for (const [t, [sum, sq]] of Object.entries(checks)) {
    const mean = sum / n;
    const variance = sq / n - mean * mean;
    const ab = lin[Number(t) - 1];
    assert.ok(Math.abs(mean - Math.sqrt(ab) * x0) < 0.03, `mean at t=${t}: ${mean} vs ${Math.sqrt(ab) * x0}`);
    assert.ok(Math.abs(variance - (1 - ab)) < 0.03, `variance at t=${t}: ${variance} vs ${1 - ab}`);
  }
});

test("render: one circle per point, controls disabled, presets honoured", () => {
  const fwd = r.render({ mode: "forward", data: "eight", t: 250, schedule: "cosine" });
  assert.equal((fwd.match(/<circle class="dfs-pt"/g) ?? []).length, 600);
  assert.match(fwd, /name="t" min="0" max="1000" step="1" value="250" disabled/);
  assert.match(fwd, /data-schedule="cosine"/);
  const rev = r.render({ mode: "reverse", data: "spiral", sampler: "ddim", steps: 10, show: "x0", n: 200, src: "/x.json" });
  assert.equal((rev.match(/<circle class="dfs-pt"/g) ?? []).length, 200);
  assert.equal((rev.match(/<circle class="dfs-x0"/g) ?? []).length, 200);
  assert.match(rev, /max="10"/);
  assert.match(rev, /button type="button" name="play" disabled/);
  assert.doesNotMatch(rev, /\sid="/, "no page-global ids, so two copies can share a page");
});
