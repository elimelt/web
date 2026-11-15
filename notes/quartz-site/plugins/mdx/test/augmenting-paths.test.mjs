// Checks the augmenting-path figure against independent references: a
// separate Python Edmonds-Karp and NetworkX's preflow-push max flow and
// minimum cut (content/algorithms/network-flow-experiments/figure_fixtures.json,
// written by figure_reference.py), plus the invariants the Edmonds-Karp
// analysis relies on, on random networks generated here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/augmenting-paths/model.ts");
const r = await load("components/augmenting-paths/render.ts");
const fixtures = JSON.parse(readFileSync(new URL("../../../../content/algorithms/network-flow-experiments/figure_fixtures.json", import.meta.url), "utf8"));

const toNet = (c) => ({
  names: Array.from({ length: c.n }, (_, i) => `v${i}`),
  xy: Array.from({ length: c.n }, () => [0, 0]),
  edges: c.edges,
  undirected: c.undirected,
  s: c.s,
  t: c.t,
});

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

function randomNet(seed) {
  const rand = rng(seed);
  const n = 2 + Math.floor(rand() * 11);
  const edges = [];
  const undirected = [];
  for (let k = 0; k < 1 + Math.floor(rand() * 3 * n); k++) {
    const u = Math.floor(rand() * n);
    let v = Math.floor(rand() * (n - 1));
    if (v >= u) v++;
    edges.push([u, v, Math.floor(rand() * 10)]);
    undirected.push(rand() < 0.2);
  }
  return { names: Array.from({ length: n }, (_, i) => `v${i}`), xy: edges.map(() => [0, 0]), edges, undirected, s: 0, t: n - 1 };
}

test("the fixtures cover backward arcs and undirected edges", () => {
  assert.ok(fixtures.cases.length >= 400);
  assert.equal(fixtures.inf, m.INF);
  assert.ok(fixtures.cases.filter((c) => c.paths.some((p) => p.arcs.some(([, d]) => d === -1))).length > 50);
  assert.ok(fixtures.cases.filter((c) => c.undirected.some(Boolean)).length > 50);
});

test("value, cut and source side match NetworkX; the paths match the Python Edmonds-Karp", () => {
  for (const [i, c] of fixtures.cases.entries()) {
    const run = m.run(toNet(c));
    assert.equal(run.value, c.value, `case ${i} value`);
    assert.equal(run.cutCapacity, c.cut_capacity, `case ${i} cut`);
    const side = run.reach.flatMap((x, v) => (x ? [v] : []));
    assert.deepEqual(side, c.source_side, `case ${i} source side`);
    assert.equal(run.augments.length, c.paths.length, `case ${i} augmentations`);
    run.augments.forEach((a, k) => {
      assert.deepEqual(a.path.map((x) => [x.e, x.dir]), c.paths[k].arcs, `case ${i} path ${k}`);
      assert.equal(a.bottleneck, c.paths[k].bottleneck);
    });
  }
});

test("every run ends in a feasible flow, path lengths never decrease, and the Edmonds-Karp bound holds", () => {
  for (let seed = 0; seed < 500; seed++) {
    const net = randomNet(seed);
    const run = m.run(net);
    const n = net.names.length;
    const excess = new Array(n).fill(0);
    run.flow.forEach((f, e) => {
      const [u, v, c] = net.edges[e];
      assert.ok(Math.abs(f) <= c && (net.undirected[e] || f >= 0), `seed ${seed} capacity`);
      excess[u] -= f;
      excess[v] += f;
    });
    excess.forEach((x, v) => {
      if (v !== net.s && v !== net.t) assert.equal(x, 0, `seed ${seed} conservation at ${v}`);
    });
    if (net.s !== net.t) assert.equal(excess[net.t], run.value);
    assert.equal(run.cutCapacity, run.value, `seed ${seed} cut = flow`);
    assert.ok(!run.reach[net.t]);
    for (let k = 1; k < run.augments.length; k++) {
      assert.ok(run.augments[k].path.length >= run.augments[k - 1].path.length, `seed ${seed} lengths`);
    }
    const arcs = 2 * net.edges.length;
    assert.ok(run.augments.length <= (n * arcs) / 2 + 1, `seed ${seed} bound`);
  }
});

test("the presets show what the note says they show", () => {
  const net = m.run(m.preset("network").net);
  assert.equal(net.value, 8);
  assert.equal(net.augments.length, 3);
  assert.ok(net.augments[2].path.some((a) => a.dir === -1));
  assert.deepEqual(net.reach, [true, false, false, true, false, false]);

  const match = m.run(m.preset("matching").net);
  assert.equal(match.value, 3);
  assert.ok(match.augments.some((a) => a.path.filter((x) => x.dir === -1).length === 2));
  assert.match(r.narration(r.initialState({ preset: "matching" })), /\{x1, x2, y2\}/);
  // the cover read off the cut touches every X-Y edge, and the matched edges share no endpoint
  const p = m.preset("matching");
  const cover = new Set([...p.sides.x.filter((v) => !match.reach[v]), ...p.sides.y.filter((v) => match.reach[v])]);
  const middle = p.net.edges.map((e, i) => [e, i]).filter(([[u, v]]) => p.sides.x.includes(u) && p.sides.y.includes(v));
  assert.ok(middle.every(([[u, v]]) => cover.has(u) || cover.has(v)));
  const ends = middle.filter(([, i]) => match.flow[i] > 0).flatMap(([[u, v]]) => [u, v]);
  assert.equal(new Set(ends).size, ends.length);
  assert.equal(cover.size, match.value);

  const diamond = m.run(m.preset("diamond").net);
  assert.equal(diamond.value, 2000);
  assert.equal(diamond.augments.length, 2);
  assert.equal(diamond.flow[2], 0);
});

test("every preset renders at every step and in both views without gaps", () => {
  for (const p of m.PRESETS) {
    assert.match(r.render({ preset: p.id }), /<figure class="ap"/);
    const st = r.initialState({ preset: p.id });
    for (const view of ["residual", "flow"]) {
      st.view = view;
      for (let k = 0; k <= st.run.augments.length; k++) {
        st.step = k;
        const html = r.chart(st) + r.narration(st) + r.tally(st);
        assert.doesNotMatch(html, /NaN|undefined|Infinity/);
      }
    }
  }
});
