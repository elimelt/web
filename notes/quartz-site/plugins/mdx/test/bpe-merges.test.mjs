// Checks the BPE figure's trainer against an independent Python reference
// (content/ml/nlp/reading/tokenization/bpe_reference.py), which applies
// merges with subword-nmt's regex replacement and counts pairs over every
// piece of the text. The fixture holds its merges for every preset, both
// base units and both pre-tokenizer rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { load } from "./load.mjs";

const m = await load("components/bpe-merges/model.ts");
const { PRESETS } = await load("components/bpe-merges/presets.ts");
const r = await load("components/bpe-merges/render.ts");
const fixture = JSON.parse(readFileSync(new URL("./bpe-merges.fixture.json", import.meta.url)));

test("merge sequence and token counts match the Python reference", () => {
  let checked = 0;
  for (const p of PRESETS)
    for (const unit of ["char", "byte"])
      for (const rule of ["gpt2", "o200k"]) {
        const ref = fixture[`${p.id}/${unit}/${rule}`];
        const tr = m.train(p.train, unit, rule, 200);
        assert.deepEqual(tr.merges.map((x) => [x.left, x.right, x.count]), ref.merges, `${p.id}/${unit}/${rule}`);
        assert.deepEqual(tr.steps.map((s) => s.tokens), ref.tokens);
        assert.equal(m.pieces(p.train, rule).length, ref.pieces[0]);
        assert.equal(m.pieces(p.apply, rule).length, ref.pieces[1]);
        checked += ref.merges.length;
      }
  assert.ok(checked > 2000);
});

test("pre-tokenization is lossless and replaying the merges reproduces training", () => {
  for (const p of PRESETS)
    for (const unit of ["char", "byte"])
      for (const rule of ["gpt2", "o200k"]) {
        assert.equal(m.pieces(p.train, rule).join(""), p.train);
        const tr = m.train(p.train, unit, rule, 200);
        for (const k of [0, 1, 7, 40, tr.merges.length]) {
          const seg = m.segmentation(tr, k);
          assert.deepEqual(m.encode(p.train, tr.merges, unit, rule, k), seg);
          const bytes = seg.flat().reduce((s, t) => s + m.byteLength(t, unit), 0);
          assert.equal(bytes, new TextEncoder().encode(p.train).length);
          assert.equal(seg.flat().length, tr.steps[k].tokens);
        }
      }
});

test("each merge removes at most its pair count of tokens (exactly, without overlaps), and counts never increase", () => {
  const tr = m.train(PRESETS[0].train, "char", "gpt2", 200);
  for (let k = 1; k < tr.steps.length; k++) {
    const drop = tr.steps[k - 1].tokens - tr.steps[k].tokens;
    const m0 = tr.merges[k - 1];
    if (m0.left !== m0.right) assert.equal(drop, m0.count);
    else assert.ok(drop >= 1 && drop <= m0.count);
    if (k > 1) assert.ok(tr.merges[k - 1].count <= tr.merges[k - 2].count);
  }
});

test("applyMerge merges whole symbols only, left to right", () => {
  assert.deepEqual(m.applyMerge(["ab", "c"], "b", "c"), ["ab", "c"]);
  assert.deepEqual(m.applyMerge(["a", "a", "a"], "a", "a"), ["aa", "a"]);
  assert.deepEqual(m.applyMerge(["a", "a", "a", "a"], "a", "a"), ["aa", "aa"]);
});

test("random texts: the trainer agrees with a brute-force recount at every step", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const alphabet = ["a", "b", "c", " ", "é", "ab"];
  for (let trial = 0; trial < 40; trial++) {
    let text = "";
    for (let i = 0; i < 60; i++) text += alphabet[Math.floor(rand() * alphabet.length)];
    const tr = m.train(text, "char", "gpt2", 50, 1);
    for (let k = 0; k < tr.merges.length; k++) {
      const seg = m.segmentation(tr, k);
      const counts = new Map();
      for (const w of seg) for (let i = 0; i + 1 < w.length; i++) {
        const key = w[i] + "\u0001" + w[i + 1];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const best = Math.max(...counts.values());
      assert.equal(tr.merges[k].count, best);
      assert.equal(counts.get(tr.merges[k].left + "\u0001" + tr.merges[k].right), best);
    }
  }
});

test("renders with its controls disabled", () => {
  const html = r.render({});
  assert.ok(!/<(button|input|select|textarea)(?![^>]*disabled)/.test(html));
  assert.match(html, /bp-chip/);
});
