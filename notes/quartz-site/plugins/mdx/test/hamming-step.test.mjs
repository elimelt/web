// Checks the Hamming figure's decoder against brute-force nearest-codeword
// decoding, exhaustively over every data word and every 1- and 2-bit error.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/hamming-step/model.ts");
const r = await load("components/hamming-step/render.ts");

const datas = Array.from({ length: 16 }, (_, v) => [3, 2, 1, 0].map((i) => (v >> i) & 1));
const dist = (a, b) => a.reduce((s, x, i) => s + (x !== b[i] ? 1 : 0), 0);

test("the code has minimum distance 3, or 4 extended", () => {
  for (const ext of [false, true]) {
    const words = datas.map((d) => m.encode(d, ext));
    let min = Infinity;
    for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) min = Math.min(min, dist(words[i], words[j]));
    assert.equal(min, ext ? 4 : 3);
  }
});

test("syndrome decoding equals nearest-codeword decoding for one flip", () => {
  for (const ext of [false, true]) {
    const words = datas.map((d) => m.encode(d, ext));
    for (const [di, w] of words.entries())
      for (let p = ext ? 0 : 1; p < 8; p++) {
        const bad = [...w];
        bad[p] ^= 1;
        const nearest = words.reduce((best, c) => (dist(c, bad) < dist(best, bad) ? c : best));
        const d = m.decode(bad, ext);
        assert.deepEqual(d.corrected, nearest);
        assert.deepEqual(d.data, datas[di]);
      }
  }
});

test("two flips: plain Hamming miscorrects every time, SECDED detects every time", () => {
  for (const d of datas)
    for (let a = 0; a < 8; a++)
      for (let b = a + 1; b < 8; b++) {
        if (a > 0) {
          const w = m.encode(d, false);
          w[a] ^= 1;
          w[b] ^= 1;
          const out = m.decode(w, false);
          assert.equal(out.action, "fix");
          assert.notDeepEqual(out.data, d);
        }
        const x = m.encode(d, true);
        x[a] ^= 1;
        x[b] ^= 1;
        assert.equal(m.decode(x, true).action, "detect");
      }
});

test("the scenarios show what the note says they show", () => {
  const tone = (id) => r.body(r.startView(m.scenarioById(id))).match(/data-tone="(\w+)"/)[1];
  assert.equal(tone("clean"), "ok");
  assert.equal(tone("one"), "ok");
  assert.equal(tone("two"), "missed");
  assert.equal(tone("secded"), "caught");
  assert.equal(m.decode(r.startView(m.scenarioById("two")).received, false).syn, 5);
});

test("renders with its controls disabled", () => {
  for (const id of ["clean", "secded"]) {
    const html = r.render({ scenario: id });
    assert.ok(!/<button(?![^>]*disabled)/.test(html));
  }
});
