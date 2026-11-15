// Checks the counter predictor figure. Its outcome windows must be exactly
// what pick_branches.py cut from the recorded gzip trace, and the in-browser
// counters must agree with two independent references: the closed form for a
// 1-bit counter (it misses exactly when an outcome differs from the one
// before) and a literal 2-bit transition table.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const lab = path.join(here, "../../../../content/hardware/computer-architecture/branch-prediction-lab");
const windows = JSON.parse(readFileSync(path.join(lab, "figure-windows.json"), "utf8"));

const model = await load("components/counter-predictor/model.ts");
const { render } = await load("components/counter-predictor/render.ts");
const { mulberry32 } = await load("shared/random.ts");

// Next state of a 2-bit counter, written out as a table: [not taken, taken].
const TABLE = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
];

function reference2(start, outcomes) {
  let s = start;
  let misses = 0;
  for (const c of outcomes) {
    const t = c === "T" ? 1 : 0;
    if ((s >= 2 ? 1 : 0) !== t) misses++;
    s = TABLE[s][t];
  }
  return misses;
}

function reference1(start, outcomes) {
  let prev = start === 1 ? "T" : "N";
  let misses = 0;
  for (const c of outcomes) {
    if (c !== prev) misses++;
    prev = c;
  }
  return misses;
}

const misses = (bits, start, outcomes) => model.replay(bits, start, outcomes).filter((s) => !s.hit).length;

test("the presets are the recorded windows, unchanged", () => {
  assert.deepEqual(Object.keys(model.presets).sort(), Object.keys(windows).sort());
  for (const [key, w] of Object.entries(windows)) {
    const p = model.presets[key];
    assert.equal(p.outcomes, w.outcomes, key);
    assert.equal(p.offset, w.offset, key);
    assert.deepEqual({ 1: p.start[1], 2: p.start[2] }, { 1: w.start["1"], 2: w.start["2"] }, key);
    assert.deepEqual(p.whole, w.whole, key);
    assert.equal(p.outcomes.length, 64);
  }
});

test("a period-8 pattern costs a 1-bit counter two misses per period and a 2-bit counter one", () => {
  const p = model.presets.loop;
  assert.equal(misses(1, p.start[1], p.outcomes), 16);
  assert.equal(misses(2, p.start[2], p.outcomes), 8);
});

test("the counters match the independent references on the presets and on random sequences", () => {
  for (const p of Object.values(model.presets)) {
    assert.equal(misses(1, p.start[1], p.outcomes), reference1(p.start[1], p.outcomes));
    assert.equal(misses(2, p.start[2], p.outcomes), reference2(p.start[2], p.outcomes));
  }
  const rand = mulberry32(7);
  for (let trial = 0; trial < 500; trial++) {
    const bias = rand();
    const len = 1 + Math.floor(rand() * 80);
    let seq = "";
    for (let i = 0; i < len; i++) seq += rand() < bias ? "T" : "N";
    const s1 = rand() < 0.5 ? 0 : 1;
    const s2 = Math.floor(rand() * 4);
    assert.equal(misses(1, s1, seq), reference1(s1, seq));
    assert.equal(misses(2, s2, seq), reference2(s2, seq));
  }
});

test("the build renders the finished replay with its controls disabled", () => {
  for (const preset of Object.keys(model.presets)) {
    for (const bits of [1, 2]) {
      const html = render({ preset, bits });
      assert.equal((html.match(/<li class="cp-cell/g) ?? []).length, 64);
      assert.equal((html.match(/cp-future/g) ?? []).length, 0);
      assert.equal((html.match(/class="cp-state cp-/g) ?? []).length, bits === 1 ? 2 : 4);
      assert.equal((html.match(/ disabled>/g) ?? []).length, 2);
      const p = model.presets[preset];
      const m = misses(bits, p.start[bits], p.outcomes);
      assert.match(html, new RegExp(`${m} misses in 64 outcomes`));
    }
  }
});

test("unknown attributes fall back to a valid figure", () => {
  const html = render({ preset: "nope", bits: 9 });
  assert.match(html, /data-preset="loop" data-bits="2"/);
});
