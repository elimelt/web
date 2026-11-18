// Checks the retry lab's model against three independent references: brute
// enumeration of every sequence of send outcomes, a Monte Carlo run of the
// sampler the diagram uses, and the Linux measurements in
// rpc-experiments/sem-results.json (kernel drops on loopback).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/retry-lab/model.ts");
const r = await load("components/retry-lab/render.ts");
const { MEASURED } = await load("components/retry-lab/data.ts");
const { mulberry32 } = await load("shared/random.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(here, "../../../../content/systems/distributed-systems/rpc-experiments/sem-results.json"), "utf8"),
);

function enumerate(q, rr, sends, mode) {
  const p = { lost: q, orphan: (1 - q) * rr, success: (1 - q) * (1 - rr) };
  const ok = new Array(m.BINS).fill(0);
  const fail = new Array(m.BINS).fill(0);
  const walk = (i, k, prob) => {
    const execs = (x) => Math.min(mode === "amo" ? Math.min(x, 1) : x, m.BINS - 1);
    if (i === sends) {
      fail[execs(k)] += prob;
      return;
    }
    ok[execs(k + 1)] += prob * p.success;
    walk(i + 1, k, prob * p.lost);
    walk(i + 1, k + 1, prob * p.orphan);
  };
  walk(0, 0, 1);
  return { ok, fail };
}

test("distribution equals brute-force enumeration", () => {
  for (const mode of ["alo", "amo"])
    for (const q of [0, 0.05, 0.3, 0.7, 1])
      for (const rr of [0, 0.1, 0.5, 1])
        for (let sends = 1; sends <= 8; sends++) {
          const d = m.distribution({ q, r: rr, sends, mode });
          const e = enumerate(q, rr, sends, mode);
          for (let b = 0; b < m.BINS; b++) {
            assert.ok(Math.abs(d.ok[b] - e.ok[b]) < 1e-12, `${mode} ${q} ${rr} ${sends} ok[${b}]`);
            assert.ok(Math.abs(d.fail[b] - e.fail[b]) < 1e-12, `${mode} ${q} ${rr} ${sends} fail[${b}]`);
          }
          const total = d.ok.reduce((a, b) => a + b, 0) + d.fail.reduce((a, b) => a + b, 0);
          assert.ok(Math.abs(total - 1) < 1e-12);
        }
});

test("closed forms: success probability and mean executions", () => {
  for (const [q, rr, n] of [[0.2, 0.2, 4], [0.5, 0.1, 3], [0, 0.3, 6]]) {
    const s = (1 - q) * (1 - rr);
    const d = m.distribution({ q, r: rr, sends: n, mode: "alo" });
    assert.ok(Math.abs(d.pOk - (1 - (1 - s) ** n)) < 1e-12);
    // Each send happens with prob (1-s)^i and executes with prob 1-q.
    const sends = (1 - (1 - s) ** n) / s;
    assert.ok(Math.abs(d.meanSends - sends) < 1e-12);
    assert.ok(Math.abs(d.meanExec - (1 - q) * sends) < 1e-12);
    const amo = m.distribution({ q, r: rr, sends: n, mode: "amo" });
    assert.ok(Math.abs(amo.meanExec - (1 - q ** n)) < 1e-12);
    assert.equal(amo.pDup, 0);
  }
});

test("the sampler the diagram draws agrees with the distribution", () => {
  for (const mode of ["alo", "amo"]) {
    const p = { q: 0.2, r: 0.3, sends: 4, mode };
    const d = m.distribution(p);
    const u = mulberry32(11);
    const N = 200000;
    const counts = new Array(m.BINS).fill(0);
    let ok = 0;
    for (let i = 0; i < N; i++) {
      const t = m.sampleCall(p, u);
      counts[Math.min(t.executions, m.BINS - 1)]++;
      if (t.ok) ok++;
      assert.equal(t.executions, t.sends.filter((s) => s.executed).length);
      if (mode === "amo") assert.ok(t.executions <= 1);
    }
    for (let b = 0; b < m.BINS; b++) {
      const pb = d.ok[b] + d.fail[b];
      const sd = Math.sqrt((pb * (1 - pb)) / N);
      assert.ok(Math.abs(counts[b] / N - pb) < 5 * sd + 1e-9, `${mode} bin ${b}`);
    }
    assert.ok(Math.abs(ok / N - d.pOk) < 5 * Math.sqrt((d.pOk * (1 - d.pOk)) / N));
  }
});

test("embedded data has every loss setting from sem-results.json", () => {
  const settings = new Set(raw.results.filter((x) => !x.crash_ms).map((x) => `${x.mode} ${x.q} ${x.r}`));
  assert.equal(MEASURED.length, settings.size);
  for (const x of MEASURED) {
    assert.ok(settings.has(`${x.mode} ${x.q} ${x.r}`));
    assert.ok(m.LOSS_STEPS.includes(x.q) && m.LOSS_STEPS.includes(x.r));
    const runs = raw.results.filter((y) => !y.crash_ms && y.mode === x.mode && y.q === x.q && y.r === x.r);
    const mean = runs.reduce((a, y) => a + y.dup, 0) / runs.length;
    assert.ok(Math.abs(x.dup[0] - mean) < 1e-6);
  }
});

test("model predicts every measurement within sampling error", () => {
  for (const x of MEASURED) {
    const d = m.distribution({ q: x.q, r: x.r, sends: m.MEASURED_SENDS, mode: x.mode });
    const n = x.runs * x.calls;
    const check = (name, meas, pred) => {
      const sd = Math.sqrt(Math.max(pred * (1 - pred), 1 / n) / n);
      assert.ok(Math.abs(meas - pred) < 4 * sd, `${x.mode} q=${x.q} r=${x.r} ${name}: measured ${meas}, model ${pred}`);
    };
    check("ok", x.ok[0], d.pOk);
    check("dup", x.dup[0], d.pDup);
    check("failExec", x.failExec[0], d.pFailExecuted);
    for (let b = 0; b < m.BINS; b++) check(`hist${b}`, x.hist[b][0], d.ok[b] + d.fail[b]);
  }
});

test("render produces a complete, disabled figure and responds to props", () => {
  const html = r.render({ mode: "amo", q: 0.1, r: 0.3, seed: 5 });
  assert.match(html, /<figure class="rl" data-mode="amo" data-q="0.1" data-r="0.3" data-seed="5">/);
  assert.equal((html.match(/disabled/g) || []).length, 6);
  assert.match(html, /measured/);
  const bad = r.render({ q: 0.17 });
  assert.match(bad, /data-q="0.2"/);
  const s = r.initialState({});
  assert.equal(r.measuredFor({ ...s, sends: 3 }), undefined);
  assert.ok(r.ladder(s, r.W_NARROW).startsWith(`<svg viewBox="0 0 ${r.W_NARROW} `));
});
