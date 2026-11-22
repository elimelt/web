// The MinHash and LSH figure against an independent Python implementation of
// the same banding on the same recorded pairs
// (content/algorithms/probabilistic/minhash-experiments/figure_ref.py), and
// against the probabilities banding and MinHash claim: each bin's candidate
// share near the S-curve, and MinHash estimates with error near sqrt(J(1-J)/k).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/algorithms/probabilistic/minhash-experiments");
const ref = JSON.parse(readFileSync(path.join(dir, "figure-check.json"), "utf8"));
const initial = JSON.parse(readFileSync(path.join(dir, "initial.json"), "utf8"));
const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8"));
const m = await load("components/minhash-lsh/model.ts");
const r = await load("components/minhash-lsh/render.ts");
const pairs = m.decode(new Uint8Array(gunzipSync(readFileSync(path.join(dir, "pairs.bin.gz")))));

test("the decoded pairs match the reference", () => {
  assert.equal(pairs.n, ref.n);
  assert.equal(pairs.n, meta.pairs);
  for (let i = 0; i < pairs.n; i++) assert.equal(pairs.J[i], Math.fround(ref.J[i]), `pair ${i}`);
  // 100 pairs were drawn from each similarity bin of width 0.05; a pair at
  // exactly 0.65 is stored as the float32 just below it and lands one bin down.
  const counts = new Array(m.BINS).fill(0);
  for (const j of pairs.J) counts[Math.min(m.BINS - 1, Math.floor(j * m.BINS))]++;
  for (const c of counts) assert.ok(c >= 99 && c <= 101, String(counts));
});

test(`${ref.cases.length} band settings match the reference pair by pair`, () => {
  for (const c of ref.cases) {
    const what = `b=${c.b} r=${c.r}`;
    const out = m.evaluate(pairs, c.b, c.r);
    const cand = [];
    out.candidate.forEach((x, i) => x && cand.push(i));
    assert.deepEqual(cand, c.candidates, `${what}: candidates`);
    for (let i = 0; i < pairs.n; i++) assert.equal(m.matches(pairs, i, c.b * c.r), c.matches[i], `${what}: matches ${i}`);
    out.bins.forEach((bin, j) => {
      assert.equal(bin.pairs, c.bins[j].pairs, `${what}: bin ${j} pairs`);
      assert.equal(bin.candidates, c.bins[j].candidates, `${what}: bin ${j} candidates`);
      assert.ok(Math.abs(bin.theory - c.bins[j].theory) < 1e-6, `${what}: bin ${j} theory`);
    });
  }
});

test("more than K hash functions is refused, and the bands are clamped to fit", () => {
  assert.throws(() => m.evaluate(pairs, 33, 8));
  assert.equal(m.clampBands(256, 8), 32);
  assert.equal(m.clampBands(5, 50), 5);
  assert.equal(m.clampBands(1, 300), 1);
});

test("each bin's candidate share is within 4 standard deviations of the S-curve", () => {
  for (const [b, r] of [[32, 8], [20, 10], [64, 4], [16, 16], [128, 2]]) {
    for (const bin of m.evaluate(pairs, b, r).bins) {
      const p = bin.theory;
      const sd = Math.sqrt(Math.max(p * (1 - p), 1e-4) / bin.pairs);
      assert.ok(Math.abs(bin.candidates / bin.pairs - p) <= 4 * sd + 0.01, `b=${b} r=${r} bin ${bin.lo}: ${bin.candidates} of ${bin.pairs}, expected ${p}`);
    }
  }
});

test("MinHash estimates are unbiased with error near sqrt(J(1 - J)/k)", () => {
  for (const k of [16, 64, 256]) {
    let err = 0;
    let sq = 0;
    let theory = 0;
    for (let i = 0; i < pairs.n; i++) {
      const e = m.matches(pairs, i, k) / k - pairs.J[i];
      err += e;
      sq += e * e;
      theory += (pairs.J[i] * (1 - pairs.J[i])) / k;
    }
    const rmse = Math.sqrt(sq / pairs.n);
    const expect = Math.sqrt(theory / pairs.n);
    assert.ok(Math.abs(err / pairs.n) < (5 * expect) / Math.sqrt(pairs.n), `k=${k}: mean error ${err / pairs.n}`);
    assert.ok(Math.abs(rmse / expect - 1) < 0.1, `k=${k}: RMSE ${rmse} against ${expect}`);
  }
});

test("the build-time view is the reference's default setting", () => {
  const out = m.evaluate(pairs, initial.b, initial.r);
  assert.deepEqual(Array.from(out.candidate), initial.candidate);
  const html = r.render({ base: "/x/" });
  assert.ok(html.includes('data-base="/x/"'));
  assert.equal((html.match(/<svg/g) || []).length, 2);
  const v = r.initialView();
  assert.equal(v.J.length, pairs.n);
  assert.ok(r.readout(v).includes("On the full crawl"));
});
