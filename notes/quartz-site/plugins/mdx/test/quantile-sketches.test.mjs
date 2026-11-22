// The quantile figure against an independent Python implementation of the
// same sketches on the same recorded sample
// (content/algorithms/probabilistic/quantile-experiments/figure_ref.py), and
// against the guarantees each sketch states.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/algorithms/probabilistic/quantile-experiments");
const ref = JSON.parse(readFileSync(path.join(dir, "figure-check.json"), "utf8"));
const initial = JSON.parse(readFileSync(path.join(dir, "initial.json"), "utf8"));
const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8"));
const m = await load("components/quantile-sketches/model.ts");
const r = await load("components/quantile-sketches/render.ts");
const sample = m.decode(new Uint8Array(gunzipSync(readFileSync(path.join(dir, "stream.u16.gz")))));
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

test("the decoded sample matches the reference", () => {
  assert.equal(sample.values.length, ref.T);
  assert.equal(sample.values.length, meta.records);
  assert.equal(sample.max, ref.max);
  assert.deepEqual(m.grid(12), ref.qs);
});

test(`${ref.cases.length} sketches match the reference exactly`, () => {
  for (const c of ref.cases) {
    const e = m.exact(sample.values, c.upto, sample.max);
    if (c.kind === "kll") {
      const what = `kll k=${c.k} upto=${c.upto} seed=${c.seed}`;
      const s = m.kll(sample.values, c.upto, c.k, c.seed);
      assert.deepEqual(s.levels.map((l) => [...l].sort((a, b) => a - b)), c.levels, `${what}: levels`);
      assert.equal(s.compactions, c.compactions, `${what}: compactions`);
      assert.deepEqual(s.last, c.last, `${what}: last compaction`);
      const items = m.kllItems(s);
      ref.qs.forEach((q, i) => {
        const est = m.kllQuantile(items, c.upto, q);
        assert.equal(est, c.est[i], `${what}: estimate at ${q}`);
        assert.equal(m.exactQuantile(e, q), c.truth[i], `${what}: truth at ${q}`);
        assert.ok(close(m.rankError(e, q, est), c.rank[i]), `${what}: rank error at ${q}`);
      });
    } else {
      const what = `dd alpha=${c.alpha} upto=${c.upto}`;
      const s = m.dd(sample.values, c.upto, c.alpha);
      assert.equal(m.ddBins(s), c.bins, `${what}: bins`);
      assert.deepEqual([...s.counts].sort((a, b) => a[0] - b[0]), c.keys, `${what}: buckets`);
      ref.qs.forEach((q, i) => {
        const est = m.ddQuantile(s, q);
        assert.ok(close(est, c.est[i]), `${what}: estimate at ${q}`);
        assert.ok(close(m.rankError(e, q, est), c.rank[i]), `${what}: rank error at ${q}`);
      });
    }
  }
});

test("a KLL sketch keeps its total weight and respects its total capacity", () => {
  for (const k of m.KS) {
    for (const upto of [1, 50, 999, 12345, meta.records]) {
      const s = m.kll(sample.values, upto, k, 3);
      let w = 0;
      s.levels.forEach((l, h) => (w += l.length * 2 ** h));
      // Each compaction drops half of an even number of items and doubles the
      // weight of the other half, so the weight is exactly n.
      assert.equal(w, upto, `k=${k} upto=${upto}`);
      let cap = 0;
      for (let h = 0; h < s.levels.length; h++) cap += m.capacity(k, h, s.levels.length);
      assert.ok(m.kllRetained(s) <= cap, `k=${k} upto=${upto}: ${m.kllRetained(s)} > ${cap}`);
    }
  }
});

test("DDSketch is within alpha of the exact quantile everywhere", () => {
  const qs = m.grid(200);
  for (const alpha of m.ALPHAS) {
    for (const upto of [1, 10, 777, 31000, meta.records]) {
      const s = m.dd(sample.values, upto, alpha);
      const e = m.exact(sample.values, upto, sample.max);
      for (const q of qs) {
        const t = m.exactQuantile(e, q);
        const est = m.ddQuantile(s, q);
        assert.ok(Math.abs(est - t) <= alpha * t * (1 + 1e-12), `alpha=${alpha} upto=${upto} q=${q}: ${est} vs ${t}`);
      }
    }
  }
});

test("the build-time view is the model's default view", () => {
  const qs = m.grid(r.GRID_POINTS);
  const c = m.compare(sample, meta.records, r.DEFAULT_K, r.DEFAULT_ALPHA, 1, qs);
  assert.deepEqual(c.rows.map((x) => x.kll), initial.kll);
  assert.deepEqual(c.rows.map((x) => x.truth), initial.truth);
  c.rows.forEach((x, i) => {
    assert.ok(close(x.dd, initial.dd[i]));
    assert.ok(close(x.kllRank, initial.kllRank[i]) && close(x.ddRank, initial.ddRank[i]));
  });
  assert.deepEqual(c.kll.levels.map((l) => l.length), initial.levels);
  assert.equal(c.kll.compactions, initial.compactions);
  const html = r.render({ base: "/x/" });
  assert.match(html, /data-base="\/x\/"/);
  assert.equal((html.match(/<polyline class="qs-kll"/g) || []).length, 2);
  assert.equal((r.chart(r.initialView(), true).match(/viewBox="0 0 360 /g) || []).length, 1);
});

test("the mulberry32 sequence matches the reference", async () => {
  const rnd = (await load("shared/random.ts")).mulberry32(7);
  assert.deepEqual([rnd(), rnd(), rnd(), rnd(), rnd()], ref.seq7);
});
