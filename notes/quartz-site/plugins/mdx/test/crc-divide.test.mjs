// Checks the CRC figure's long division against BigInt polynomial
// arithmetic and against the published CRC-16/XMODEM check value.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/crc-divide/model.ts");
const r = await load("components/crc-divide/render.ts");

const toInt = (bits) => bits.reduce((a, b) => (a << 1n) | BigInt(b), 0n);
function polyMod(a, g) {
  const dg = g.toString(2).length - 1;
  while (a.toString(2).length - 1 >= dg && a !== 0n) a ^= g << BigInt(a.toString(2).length - 1 - dg);
  return a;
}

test("remainders match BigInt polynomial division", () => {
  let seed = 3;
  const bit = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 30) & 1;
  for (const g of ["1011", "10011", "11", "11000000100110001"]) {
    const gen = m.bits(g);
    for (let t = 0; t < 200; t++) {
      const msg = Array.from({ length: 1 + (t % 30) }, bit);
      const rem = m.checkBits(msg, gen);
      const want = polyMod(toInt(msg) << BigInt(gen.length - 1), toInt(gen));
      assert.equal(toInt(rem), want);
      assert.ok(m.divide([...msg, ...rem], gen).remainder.every((b) => b === 0));
    }
  }
});

test("generator 0x11021 gives the CRC-16/XMODEM check value", () => {
  const msg = [..."123456789"].flatMap((c) => [...c.charCodeAt(0).toString(2).padStart(8, "0")].map(Number));
  const rem = m.checkBits(msg, m.bits("10001000000100001"));
  assert.equal(Number(toInt(rem)), 0x31c3);
});

test("x + 1 as the generator is a parity bit", () => {
  for (let v = 0; v < 256; v++) {
    const msg = [...v.toString(2).padStart(8, "0")].map(Number);
    assert.deepEqual(m.checkBits(msg, [1, 1]), [msg.reduce((a, b) => a ^ b, 0)]);
  }
});

test("every burst up to the degree is caught; generator multiples are not", () => {
  const s = m.SCENARIOS.clean;
  const n = m.codeword(s).length;
  const k = s.gen.length - 1;
  for (let len = 1; len <= k; len++)
    for (let start = 0; start + len <= n; start++)
      for (let inner = 0; inner < 1 << Math.max(0, len - 2); inner++) {
        const errs = [start];
        for (let j = 1; j < len - 1; j++) if ((inner >> (j - 1)) & 1) errs.push(start + j);
        if (len > 1) errs.push(start + len - 1);
        assert.ok(m.divide(m.dividend(s, errs), s.gen).remainder.some((b) => b), `${errs}`);
      }
  for (let shift = 0; shift + s.gen.length <= n; shift++) {
    const errs = s.gen.flatMap((b, j) => (b ? [shift + j] : []));
    assert.ok(m.divide(m.dividend(s, errs), s.gen).remainder.every((b) => !b));
  }
});

test("the scenarios show what the note says they show", () => {
  const verdictTone = (id) => {
    const v = r.startView(id);
    const st = r.stateOf(v);
    return r.body({ ...v, done: st.steps.length }).match(/data-tone="(\w+)"/)[1];
  };
  assert.equal(verdictTone("send"), "ok");
  assert.equal(verdictTone("clean"), "ok");
  assert.equal(verdictTone("burst"), "caught");
  assert.equal(verdictTone("missed"), "missed");
  assert.equal(m.str(m.checkBits(m.SCENARIOS.send.message, m.SCENARIOS.send.gen)), "011");
});

test("renders step 0 with its controls disabled", () => {
  const html = r.render({ scenario: "burst" });
  assert.ok(!/<button(?![^>]*disabled)/.test(html));
  assert.equal((html.match(/cd-flipped/g) || []).length, 3);
});
