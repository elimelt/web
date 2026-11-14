// Checks the checksum figure's model against two independent references:
// the checksum the real sender wrote into the captured header, and a second
// implementation that sums with plain integers and reduces mod 0xFFFF.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/checksum-sum/model.ts");
const r = await load("components/checksum-sum/render.ts");

// Ones' complement sum as a plain integer reduced mod 0xFFFF, with 0 read as
// 0xFFFF unless every word is zero (the two zeros of ones' complement).
function reference(words) {
  const total = words.reduce((a, b) => a + b, 0);
  const v = total % 0xffff;
  return v === 0 && total > 0 ? 0xffff : v;
}

test("reproduces the checksum the sender put in the captured header", () => {
  assert.equal(m.checksumFor(m.HEADER), 0x0dd0);
  assert.equal(m.HEADER[5], 0x0dd0);
  assert.ok(m.passes(m.HEADER));
});

test("running sums agree with the integer reference", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 0xffff;
  for (let t = 0; t < 500; t++) {
    const words = Array.from({ length: 1 + (t % 20) }, rand);
    const sums = m.runningSums(words);
    sums.forEach((s, i) => assert.equal(s, reference(words.slice(0, i + 1))));
  }
});

test("every single-bit flip in the header is caught", () => {
  for (let w = 0; w < 10; w++)
    for (let b = 0; b < 16; b++) {
      const words = [...m.HEADER];
      words[w] ^= 1 << b;
      assert.equal(m.passes(words), false, `word ${w} bit ${b}`);
    }
});

test("the scenarios show what the note says they show", () => {
  const s = m.SCENARIOS;
  assert.equal(r.verdict(s.clean.words).tone, "ok");
  assert.equal(r.verdict(s.flip.words).tone, "caught");
  assert.equal(m.changedBits(s.cancel.words).length, 2);
  assert.equal(r.verdict(s.cancel.words).tone, "missed");
  assert.equal(m.addr(s.cancel.words[8], s.cancel.words[9]), "172.16.5.11");
  assert.equal(r.verdict(s.swap.words).tone, "missed");
  assert.equal(m.addr(s.swap.words[8], s.swap.words[9]), "172.16.5.1");
});

test("renders a finished figure with its controls disabled", () => {
  const html = r.render({ scenario: "cancel" });
  assert.equal((html.match(/class="cs-bit[ "]/g) || []).length, 160);
  assert.equal((html.match(/cs-flipped/g) || []).length, 2);
  assert.ok(!/<button(?![^>]*disabled)/.test(html));
  assert.match(html, /data-scenario="cancel"/);
});
