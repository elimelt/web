// The construction-threshold figure against an independent Python
// implementation of the same builds (content/algorithms/probabilistic/
// filter-experiments/figure_ref.py), which also checks peeling against a
// repeated-scan 2-core and ribbon against dense GF(2) elimination, and against
// the same builds run in C on the pageview keys.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(path.join(here, "../../../../content/algorithms/probabilistic/filter-experiments/figure-check.json"), "utf8"));
const m = await load("components/filter-load/model.ts");
const r = await load("components/filter-load/render.ts");

test("fmix32 and the seed stream match the reference", () => {
  for (const x of ref.mix) assert.equal(m.fmix32(x.x >>> 0), x.fmix32);
  for (const [s, want] of Object.entries(ref.seeds)) assert.deepEqual(m.seeds(Number(s)), want);
});

test("binary fuse segment layout matches the reference", () => {
  for (const f of ref.fuse) assert.deepEqual(m.fuseLayout(f.n, f.S), { seg: f.seg, count: f.count }, `n=${f.n} S=${f.S}`);
});

test("126 builds match the reference exactly: keys placed, success and the per-layout statistic", () => {
  assert.equal(ref.cases.length, 126);
  for (const c of ref.cases) {
    const run = m.build(c.kind, c.S, c.n, c.seed);
    const what = `${c.kind} S=${c.S} n=${c.n} seed=${c.seed}`;
    assert.equal(run.placed, c.placed, `${what} placed`);
    assert.equal(run.ok, c.ok, `${what} ok`);
    assert.equal(run.stat, c.stat, `${what} stat`);
    if (c.used !== undefined && c.ok) assert.equal(run.cells.reduce((a, v) => a + (v ? 1 : 0), 0), c.used, `${what} used slots`);
  }
});

test("success rates on integer keys agree with the C builds on the pageview keys", () => {
  const S = ref.pageview.S;
  for (const k of m.KINDS) {
    for (const want of ref.pageview.runs[k.id]) {
      const li = m.LOADS.findIndex((a) => Math.abs(a - want.load) < 1e-9);
      assert.ok(li >= 0);
      const got = m.measure(k.id, S, li, 7, 48);
      const p1 = got.ok / got.trials;
      const p2 = want.ok / want.trials;
      const pbar = (got.ok + want.ok) / (got.trials + want.trials);
      const tol = 4.5 * Math.sqrt(pbar * (1 - pbar) * (1 / got.trials + 1 / want.trials)) + 0.03;
      assert.ok(Math.abs(p1 - p2) <= tol, `${k.id} load ${want.load}: ${got.ok}/${got.trials} against ${want.ok}/${want.trials}`);
    }
  }
});

test("xor filters switch from success to failure around load 0.818 at 65,536 slots", () => {
  const at = (load) => m.measure("xor", 65536, m.LOADS.findIndex((a) => Math.abs(a - load) < 1e-9), 3, 6).ok;
  assert.equal(at(0.8), 6);
  assert.equal(at(0.84), 0);
});

test("a failed build marks its failure in the drawn cells", () => {
  const x = m.build("xor", 256, Math.round(0.95 * 256), 1);
  assert.equal(x.ok, false);
  assert.ok(x.cells.some((v) => v === 2));
  const c = m.build("cuckoo2", 256, 256, 1);
  assert.equal(c.ok, false);
  assert.equal(c.cells.filter((v) => v === 2).length, 4);
  const rb = m.build("ribbon32", 256, 256, 1);
  assert.equal(rb.ok, false);
  assert.equal(rb.fail.length, 32);
});

test("render: controls start disabled, the xor chart marks its limit and ribbon charts have none", () => {
  const html = r.render({});
  assert.equal((html.match(/ disabled/g) || []).length, 5);
  assert.match(html, /limit 0\.818/);
  const pts = new Array(m.LOADS.length).fill(undefined);
  assert.doesNotMatch(r.chart("ribbon64", 4096, 0.9, pts), /fl-th"/);
  assert.match(r.chart("cuckoo4", 4096, 0.9, pts), /limit 0\.980/);
});
