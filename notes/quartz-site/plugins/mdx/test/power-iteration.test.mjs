// Checks the power iteration figure against closed forms. With A = Q diag(l) Q^T
// and x_0 = sum c_i q_i, the k-th iterate is proportional to sum c_i l_i^k q_i,
// so its angle to q_1 and its Rayleigh quotient follow from the coefficients
// alone, without running the iteration:
//   tan(theta_k) = sqrt(sum_{i>1} (c_i l_i^k)^2) / |c_1 l_1^k|
//   rho_k        = sum c_i^2 l_i^(2k+1) / sum c_i^2 l_i^(2k)
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/power-iteration/model.ts");
const r = await load("components/power-iteration/render.ts");

function closedForm(ratio, steps, seed = m.SEED, n = m.N) {
  const q = m.orthogonal(n, seed);
  const lam = m.spectrum(ratio, n);
  const x0 = m.startVector(n, seed);
  const c = new Array(n).fill(0);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) c[j] += q[i * n + j] * x0[i];
  const sin = [];
  const rho = [];
  for (let k = 0; k <= steps; k++) {
    // Scale by lam_1^k = 1 and work with logs to avoid underflow.
    let rest = 0;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const w = c[i] * lam[i] ** k;
      if (i > 0) rest += w * w;
      num += w * w * lam[i];
      den += w * w;
    }
    const tan = Math.sqrt(rest) / Math.abs(c[0]);
    sin.push(tan / Math.sqrt(1 + tan * tan));
    rho.push(num / den);
  }
  return { sin, rho };
}

test("the random eigenvector matrix is orthogonal", () => {
  for (const n of [5, 40]) {
    const q = m.orthogonal(n, 3);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += q[i * n + a] * q[i * n + b];
        assert.ok(Math.abs(dot - (a === b ? 1 : 0)) < 1e-13, `Q^T Q[${a},${b}] = ${dot}`);
      }
    }
  }
});

test("the spectrum has lambda_1 = 1, lambda_2 = r and every other |lambda| <= 0.8 r", () => {
  for (const ratio of [0.05, 0.5, 0.95, 1]) {
    const lam = m.spectrum(ratio);
    assert.equal(lam[0], 1);
    assert.equal(lam[1], ratio);
    for (let i = 2; i < lam.length; i++) assert.ok(Math.abs(lam[i]) <= 0.8 * ratio + 1e-15);
  }
});

test("the measured iteration matches the closed form step by step", () => {
  for (const [ratio, steps] of [[0.3, 40], [0.5, 60], [0.8, 120], [0.95, 500], [0.99, 500]]) {
    const run = m.run(ratio, steps);
    const ref = closedForm(ratio, steps);
    for (let k = 0; k <= steps; k++) {
      const want = Math.max(m.FLOOR, ref.sin[k]);
      // Relative agreement while far above rounding, absolute near it.
      // sin(theta) from vectors carries about 1e-16 of absolute rounding.
      const tol = Math.max(1e-7 * want, 1e-15);
      assert.ok(Math.abs(run.vector[k] - want) <= tol, `r=${ratio} k=${k}: ${run.vector[k]} vs ${want}`);
      const wantVal = Math.max(m.FLOOR, Math.abs(ref.rho[k] - 1));
      // rho_k - 1 loses digits to rounding in rho_k itself, about 1e-16 absolute.
      const tolVal = Math.max(1e-6 * wantVal, 1e-14);
      assert.ok(Math.abs(run.value[k] - wantVal) <= tolVal, `r=${ratio} k=${k} value: ${run.value[k]} vs ${wantVal}`);
    }
  }
});

test("the error shrinks by r per step and the eigenvalue error by r^2", () => {
  for (const ratio of [0.3, 0.5, 0.8, 0.9]) {
    const run = m.run(ratio, 400);
    assert.ok(Math.abs(run.rate - ratio) < 0.02 * ratio, `rate ${run.rate} for r=${ratio}`);
    if (ratio >= 0.5) {
      // The eigenvalue error mixes r^2 with faster terms early on, so measure its tail;
      // for small r it reaches rounding before the r^2 term dominates.
      const valueRate = m.measuredRate(run.value, 1e-13, 1e-6);
      assert.ok(Math.abs(valueRate - ratio ** 2) < 0.05 * ratio ** 2, `value rate ${valueRate} for r=${ratio}`);
    }
    assert.ok(run.stepsVector <= run.stepsBound, `measured ${run.stepsVector} within bound ${run.stepsBound}`);
  }
});

test("r = 1 never converges, and the readout says so", () => {
  const run = m.run(1, 500);
  assert.equal(run.stepsVector, null);
  assert.equal(run.stepsBound, null);
  assert.ok(run.vector[500] > 1e-3, `stuck at ${run.vector[500]}`);
  assert.match(r.readoutText(run, m.presetById("narrow")), /stops shrinking/);
});

test("each preset renders a disabled slider at its own ratio", () => {
  for (const p of m.PRESETS) {
    const html = r.render({ preset: p.id });
    assert.match(html, new RegExp(`data-preset="${p.id}"`));
    assert.match(html, new RegExp(`value="${p.ratio}" [^>]*disabled`));
    assert.equal(html.includes("pi-value"), p.rayleigh);
  }
  assert.match(r.render({}), /data-preset="gap"/);
});
