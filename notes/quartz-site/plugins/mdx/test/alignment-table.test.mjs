// Checks that the alignment figure computes what the note says it does: the
// same cost and the same alignment as the note's Python alignment() on the
// fixtures check_samples.py writes, the brute-force optimum on small inputs,
// and markup that holds together at every step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await load("components/alignment-table/model.ts");
const r = await load("components/alignment-table/render.ts");
const fixtures = JSON.parse(readFileSync(path.join(here, "../../../../content/algorithms/dp-harness/align_fixtures.json"), "utf8"));

/** Every alignment of x and y, by search: a different algorithm from the table. */
function brute(x, y, gap, mismatch) {
  let best = Infinity;
  const go = (i, j, cost) => {
    if (cost >= best) return;
    if (i === x.length && j === y.length) {
      best = cost;
      return;
    }
    if (i < x.length && j < y.length) go(i + 1, j + 1, cost + (x[i] === y[j] ? 0 : mismatch));
    if (i < x.length) go(i + 1, j, cost + gap);
    if (j < y.length) go(i, j + 1, cost + gap);
  };
  go(0, 0, 0);
  return best;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("matches the note's Python on every fixture", () => {
  assert.ok(fixtures.length > 100);
  for (const fx of fixtures) {
    const t = m.fill(fx.x, fx.y, fx.gap * 2, fx.mismatch * 2);
    const label = JSON.stringify(fx);
    assert.equal(m.at(t, t.m, t.n), fx.cost * 2, label);
    const a = m.traceback(t);
    assert.equal(a.top, fx.top, label);
    assert.equal(a.bottom, fx.bottom, label);
  }
});

test("the table's cost is the brute-force optimum and the traceback attains it", () => {
  const rand = rng(11);
  for (let k = 0; k < 600; k++) {
    const word = () => Array.from({ length: Math.floor(rand() * 7) }, () => "abc"[Math.floor(rand() * 3)]).join("");
    const x = word();
    const y = word();
    const gap = 1 + Math.floor(rand() * 8);
    const mismatch = Math.floor(rand() * 9);
    const t = m.fill(x, y, gap, mismatch);
    const best = brute(x, y, gap, mismatch);
    assert.equal(m.at(t, t.m, t.n), best, `${x} ${y} ${gap} ${mismatch}`);
    const a = m.traceback(t);
    assert.equal(a.top.replaceAll("-", ""), x);
    assert.equal(a.bottom.replaceAll("-", ""), y);
    assert.equal(m.score(a.top, a.bottom, gap, mismatch), best);
    assert.equal(a.path.length, a.top.length + 1);
    assert.deepEqual(a.path.at(-1), [0, 0]);
  }
});

test("candidates explain every cell", () => {
  const t = m.fill("ocurrance", "occurrence", 2, 2);
  for (let i = 0; i <= t.m; i++)
    for (let j = 0; j <= t.n; j++) {
      if (i === 0 && j === 0) continue;
      const c = m.candidates(t, i, j);
      const min = Math.min(...c.map((x) => x.total));
      assert.equal(min, m.at(t, i, j));
      for (const x of c) assert.equal(x.best, x.total === min);
    }
});

test("fill order, filled cells and the two rows a cost-only pass keeps", () => {
  const t = m.fill("abcd", "abc", 2, 2);
  assert.deepEqual(m.cellOfStep(t, 1), [1, 1]);
  assert.deepEqual(m.cellOfStep(t, 3), [1, 3]);
  assert.deepEqual(m.cellOfStep(t, 4), [2, 1]);
  assert.deepEqual(m.cellOfStep(t, m.steps(t)), [4, 3]);
  for (let step = 0; step <= m.steps(t); step++) {
    let count = 0;
    for (let i = 1; i <= t.m; i++) for (let j = 1; j <= t.n; j++) count += m.filled(t, step, i, j) ? 1 : 0;
    assert.equal(count, step);
  }
  // Filling row 3 needs rows 2 and 3 only.
  assert.equal(m.held(t, 7, 1), false);
  assert.equal(m.held(t, 7, 2), true);
  assert.equal(m.held(t, 7, 3), true);
  assert.equal(m.held(t, m.steps(t), 3), true);
  assert.equal(m.held(t, m.steps(t), 2), false);
});

test("clean keeps letters and digits, at most MAX_LEN", () => {
  assert.equal(m.clean(" a-b c!"), "abc");
  assert.equal(m.clean("x".repeat(30)).length, m.MAX_LEN);
  assert.equal(m.half(3), "1.5");
  assert.equal(m.half(4), "2");
});

test("renders the finished default table with disabled controls", () => {
  const html = r.render({});
  assert.match(html, /^<figure class="at"/);
  assert.equal((html.match(/class="at-cell/g) ?? []).length, 10 * 11);
  assert.ok(html.includes("at-path"));
  assert.ok(html.includes('<pre class="at-pre"'));
  for (const control of html.match(/<(input|button)[^>]*>/g)) assert.match(control, /disabled/, control);
  // Bad props fall back to the defaults rather than breaking the build.
  assert.equal(r.render({ x: 7, y: "!!" }), html);
});

test("every step of every view renders without throwing", () => {
  for (const [x, y] of [["ocurrance", "occurrence"], ["", "abc"], ["a", ""], ["", ""]]) {
    const n = x.length * y.length;
    for (let step = 0; step <= n; step++)
      for (const twoRows of [false, true]) {
        const s = { ...r.initialState({ x, y }), x, y, step, twoRows };
        const v = r.view(s);
        r.grid(s, v);
        r.narration(s, v);
        r.alignmentBlock(s, v);
        r.stats(s, v);
      }
  }
});
