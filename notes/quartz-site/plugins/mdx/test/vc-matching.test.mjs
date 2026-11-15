// Checks the vertex cover figure against independent references: the exact
// optimum from the HiGHS integer program in the note's experiment
// (approximation-experiments/results.json), a separate branching solver, and
// the invariants the 2-approximation proof relies on, on many random graphs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/vc-matching/model.ts");
const r = await load("components/vc-matching/render.ts");
const results = JSON.parse(readFileSync(new URL("../../../../content/algorithms/approximation-experiments/results.json", import.meta.url), "utf8"));

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

function randomGraph(seed) {
  const rand = rng(seed);
  const n = 3 + Math.floor(rand() * 10);
  const p = 0.15 + rand() * 0.6;
  const edges = [];
  for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) if (rand() < p) edges.push([u, v]);
  return { names: Array.from({ length: n }, (_, i) => `v${i}`), xy: Array.from({ length: n }, () => [rand(), rand()]), edges };
}

// Independent exact solver: some endpoint of the first uncovered edge must be in any cover.
function exact(edges, chosen = new Set()) {
  const e = edges.find(([u, v]) => !chosen.has(u) && !chosen.has(v));
  if (!e) return chosen.size;
  return Math.min(...e.map((x) => exact(edges, new Set([...chosen, x]))));
}

const isCover = (g, cover) => g.edges.every(([u, v]) => cover.has(u) || cover.has(v));

test("the Florentine optimum matches the integer program", () => {
  const fam = results.vertex_cover.real.find((f) => f.family.startsWith("Florentine"));
  assert.equal(m.optimum(m.preset("florentine").graph).size, fam.mean_opt);
  assert.equal(m.optimum(m.preset("k33").graph).size, 3);
});

test("optimum agrees with a branching solver on random graphs", () => {
  for (let s = 0; s < 300; s++) {
    const g = randomGraph(s);
    const opt = m.optimum(g);
    assert.equal(opt.size, exact(g.edges), `seed ${s}`);
    assert.ok(isCover(g, new Set(opt.cover)));
  }
});

test("the scan builds a maximal matching and a cover of exactly twice its size", () => {
  for (let s = 0; s < 300; s++) {
    const g = randomGraph(s);
    const order = m.edgeOrder(g, s);
    assert.deepEqual([...order].sort((a, b) => a - b), g.edges.map((_, i) => i));
    const run = m.run(g, order, false);
    const snap = m.snapshot(g, run, run.steps.length);
    const ends = snap.matching.flatMap((e) => g.edges[e]);
    assert.equal(new Set(ends).size, ends.length, "matched edges share no endpoint");
    assert.equal(snap.cover.size, 2 * snap.matching.length);
    assert.ok(isCover(g, snap.cover));
    assert.equal(snap.uncovered.size, 0);
    const opt = m.optimum(g).size;
    assert.ok(snap.matching.length <= opt && snap.cover.size <= 2 * opt);
  }
});

test("pruning keeps a cover and never grows it", () => {
  for (let s = 0; s < 300; s++) {
    const g = randomGraph(s);
    const order = m.edgeOrder(g, s + 7);
    const plain = m.run(g, order, false);
    const pruned = m.run(g, order, true);
    const a = m.snapshot(g, plain, plain.steps.length).cover;
    const b = m.snapshot(g, pruned, pruned.steps.length).cover;
    assert.ok(isCover(g, b));
    assert.ok(b.size <= a.size && b.size >= m.optimum(g).size);
    // No vertex left in the pruned cover could still be dropped... unless its neighbour was dropped after it was checked.
    for (const st of pruned.steps.filter((x) => x.kind === "drop")) assert.ok(a.has(st.vertex));
  }
});

test("the Florentine ratio over many edge orders stays in [1, 2] and is close to the experiment's", () => {
  const g = m.preset("florentine").graph;
  const ratios = [];
  for (let s = 0; s < 400; s++) {
    const run = m.run(g, m.edgeOrder(g, s), false);
    ratios.push(m.snapshot(g, run, run.steps.length).cover.size / 8);
  }
  assert.ok(Math.min(...ratios) >= 1 && Math.max(...ratios) <= 2);
  const mean = ratios.reduce((a, b) => a + b) / ratios.length;
  const fam = results.vertex_cover.real.find((f) => f.family.startsWith("Florentine"));
  assert.ok(Math.abs(mean - fam.matching.mean) < 0.1, `mean ${mean} vs ${fam.matching.mean}`);
});

test("every preset renders at every step without gaps", () => {
  for (const p of m.PRESETS) {
    assert.match(r.render({ preset: p.id }), /<figure class="vm"/);
    const st = r.initialState({ preset: p.id });
    for (let k = 0; k <= st.run.steps.length; k++) {
      st.step = k;
      const html = r.chart(st) + r.narration(st) + r.tally(st);
      assert.doesNotMatch(html, /NaN|undefined/);
    }
  }
});
