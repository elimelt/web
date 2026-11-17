// Checks the cache-line ping-pong model against facts derived independently
// of it: closed-form transfer counts for all-writer schedules, a separate
// owner/sharers implementation for the reader preset, and the MESI
// single-writer invariant on random schedules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/line-ping-pong/model.ts");
const r = await load("components/line-ping-pong/render.ts");

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const schedule = (seed, len, n = 4) => {
  const g = rng(seed);
  return Array.from({ length: len }, () => Math.floor(g() * n));
};

test("layout: stride 8 puts four counters in one line, stride 64 in four", () => {
  assert.equal(m.fresh("packed").lines, 1);
  assert.equal(m.fresh("padded").lines, 4);
  assert.deepEqual([0, 1, 2, 3].map((c) => m.lineOf(64, c)), [0, 1, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map((c) => m.lineOf(8, c)), [0, 0, 0, 0]);
  assert.match(r.render({ preset: "padded" }), /line 3/);
});

test("packed writers: one transfer per change of writer, after the first write", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = schedule(seed, 1 + (seed % 40));
    const t = m.tally(m.run("packed", s));
    // Closed form: the line is Modified in the last writer, so a write
    // transfers it exactly when the writer differs from the previous one.
    let changes = 0;
    for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) changes++;
    assert.equal(t.fromCore, changes, `seed ${seed}`);
    assert.equal(t.invalidations, changes);
    assert.equal(t.hits, s.length - 1 - changes);
  }
});

test("padded writers: only each core's first write misses, and nothing moves between cores", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = schedule(seed, 1 + (seed % 40));
    const t = m.tally(m.run("padded", s));
    assert.equal(t.fromCore, 0);
    assert.equal(t.invalidations, 0);
    assert.equal(t.accesses - t.hits, new Set(s).size);
  }
});

test("reader preset matches a separate owner/sharers implementation", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = schedule(seed, 1 + (seed % 50));
    // Reference: track the set of cores with a valid copy and whether core 0
    // (the only writer) holds it dirty.
    let valid = new Set();
    let dirty = false;
    let fromCore = 0;
    let inval = 0;
    for (const c of s) {
      if (c === 0) {
        inval += [...valid].filter((k) => k !== 0).length;
        valid = new Set([0]);
        dirty = true;
      } else if (!valid.has(c)) {
        if (dirty) fromCore++;
        dirty = false;
        valid.add(c);
      }
    }
    const t = m.tally(m.run("reader", s));
    assert.equal(t.fromCore, fromCore, `seed ${seed}`);
    assert.equal(t.invalidations, inval, `seed ${seed}`);
  }
});

test("MESI invariant: a Modified or Exclusive copy is the only valid copy", () => {
  for (const key of ["packed", "padded", "reader"]) {
    for (let seed = 1; seed <= 100; seed++) {
      const mach = m.fresh(key);
      for (const c of schedule(seed, 60)) {
        m.step(mach, c);
        for (let l = 0; l < mach.lines; l++) {
          const st = mach.state.map((row) => row[l]);
          const owners = st.filter((x) => x === "M" || x === "E").length;
          assert.ok(owners <= 1);
          if (owners === 1) assert.equal(st.filter((x) => x === "S").length, 0);
        }
      }
      mach.roles.forEach((role, c) =>
        assert.equal(mach.value[c], role === "write" ? mach.trace.filter((e) => e.core === c).length : 0),
      );
    }
  }
});

test("two figures on one page share no ids or radio names", () => {
  const html = r.render({ preset: "packed" }) + r.render({ preset: "reader" });
  assert.doesNotMatch(html, /\sid=|type="radio"/);
});
