// Checks the roofline figure against independent references: the summary it
// draws from must match the raw benchmark output recomputed here, the bound and
// intensity formulas must match brute-force counts, and the recorded points
// must sit under the roof they are drawn against.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/roofline-lab/model.ts");
const r = await load("components/roofline-lab/render.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/ml/serving-systems/performance-modeling/results");
const raw = (name) =>
  readFileSync(path.join(dir, name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

test("the summary matches the raw runs", () => {
  for (const t of [1, 4]) {
    const s = m.SUMMARY[String(t)];
    for (const p of raw("peak.jsonl").filter((x) => x.threads === t)) assert.equal(s.peaks[p.isa].median, p.gflops_median);
    const sweep = raw("sweep.jsonl").filter((x) => x.threads === t);
    assert.equal(sweep.length, 44);
    const level = (b) => ({ 32768: "L1", 1048576: "L2", 67108864: "L3", 2147483648: "DRAM" })[b / (b < 67108864 ? t : 1)];
    for (const lv of m.LEVELS) {
      const rows = sweep.filter((x) => level(x.bytes) === lv);
      assert.equal(rows.length, 11, `${t} ${lv}`);
      const best = Math.max(...rows.map((x) => x.gflops_median / x.intensity));
      assert.ok(Math.abs(best - s.bandwidth[lv]) < 0.01, `${t} ${lv} bandwidth`);
      for (const x of rows) assert.ok(Math.abs(x.intensity - x.fma_per_elem / 4) < 1e-9);
    }
    const gemm = raw("gemm.jsonl").filter((x) => x.threads === t && x.K === 16384);
    assert.deepEqual(s.gemm.openblas.map((p) => p.median), gemm.map((x) => x.gflops_median));
  }
});

test("the roof is min(peak, bandwidth × intensity) and the ridge is where the two meet", () => {
  for (const [peak, bw] of [[888, 78], [989e3, 3350], [1, 1]]) {
    const ri = m.ridge(peak, bw);
    assert.ok(Math.abs(m.roof(ri, peak, bw) - peak) < 1e-9 * peak);
    assert.ok(Math.abs(bw * ri - peak) < 1e-9 * peak);
    for (const i of [ri / 3, ri / 1.01]) assert.equal(m.roof(i, peak, bw), bw * i);
    for (const i of [ri * 1.01, ri * 50]) assert.equal(m.roof(i, peak, bw), peak);
  }
});

test("GEMM intensity matches a brute-force count of FLOPs and distinct operands", () => {
  for (const [M, K, N] of [[1, 8, 8], [3, 5, 7], [16, 4, 2]]) {
    let flops = 0;
    const touched = new Set();
    for (let i = 0; i < M; i++)
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < K; k++) {
          flops += 2;
          touched.add(`a${i},${k}`);
          touched.add(`b${k},${j}`);
        }
        touched.add(`c${i},${j}`);
      }
    for (const bytes of [2, 4]) assert.ok(Math.abs(m.gemmIntensity(M, K, N, bytes) - flops / (bytes * touched.size)) < 1e-12);
  }
  // With K = N ≫ M, intensity approaches M / 2 in FP32 and M in BF16.
  assert.ok(Math.abs(m.gemmIntensity(4, 1 << 20, 1 << 20, 4) - 2) < 1e-4);
  assert.ok(Math.abs(m.gemmIntensity(4, 1 << 20, 1 << 20, 2) - 4) < 1e-4);
});

test("decode attention intensity matches an explicit count for Llama 2 70B shapes", () => {
  const hq = 64, hkv = 8, dh = 128, c = 4096, S = 2;
  const flops = 2 * c * dh * hq /* q·k */ + 2 * c * dh * hq; /* p·v */
  const bytes = 2 * c * dh * hkv * S; /* K and V */
  assert.ok(Math.abs(m.decodeAttentionIntensity(hq / hkv, S) - flops / bytes) < 1e-12);
  assert.equal(m.decodeAttentionIntensity(m.LLAMA.group, 2), 8);
});

test("recorded points sit under the roof they are drawn against", () => {
  const peakMax = m.CPU.peaks.avx512.max;
  for (const lv of m.LEVELS)
    for (const p of m.CPU.sweep[lv]) assert.ok(p.median <= m.roof(p.intensity, peakMax, m.CPU.bandwidth[lv]) + 1e-9, `${lv} ${p.intensity}`);
  for (const s of ["openblas", "skinny"])
    for (const p of m.CPU.gemm[s]) assert.ok(p.median <= m.roof(p.intensity, peakMax, m.CPU.read.DRAM) * 1.02, `${s} ${p.M}`);
});

test("the numbers the note quotes", () => {
  const c = m.CPU;
  assert.equal(Math.round(c.peaks.avx512.median), 888);
  assert.equal(Math.round(c.bandwidth.DRAM), 78);
  assert.equal(Math.round(c.read.DRAM), 51);
  assert.equal(Math.round(m.ridge(m.H100.peak, m.H100.bw)), 295);
  assert.equal(m.gemmPoint("openblas", 1024).median, 522.68);
});

test("every preset renders a finished figure with its controls disabled until the script runs", () => {
  for (const preset of ["levels", "gemm", "h100", "bogus"]) {
    const html = r.render({ preset });
    assert.match(html, /<figure class="rl"/);
    assert.match(html, /<svg[^>]*role="img"/);
    assert.match(html, /disabled/);
    assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  }
  for (const lv of m.LEVELS) assert.doesNotMatch(r.levelsChart(lv) + r.levelsText(lv), /NaN|undefined/);
  for (const M of m.GEMM_M) assert.doesNotMatch(r.gemmChart(M) + r.gemmText(M), /NaN|undefined/);
  for (const M of m.H100_M) assert.doesNotMatch(r.h100Chart(M) + r.h100Text(M), /NaN|undefined/);
});
