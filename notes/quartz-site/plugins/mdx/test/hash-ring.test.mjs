// Checks the hash ring figure against independent references: Python's mmh3
// for the hash, the harmonic-number closed form for the busiest server with
// one point each, a separate Python implementation of the rebalancing loop,
// and brute-force checks that adding a server only moves keys to it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const exp = path.join(here, "../../../../content/systems/distributed-systems/sharding-experiments");
const check = JSON.parse(readFileSync(path.join(exp, "figure-check.json"), "utf8"));
const m = await load("components/hash-ring/model.ts");
const r = await load("components/hash-ring/render.ts");

test("murmur3 matches Python's mmh3 with seeds 0 and 7", () => {
  for (const [key, [h0, h7]] of Object.entries(check.murmur)) {
    assert.equal(m.murmur3(key, 0), h0, key);
    assert.equal(m.murmur3(key, 7), h7, key);
  }
  // Tail lengths 0 to 3, against published x86_32 vectors.
  assert.equal(m.murmur3("", 0), 0);
  assert.equal(m.murmur3("", 1), 0x514e28b7);
  assert.equal(m.murmur3("a", 0), 0x3c2569b2);
  assert.equal(m.murmur3("abc", 0), 0xb3dd93fa);
  assert.equal(m.murmur3("abcd", 0), 0x43ed676a);
});

test("ring shares sum to one and match key ownership", () => {
  for (const points of [1, 4, 64]) {
    const ring = m.ringPoints(5, points, 3);
    const arcs = m.ringArcs(ring);
    const s = m.shares(arcs, 5);
    assert.ok(Math.abs(s.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    // A position inside each arc belongs to that arc's server.
    for (const a of arcs) {
      if (a.to - a.from < 1e-6) continue;
      const mid = Math.floor(((a.from + a.to) / 2) * 2 ** 32);
      assert.equal(m.ringOwner(ring, mid), a.server);
    }
  }
});

test("one point each: busiest share averages H_n times the fair share", () => {
  for (const n of [4, 6]) {
    let sum = 0;
    const trials = 3000;
    for (let seed = 0; seed < trials; seed++) sum += m.peak(m.shares(m.ringArcs(m.ringPoints(n, 1, seed)), n));
    let h = 0;
    for (let i = 1; i <= n; i++) h += 1 / i;
    assert.ok(Math.abs(sum / trials - h) < 0.06, `n=${n}: ${sum / trials} vs ${h}`);
  }
});

test("adding a server moves keys only to the new server", () => {
  for (const points of [1, 16]) {
    for (let seed = 0; seed < 20; seed++) {
      const before = m.ringPoints(5, points, seed);
      const after = m.ringPoints(6, points, seed);
      for (let i = 0; i < 2000; i++) {
        const p = m.murmur3(`k${i}`);
        const a = m.ringOwner(before, p);
        const b = m.ringOwner(after, p);
        if (a !== b) assert.equal(b, 5);
      }
    }
  }
  const owners = m.roundRobin(20, 5);
  const next = m.addToTable(owners, 5);
  const changed = next.map((o, e) => (o !== owners[e] ? e : -1)).filter((e) => e >= 0);
  assert.equal(changed.length, 3);
  for (const e of changed) assert.equal(next[e], 5);
  assert.deepEqual(changed.map((e) => owners[e]).sort(), [0, 1, 2]);
});

test("rebalancing matches the Python reference move for move", () => {
  let s = m.initial("hot");
  const moves = [];
  while (!m.settled(s)) {
    s = m.act(s, "move");
    const last = s.moves[s.moves.length - 1];
    moves.push([last.entry, last.from, last.to]);
  }
  assert.deepEqual(moves, check.rebalanceMoves);
  assert.deepEqual(s.owners, check.rebalanceOwners);
  assert.ok(check.rebalanceMoves.length > 0);
});

test("figure data agrees with itself", () => {
  const d = m.DATA;
  assert.equal(d.entryRequests.reduce((a, b) => a + b, 0), d.requests);
  assert.equal(d.entryKeys.reduce((a, b) => a + b, 0), d.keys);
  assert.equal(d.sample.length, 60);
});

test("every scenario renders, with controls disabled until the script runs", () => {
  for (const scenario of m.SCENARIOS) {
    const html = r.render({ scenario });
    assert.match(html, new RegExp(`data-scenario="${scenario}"`));
    assert.doesNotMatch(html, /<(button|input)(?![^>]*disabled)[^>]*>/);
    assert.doesNotMatch(html, /NaN|undefined/);
  }
});

test("readouts name the right donors", () => {
  let s = m.act(m.initial("add"), "add");
  const v = m.view(s);
  const donors = v.dots.filter((d) => d.moved);
  assert.ok(donors.every((d) => d.server === 5));
  assert.match(v.readout, /^F took \d+% of the ring/);
  s = m.act(m.initial("table-add"), "add");
  assert.match(m.view(s).readout, /F took 3 of the 20 entries, one each from A, B and C/);
});
