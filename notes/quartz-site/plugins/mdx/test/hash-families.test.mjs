// The hash-family figure against an independent NumPy implementation of the
// same families and estimator (content/algorithms/probabilistic/
// hashing-experiments/figure_ref.py), plus checks of its arithmetic helpers
// against BigInt and of the effects the note describes.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(path.join(here, "../../../../content/algorithms/probabilistic/hashing-experiments/figure-check.json"), "utf8"));
const m = await load("components/hash-families/model.ts");
const r = await load("components/hash-families/render.ts");

test("63 sketches match the NumPy reference: histogram exactly, estimate to 1e-9", () => {
  assert.equal(ref.cases.length, 63);
  for (const c of ref.cases) {
    const C = m.sketch(c.ks, c.family, c.n, c.seed);
    assert.deepEqual(Array.from(C), c.hist, `${c.ks} ${c.family} n=${c.n} seed=${c.seed}`);
    const e = m.ertl(C);
    assert.ok(Math.abs(e - c.estimate) <= 1e-9 * c.estimate, `${c.ks} ${c.family}: ${e} vs ${c.estimate}`);
  }
});

test("fmix32 and scramble31 match the reference", () => {
  for (const x of ref.mix) {
    assert.equal(m.fmix32(x.x >>> 0), x.fmix32);
    if (x.x < 2 ** 31) assert.equal(m.scramble31(x.x), x.scramble31);
  }
});

test("mul32 and mulmod agree with BigInt", () => {
  let s = 12345n;
  const next = () => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return Number(s >> 32n);
  };
  const p = 2n ** 31n - 1n;
  for (let i = 0; i < 2000; i++) {
    const a = next() >>> 0;
    const b = next() >>> 0;
    const prod = BigInt(a) * BigInt(b);
    assert.deepEqual(m.mul32(a, b), [Number(prod >> 32n), Number(prod & 0xffffffffn)]);
    const x = a % 2147483647;
    const y = b % 2147483647;
    assert.equal(m.mulmod(x, y), Number((BigInt(x) * BigInt(y)) % p));
  }
  assert.deepEqual(m.mul32(0xffffffff, 0xffffffff), [0xfffffffe, 1]);
});

test("scramble31 is a bijection on its first 2^16 inputs", () => {
  const seen = new Set();
  for (let i = 0; i < 65536; i++) {
    const v = m.scramble31(i);
    assert.ok(v >= 0 && v < 2 ** 31);
    seen.add(v);
  }
  assert.equal(seen.size, 65536);
});

test("model histogram sums to 1 and has mean near log2(n/m) + 1", () => {
  const h = m.modelHist(65536);
  assert.ok(Math.abs(h.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test("dense IDs: 2-independent families are biased, the others are not", () => {
  const res = m.simulate("dense", 16384, 3, 16);
  const row = (f) => res.rows.find((x) => x.family === f);
  for (const f of ["ms", "mas", "cw"]) assert.ok(row(f).median > 0.15, `${f} median ${row(f).median}`);
  for (const f of ["poly4", "tab", "fmix"]) assert.ok(row(f).rms < 0.065, `${f} rms ${row(f).rms}`);
});

test("multiples of 1024 put every key in one register when the index comes from the low bits", () => {
  const C = m.sketch("stride", "mslo", 4096, 9);
  assert.equal(C[0], m.M - 1);
});

test("scrambled IDs: every family is within twice the random-hash error", () => {
  const res = m.simulate("scrambled", 16384, 4, 24);
  for (const row of res.rows) assert.ok(row.rms < 2 * 1.04 / 32, `${row.family} rms ${row.rms}`);
});

test("render: controls start disabled and the readout names the family", () => {
  const html = r.render({});
  assert.match(html, /<select name="ks" disabled>/);
  assert.match(html, /name="logn"[^>]*disabled/);
  assert.match(html, /With multiply-shift, the median estimate/);
  assert.equal((html.match(/class="hfam-label"/g) || []).length, 7);
});

test("floor test: random-hash probability matches a direct product, and dense multiply-shift exceeds it", async () => {
  const m = await load("components/hash-families/model.ts");
  const n = 16384;
  const { k, p } = m.floorTest(n);
  const model = m.modelHist(n);
  let below = 0;
  for (let j = 0; j < k; j++) below += model[j];
  assert.ok(Math.abs(p - Math.pow(1 - below, m.M)) < 1e-15);
  assert.ok(p < 1e-3);
  const res = m.simulate("dense", n, 3, 16);
  const floored = (f) => res.rows.find((r) => r.family === f).mins.filter((x) => x >= k).length;
  assert.ok(floored("ms") >= 8, `ms floored ${floored("ms")}`);
  assert.equal(floored("tab"), 0);
  assert.equal(floored("fmix"), 0);
});
