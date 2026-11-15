// Checks the greedy set cover figure against the note's Python experiment
// (approximation-experiments/results.json: greedy order, greedy and optimal
// sizes on the two-row family, weighted greedy cost), a separate exact solver,
// and the charging identities the H_d proof uses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/set-cover-greedy/model.ts");
const r = await load("components/set-cover-greedy/render.ts");
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

const cost = (inst, picks) => picks.reduce((a, p) => a + inst.sets[p.set].cost, 0);

test("two-row instances match the Python run", () => {
  for (const row of results.set_cover.two_rows.filter((x) => x.m <= 10)) {
    const inst = m.twoRows(row.m);
    const picks = m.greedy(inst);
    assert.equal(picks.length, row.greedy, `m=${row.m}`);
    assert.equal(m.optimum(inst).sets.length, row.opt);
    assert.deepEqual(picks.map((p) => inst.sets[p.set].name.toLowerCase()), row.greedy_order);
  }
});

test("weighted tight instance: greedy pays H_n, as in the Python run", () => {
  for (const row of results.set_cover.weighted_tight.filter((x) => x.n <= 100)) {
    const inst = m.weightedTight(row.n);
    const picks = m.greedy(inst);
    assert.ok(Math.abs(cost(inst, picks) - row.greedy_cost) < 1e-4);
    assert.ok(Math.abs(cost(inst, picks) - m.harmonic(row.n)) < 1e-9);
    if (row.n <= 12) assert.ok(Math.abs(m.optimum(inst).cost - row.opt_cost) < 1e-9);
  }
});

function randomInstance(seed) {
  const rand = rng(seed);
  const n = 3 + Math.floor(rand() * 9);
  const k = 2 + Math.floor(rand() * 8);
  const weighted = rand() < 0.5;
  const sets = Array.from({ length: k }, (_, j) => ({ name: `S${j}`, cells: [], cost: weighted ? 0.2 + rand() * 3 : 1, rect: [0, 0, 0, 0] }));
  for (let e = 0; e < n; e++) {
    for (const s of sets) if (rand() < 0.35) s.cells.push(e);
    if (!sets.some((s) => s.cells.includes(e))) sets[Math.floor(rand() * k)].cells.push(e);
  }
  return { rows: 1, cols: n, sets: sets.filter((s) => s.cells.length), weighted };
}

// Independent exact solver: branch on a set containing the lowest uncovered element.
function exact(inst, covered = new Set(), spent = 0, best = { v: Infinity }) {
  if (spent >= best.v) return best.v;
  const e = [...Array(inst.cols).keys()].find((x) => !covered.has(x));
  if (e === undefined) return (best.v = spent);
  for (const s of inst.sets) if (s.cells.includes(e)) exact(inst, new Set([...covered, ...s.cells]), spent + s.cost, best);
  return best.v;
}

test("on random instances: exact optimum agrees, greedy covers, charges add up, and the H_d bound holds", () => {
  for (let seed = 0; seed < 400; seed++) {
    const inst = randomInstance(seed);
    const picks = m.greedy(inst);
    const opt = m.optimum(inst);
    assert.ok(Math.abs(opt.cost - exact(inst)) < 1e-9, `seed ${seed}`);
    const price = m.prices(picks, picks.length);
    assert.equal(price.size, inst.cols, "every element covered and charged once");
    const paid = [...price.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(paid - cost(inst, picks)) < 1e-9, "charges add up to greedy's cost");
    // Chvatal's lemma: the charges inside any one set S add up to at most H_|S| * cost(S).
    for (const s of inst.sets) {
      const inside = s.cells.reduce((a, e) => a + price.get(e), 0);
      assert.ok(inside <= m.harmonic(s.cells.length) * s.cost + 1e-9, `seed ${seed} set ${s.name}`);
    }
    const d = Math.max(...inst.sets.map((s) => s.cells.length));
    assert.ok(cost(inst, picks) <= m.harmonic(d) * opt.cost + 1e-9);
  }
});

test("every preset renders at every step without gaps", () => {
  for (const p of m.PRESETS) {
    assert.match(r.render({ preset: p.id }), /<figure class="sg"/);
    const st = r.initialState({ preset: p.id });
    for (let k = 0; k <= st.picks.length; k++) {
      st.step = k;
      const html = r.chart(st) + r.narration(st) + r.tally(st) + r.table(st);
      assert.doesNotMatch(html, /NaN|undefined|Infinity/);
    }
  }
});
