// Checks the stale-read figure's Monte Carlo model against three independent
// references: an exact closed form for exponential write delays, the Python
// simulator beside the note (dynamo-experiments/figure-reference.json, a
// separate implementation with its own random numbers), and the values
// Bailis et al. (VLDB 2012) publish for the same latency fits.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/stale-reads/model.ts");
const r = await load("components/stale-reads/render.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(
  readFileSync(path.join(here, "../../../../content/systems/distributed-systems/dynamo-experiments/figure-reference.json"), "utf8"),
);

const comb = (n, k) => {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
};

// With W ~ Exp(lam) and A = R = S = 0, the write commits when the W-th replica
// has it; each of the other N - W has it t later with probability
// 1 - exp(-lam t), independently; the read quorum is a uniform R-subset.
function exactExp(N, R, W, lam, t) {
  const p = 1 - Math.exp(-lam * t);
  let sum = 0;
  for (let j = 0; j <= N - W; j++) sum += comb(N - W, j) * p ** j * (1 - p) ** (N - W - j) * (comb(N - W - j, R) / comb(N, R));
  return sum;
}

const zero = { wp: 1, xm: 0, alpha: 1, lam: 1 };
const EXP = { label: "test", w: { wp: 0, xm: 1, alpha: 1, lam: 0.1 }, a: zero, r: zero, s: zero, wan: false };

const within = (p, q, se, name) => assert.ok(Math.abs(p - q) <= 4.5 * se + 1e-9, `${name}: ${p} against ${q} (se ${se})`);

test("exponential writes: the model matches the closed form", () => {
  const times = [0, 2, 5, 10, 20, 40];
  for (const [N, R, W] of [
    [3, 1, 1],
    [3, 1, 2],
    [5, 2, 1],
    [5, 1, 3],
    [7, 2, 2],
  ]) {
    const res = m.simulate({ profile: EXP, N, R, W, f: 0, trials: 60000, seed: 11, times });
    times.forEach((t, k) => {
      const q = exactExp(N, R, W, 0.1, t);
      const p = res.stale[k] / res.ok[k];
      within(p, q, Math.sqrt((q * (1 - q)) / res.ok[k]), `N=${N} R=${R} W=${W} t=${t}`);
    });
  }
  // The N = 3, R = W = 1 case is (2/3) exp(-lam t).
  assert.ok(Math.abs(exactExp(3, 1, 1, 0.1, 7) - (2 / 3) * Math.exp(-0.7)) < 1e-12);
});

test("the model agrees with the independent Python simulator", () => {
  assert.equal(ref.outage_ms, m.OUTAGE_MS);
  assert.equal(ref.hint_delay_ms, m.HINT_MS);
  for (const [i, c] of ref.cases.entries()) {
    const res = m.simulate({ profile: m.PROFILES[c.profile], N: c.N, R: c.R, W: c.W, f: c.f, trials: 100000, seed: 100 + i, times: [c.t_ms] });
    const p = res.stale[0] / res.ok[0];
    const se = Math.sqrt((p * (1 - p)) / res.ok[0] + (c.p * (1 - c.p)) / c.trials);
    within(p, c.p, se, `${c.profile} N=${c.N} R=${c.R} W=${c.W} f=${c.f} t=${c.t_ms}`);
  }
});

test("immediate consistency matches the values Bailis et al. report for N = 3, R = W = 1", () => {
  // Section 5.5: 97.4% (LNKD-SSD), 43.9% (LNKD-DISK), 89.3% (YMMR), 33% (WAN).
  for (const [prof, published] of [
    ["LNKD-SSD", 0.974],
    ["LNKD-DISK", 0.439],
    ["YMMR", 0.893],
    ["WAN", 0.33],
  ]) {
    const res = m.simulate({ profile: m.PROFILES[prof], N: 3, R: 1, W: 1, f: 0, trials: 100000, seed: 5, times: [0] });
    const consistent = 1 - res.stale[0] / res.ok[0];
    assert.ok(Math.abs(consistent - published) < 0.01, `${prof}: ${consistent}`);
  }
});

test("without failures, R + W > N never reads stale, and staleness only falls with time", () => {
  for (const prof of m.PROFILE_KEYS) {
    for (const [N, R, W] of [
      [3, 2, 2],
      [3, 1, 3],
      [5, 3, 3],
      [5, 4, 2],
    ]) {
      const res = m.simulate({ profile: m.PROFILES[prof], N, R, W, f: 0, trials: 5000, seed: 3 });
      assert.ok(res.stale.every((s) => s === 0), `${prof} ${N}${R}${W}`);
    }
    const weak = m.simulate({ profile: m.PROFILES[prof], N: 3, R: 1, W: 1, f: 0, trials: 5000, seed: 3 });
    for (let k = 1; k < weak.times.length; k++) assert.ok(weak.stale[k] <= weak.stale[k - 1]);
  }
});

test("with failures, sloppy (3, 2, 2) can read stale, and writes always find W nodes", () => {
  const res = m.run({ profile: "LNKD-DISK", N: 3, R: 2, W: 2, f: 0.1 }, 20000, 9);
  assert.equal(res.writeFailed, 0);
  assert.ok(res.stale[res.times.length - 1] > 0);
});

test("the figure renders every preset, deterministically, with controls disabled", () => {
  for (const key of Object.keys(m.PRESETS)) {
    const html = r.render({ preset: key });
    assert.equal(html, r.render({ preset: key }));
    assert.match(html, new RegExp(`data-preset="${key}"`));
    assert.ok(m.TIMES.includes(m.PRESETS[key].t));
    for (const tag of html.match(/<(input|select)[^>]*>/g)) assert.match(tag, /disabled/);
    // The controls sit in a form and carry no ids, so two copies on a page stay independent.
    assert.match(html, /<form class="sr-controls">/);
    assert.doesNotMatch(html, / id="/);
    // Points stay inside the plot.
    for (const [, cx, cy] of html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)) {
      assert.ok(+cx >= r.M.left && +cx <= r.W - r.M.right && +cy >= r.M.top && +cy <= r.H - r.M.bottom);
    }
  }
  assert.match(r.render({ preset: "nope" }), /data-preset="quorum"/);
  assert.deepEqual(m.clampSetting({ profile: "YMMR", N: 2, R: 5, W: 0, f: 0 }), { profile: "YMMR", N: 2, R: 2, W: 1, f: 0 });
});

test("the readout reports the run it shows", () => {
  const st = { profile: "LNKD-DISK", N: 3, R: 1, W: 1, f: 0 };
  const res = m.run(st, 20000, 4);
  const k = m.TIMES.indexOf(10);
  const html = r.readout(st, res, k);
  assert.match(html, new RegExp(`${res.stale[k].toLocaleString("en-US")} of ${res.ok[k].toLocaleString("en-US")}`));
  assert.match(html, /R \+ W = 2 ≤ N = 3/);
  const below = m.timeBelow(res);
  const pBelow = (t) => res.stale[m.TIMES.indexOf(t)] / res.ok[m.TIMES.indexOf(t)];
  assert.ok(pBelow(below) < 0.001);
  for (const t of m.TIMES.filter((t) => t < below).slice(-1)) assert.ok(pBelow(t) >= 0.001);
});
