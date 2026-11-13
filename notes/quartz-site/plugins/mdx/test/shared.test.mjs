// Checks the shared helpers in src/shared/ that figures build on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const format = await load("shared/format.ts");
const random = await load("shared/random.ts");
const dom = await load("shared/dom.ts");

test("esc escapes the characters that break markup and attributes", () => {
  assert.equal(format.esc(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("num writes a real minus sign", () => {
  assert.equal(format.num(-1.234, 2), "−1.23");
  assert.equal(format.num(0.5, 1), "0.5");
});

test("mulberry32 matches the reference sequence and stays in [0, 1)", () => {
  // The first outputs of the published C version (uint32 arithmetic) for seed 1.
  const next = random.mulberry32(1);
  assert.deepEqual([next(), next(), next()].map((x) => x * 4294967296), [2693262067, 11749833, 2265367787]);
  const r = random.mulberry32(-7);
  for (let i = 0; i < 10000; i++) {
    const x = r();
    assert.ok(x >= 0 && x < 1);
  }
});

test("frameScheduler draws once per frame however often it is asked", () => {
  const queue = [];
  globalThis.requestAnimationFrame = (fn) => queue.push(fn);
  globalThis.cancelAnimationFrame = () => queue.pop();
  let draws = 0;
  const { schedule, cancel } = dom.frameScheduler(() => draws++);
  schedule();
  schedule();
  schedule();
  assert.equal(queue.length, 1);
  queue.shift()();
  assert.equal(draws, 1);
  schedule();
  cancel();
  assert.equal(queue.length, 0);
});
