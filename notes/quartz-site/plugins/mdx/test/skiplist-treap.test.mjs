// The skip list and treap figure against an independent Python implementation
// that builds both structures with explicit nodes, pointers and rotations
// (content/algorithms/probabilistic/search-structure-experiments/figure_ref.py),
// and against the exact expected search costs, averaged over many seeds.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/algorithms/probabilistic/search-structure-experiments");
const ref = JSON.parse(readFileSync(path.join(dir, "figure-check.json"), "utf8"));
const data = JSON.parse(readFileSync(path.join(dir, "titles.json"), "utf8"));
const m = await load("components/skiplist-treap/model.ts");
const r = await load("components/skiplist-treap/render.ts");
const rnd = await load("shared/random.ts");

test("the titles are sorted and the insertion order is a permutation", () => {
  assert.equal(data.titles.length, ref.n);
  for (let i = 1; i < data.titles.length; i++) assert.ok(data.titles[i - 1] < data.titles[i]);
  assert.deepEqual([...data.order].sort((a, b) => a - b), data.titles.map((_, i) => i));
});

test(`${ref.cases.length} runs match the pointer-based reference key by key`, () => {
  for (const c of ref.cases) {
    const what = `seed ${c.base} p ${c.p}`;
    const out = m.run(data.order, c.p, c.base, rnd.mulberry32);
    assert.deepEqual(out.smallKeys, c.smallKeys, `${what}: drawn keys`);
    assert.deepEqual(Array.from(out.smallSkip.lv), c.smallLevels, `${what}: levels`);
    for (let k = 0; k < m.SMALL; k++) {
      const steps = [];
      assert.equal(out.smallSkip.search(k, steps), c.smallCost[k], `${what}: drawn skip list, key ${k}`);
      assert.deepEqual(steps.map((s) => [s.level, s.key, s.moved ? 1 : 0]), c.smallSteps[k], `${what}: steps for key ${k}`);
      assert.equal(m.treapPath(out.smallTreap, k).length, c.smallDepth[k], `${what}: drawn treap path, key ${k}`);
    }
    assert.deepEqual(Array.from(out.smallTreap.depth), c.smallDepth, `${what}: drawn treap depths`);
    assert.deepEqual(Array.from(out.skipCost), c.skipCost, `${what}: skip list costs`);
    assert.deepEqual(Array.from(out.treapDepth), c.treapDepth, `${what}: treap depths`);
  }
});

test("the closed-form expectations match the reference", () => {
  for (const e of ref.expected) {
    assert.ok(Math.abs(m.skipExpected(e.n, e.p, e.m) - e.skip) < 1e-9, `skip ${JSON.stringify(e)}`);
    assert.ok(Math.abs(m.treapExpected(e.n, e.m) - e.treap) < 1e-9, `treap ${JSON.stringify(e)}`);
  }
});

test("costs averaged over 400 seeds approach the exact expectations", () => {
  // 200 keys in random insertion order; per position, the mean over 400 runs
  // within 5 standard errors (estimated from the runs) of the expectation.
  const n = 200;
  const g = rnd.mulberry32(5);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(g() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const H = m.harmonicTable(n);
  for (const p of [0.5, 0.25]) {
    const runs = 400;
    const s = new Float64Array(n), s2 = new Float64Array(n), t = new Float64Array(n), t2 = new Float64Array(n);
    for (let seed = 1; seed <= runs; seed++) {
      const sk = new m.SkipList(m.skipLevels(order, n, p, rnd.mulberry32(seed)));
      const tr = m.treap(order, n, rnd.mulberry32(seed + 10000));
      for (let k = 0; k < n; k++) {
        const c = sk.search(k);
        s[k] += c; s2[k] += c * c;
        t[k] += tr.depth[k]; t2[k] += tr.depth[k] ** 2;
      }
    }
    let worst = 0;
    for (let k = 0; k < n; k++) {
      for (const [sum, sq, e] of [[s[k], s2[k], m.skipExpected(n, p, k + 1)], [t[k], t2[k], m.treapExpected(n, k + 1, H)]]) {
        const mean = sum / runs;
        const se = Math.sqrt((sq / runs - mean * mean) / (runs - 1));
        worst = Math.max(worst, Math.abs(mean - e) / se);
      }
    }
    assert.ok(worst < 5, `p=${p}: largest deviation ${worst} standard errors`);
  }
});

test("the build-time markup draws both structures and the cost chart", () => {
  const html = r.render({});
  assert.equal((html.match(/<svg/g) || []).length, 3);
  assert.ok(html.includes(data.titles[m.run(data.order, 0.5, 1, rnd.mulberry32).smallKeys[0]].replace(/&/g, "&amp;")));
});
