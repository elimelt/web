// Checks that the speculative decoding figures compute what they claim: the
// recorded rounds obey the acceptance rule, the residual is the one the
// replacement token was drawn from, and the charts plot the formulas and
// measurements in results.json.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "spec-decode-"));
after(() => rmSync(dir, { recursive: true, force: true }));

async function load(entry) {
  const outfile = path.join(dir, `${path.basename(entry, ".ts")}.mjs`);
  await esbuild.build({ entryPoints: [path.join(here, "../src/components/spec-decode", entry)], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

const model = await load("model.ts");
const render = await load("render.ts");

test("expected tokens is the geometric sum 1 + α + ... + α^γ", () => {
  for (const a of [0, 0.3, 0.7, 0.95]) {
    for (let g = 1; g <= 8; g++) {
      let sum = 0;
      for (let i = 0; i <= g; i++) sum += a ** i;
      assert.ok(Math.abs(model.expectedTokens(a, g) - sum) < 1e-12);
    }
  }
  assert.equal(model.expectedTokens(1, 4), 5);
  assert.ok(Math.abs(model.speedup(0.8, 4, 0.1, 1) - model.expectedTokens(0.8, 4) / 1.4) < 1e-12);
});

test("every recorded round follows the acceptance rule", () => {
  for (const d of model.domains) {
    const t = model.traces[d];
    assert.ok(t.rounds.length >= 20, `${d}: ${t.rounds.length} rounds`);
    for (const [k, r] of t.rounds.entries()) {
      const g = r.drafted.length;
      assert.equal(g, 4);
      assert.deepEqual(r.emitted.slice(0, -1), r.drafted.slice(0, r.accepted), `${d} round ${k}`);
      // Positions are checked up to and including the first rejection.
      assert.equal(r.positions.length, Math.min(g, r.accepted + 1));
      r.positions.forEach((pos, i) => {
        assert.equal(pos.x, r.drafted[i]);
        assert.equal(model.accepts(pos), i < r.accepted, `${d} round ${k} position ${i}`);
        assert.ok(pos.alpha >= 0 && pos.alpha <= 1 + 1e-9);
        // The stored tokens are a subset of the vocabulary, so their overlap can't exceed the full one.
        const shown = pos.top.reduce((s, [, p, q]) => s + Math.min(p, q), 0);
        assert.ok(shown <= pos.alpha + 1e-4, `${shown} > ${pos.alpha}`);
        const x = pos.top.find(([id]) => id === pos.x);
        assert.ok(x && Math.abs(x[1] - pos.px) < 1e-5 && Math.abs(x[2] - pos.qx) < 1e-5);
      });
      if (r.accepted === g) assert.ok(r.bonus_top.some(([id]) => id === r.emitted[g]));
    }
  }
});

test("a rejected position's replacement has positive residual mass and the rejected token has none", () => {
  let rejections = 0;
  for (const d of model.domains) {
    for (const r of model.traces[d].rounds) {
      if (r.accepted === r.drafted.length) continue;
      rejections++;
      const pos = r.positions[r.accepted];
      const fix = r.emitted[r.emitted.length - 1];
      const row = pos.top.find(([id]) => id === fix);
      assert.ok(row, "replacement is among the stored tokens");
      assert.ok(model.residual(pos, row[1], row[2]) > 0);
      // Rejection needs u >= q/p, which needs q < p, so the drafted token leaves no residual.
      assert.ok(pos.qx < pos.px);
      assert.equal(model.residual(pos, pos.px, pos.qx), 0);
      const mass = pos.top.reduce((s, [, p, q]) => s + model.residual(pos, p, q), 0);
      assert.ok(mass <= 1 + 1e-3, `residual mass ${mass}`);
    }
  }
  assert.ok(rejections > 10);
});

test("measured tokens per pass lie between 1 and γ + 1 and match the acceptance rate", () => {
  for (const [key, run] of Object.entries(model.results.runs)) {
    for (const [g, row] of Object.entries(run.gamma)) {
      assert.ok(row.tokens_per_round >= 1 && row.tokens_per_round <= Number(g) + 1, `${key} γ=${g}`);
      // tokens per round = 1 + (accepted drafts per round) = 1 + γ · accept rate, averaged per run.
      assert.ok(Math.abs(row.tokens_per_round - (1 + Number(g) * row.accept_rate)) < 1e-9, `${key} γ=${g}`);
    }
  }
});

test("the speedup chart's prediction uses the measured pass costs", () => {
  const c = model.measuredCosts("1");
  const costs = model.results.costs["1"];
  assert.ok(Math.abs(c.c - costs.draft[0] / costs.target[0]) < 1e-12);
  assert.ok(Math.abs(c.v(4) - costs.target[4] / costs.target[0]) < 1e-12);
});

test("the decoding acceptance rate is the share of drafts kept at γ = 1", () => {
  for (const [key, run] of Object.entries(model.results.runs)) {
    // At γ = 1 a round emits 1 token plus the draft if it was kept.
    assert.ok(Math.abs(model.decodingAlpha(key) - (run.gamma["1"].tokens_per_round - 1)) < 1e-9, key);
  }
});

test("every figure state renders", () => {
  for (const d of model.domains) {
    const n = model.traces[d].rounds.length;
    for (let round = 0; round < n; round++) {
      const r = model.traces[d].rounds[round];
      for (let sel = 0; sel <= r.drafted.length; sel++) {
        const p = render.replayParts({ domain: d, round, sel });
        assert.match(p.counter, new RegExp(`Round ${round + 1} of ${n}`));
        assert.ok(!p.dist.includes("NaN") && !p.table.includes("NaN") && !p.summary.includes("undefined"));
      }
    }
    for (const temp of ["0", "1"]) {
      for (const batch of ["1", "4", "16", "64"]) {
        const p = render.speedParts({ domain: d, temp, batch });
        assert.ok(p.speed.startsWith("<svg") && !p.speed.includes("NaN") && !p.tokens.includes("NaN"));
      }
    }
  }
  assert.ok(render.renderReplay().startsWith('<figure class="sd sd-replay"'));
  assert.ok(render.renderSpeedup().startsWith('<figure class="sd sd-speed"'));
});

test("token labels make whitespace visible and escape HTML", () => {
  assert.equal(render.label(" if"), "␣if");
  assert.equal(render.label("\n    "), "↵␣␣␣␣");
  assert.equal(render.label("<a>"), "&lt;a&gt;");
});
