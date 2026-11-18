// Checks the write-paths model against independent references: a sorted set
// for the B-tree's contents, a plain map of newest versions for the LSM-tree's
// reads, closed forms for the bytes each engine writes in cases where they are
// exact, and the Bloom filter's analytic false-positive rate.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/write-paths/model.ts");
const r = await load("components/write-paths/render.ts");

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkBTree(t, want) {
  const leaves = t.leaves();
  assert.deepEqual(leaves.flatMap((n) => n.keys), [...want].sort((a, b) => a - b), "leaves hold exactly the keys, in order");
  const depth = new Set();
  const walk = (n, lo, hi, d) => {
    if (n !== t.root) assert.ok(n.leaf ? n.keys.length >= 1 : n.children.length >= 2, "non-root pages are non-empty");
    if (n.leaf) {
      assert.ok(n.keys.length <= m.PAGE, "leaf within capacity");
      for (const k of n.keys) assert.ok(k >= lo && k < hi, `key ${k} within its separators [${lo}, ${hi})`);
      depth.add(d);
      return;
    }
    assert.ok(n.children.length <= m.PAGE, "inner page within capacity");
    assert.equal(n.keys.length, n.children.length - 1);
    n.children.forEach((c, i) => walk(c, i ? n.keys[i - 1] : lo, i < n.keys.length ? n.keys[i] : hi, d + 1));
  };
  walk(t.root, -Infinity, Infinity, 1);
  assert.equal(depth.size, 1, "all leaves at one depth");
  assert.equal([...depth][0], t.height);
  // pages counted = pages reachable
  assert.equal(t.levels().flat().length, t.pages);
}

test("the B-tree holds exactly the keys written, balanced, for random batches", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rand = rng(seed);
    const t = new m.BTree();
    const want = new Set();
    for (let i = 0; i < 2000; i++) {
      const k = Math.floor(rand() * 600);
      t.put(k);
      want.add(k);
      if (rand() < 0.3) t.commit();
    }
    t.commit();
    checkBTree(t, want);
    for (let k = 0; k < 600; k++) assert.equal(t.has(k), want.has(k));
  }
});

test("a B-tree overwrite with one write per commit logs exactly one page", () => {
  const run = new m.Run("updates", 1, 3);
  run.runTo(m.KEYS);
  const before = run.btree.counters.logUnits;
  run.runTo(3 * m.KEYS);
  assert.equal(run.btree.counters.logUnits - before, 2 * m.KEYS * m.PAGE);
  assert.equal(run.btree.counters.splits > 0, true);
});

test("sequential inserts fill B-tree leaves completely (balance_quick)", () => {
  const run = new m.Run("sequential", 1);
  run.runTo(m.KEYS);
  const leaves = run.btree.leaves();
  assert.equal(leaves.length, Math.ceil(m.KEYS / m.PAGE));
  for (const l of leaves) assert.equal(l.keys.length, m.PAGE);
  assert.equal(run.spaceAmp("btree"), ((leaves.length + 1) * m.PAGE) / m.KEYS);
});

test("checkpoints write each logged page once per window", () => {
  const t = new m.BTree();
  for (let i = 0; i < 8; i++) t.put(i);
  for (let i = 0; i < m.CHECKPOINT_PAGES; i++) {
    t.put(3);
    t.commit();
  }
  // One page logged CHECKPOINT_PAGES times, written back once.
  assert.equal(t.counters.logUnits, m.CHECKPOINT_PAGES * m.PAGE);
  assert.equal(t.counters.checkpointUnits, m.PAGE);
});

function checkLsm(lsm, newest) {
  for (let l = 1; l < m.LEVELS; l++) {
    const files = lsm.levels[l];
    for (let i = 1; i < files.length; i++) assert.ok(m.hi(files[i - 1]) < m.lo(files[i]), `L${l} files sorted and disjoint`);
  }
  for (const lv of lsm.levels) for (const f of lv) {
    assert.ok(f.entries.length >= 1 && f.entries.length <= m.FILE);
    for (let i = 1; i < f.entries.length; i++) assert.ok(f.entries[i - 1].key < f.entries[i].key);
  }
  assert.ok(lsm.levels[0].length < m.L0_TRIGGER, "L0 below its trigger after compaction");
  for (let l = 1; l < m.LEVELS - 1; l++) assert.ok(lsm.size(l) <= m.levelTarget(l), `L${l} within target`);
  for (const [k, seq] of newest) assert.equal(lsm.get(k), seq, `newest version of ${k}`);
}

test("LSM reads return the newest version of every key; levels stay sorted and disjoint", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rand = rng(100 + seed);
    const lsm = new m.Lsm();
    const newest = new Map();
    for (let i = 1; i <= 3000; i++) {
      const k = 2 * Math.floor(rand() * 300);
      lsm.put(k);
      newest.set(k, i);
    }
    checkLsm(lsm, newest);
    for (let k = 1; k < 600; k += 2) assert.equal(lsm.get(k), undefined, "odd keys absent");
    const c = lsm.counters;
    assert.equal(lsm.writtenUnits, c.logUnits + c.flushUnits + c.compactUnits);
    assert.equal(c.logUnits, 3000);
    assert.equal(c.flushUnits, c.flushes * m.MEMTABLE);
  }
});

test("sequential inserts into the LSM-tree are written twice: log and flush", () => {
  const run = new m.Run("sequential", 1);
  run.runTo(m.KEYS);
  assert.equal(run.lsm.writtenUnits, 2 * m.KEYS);
  assert.equal(run.lsm.counters.compactions, 0);
  assert.ok(run.lsm.counters.trivialMoves > 0);
});

test("Bloom filters have no false negatives and the analytic false-positive rate", () => {
  let fp = 0;
  let trials = 0;
  for (let s = 0; s < 40; s++) {
    const keys = Array.from({ length: 500 }, (_, i) => 2 * (i + 500 * s));
    const b = new m.Bloom(keys, s + 1);
    for (const k of keys) assert.ok(b.mayContain(k));
    for (let i = 0; i < 2000; i++) {
      trials++;
      if (b.mayContain(2 * (1e6 + i + 2000 * s) + 1)) fp++;
    }
  }
  const k = m.BLOOM_K;
  const want = (1 - Math.exp(-k / m.BLOOM_BITS)) ** k; // ≈ 0.0082
  const got = fp / trials;
  assert.ok(Math.abs(got - want) < 0.003, `false-positive rate ${got} vs ${want}`);
});

test("lookups agree between the engines and between the figure's text and the model", () => {
  for (const w of ["random", "sequential", "updates"]) {
    for (const b of r.BATCHES) {
      const s = r.stateFrom({ workload: w, batch: b });
      const run = r.replay(s);
      for (let key = 0; key < r.SPACE; key++) {
        const present = run.live.has(key);
        assert.equal(run.btree.has(key), present);
        assert.equal(run.lsm.get(key) !== undefined, present);
        const look = run.lsm.lookup(key);
        if (!present) assert.ok(look.probes.every((p) => !p.found));
      }
      assert.ok(run.writeAmp("btree") > 0 && run.writeAmp("lsm") >= 2 - 1e-9);
    }
  }
});

test("render produces a finished figure for every workload and batch", () => {
  for (const w of ["random", "sequential", "updates"]) {
    for (const b of [1, 4, 16]) {
      const html = r.render({ workload: w, batch: b, lookup: 37 });
      assert.ok(html.startsWith('<figure class="wp"'));
      assert.ok(!/NaN|undefined|Infinity/.test(html), `${w} ${b}`);
      for (const p of ["event", "btree", "lsm", "table", "chart"]) assert.ok(html.includes(`data-part="${p}"`));
    }
  }
  assert.deepEqual(r.stateFrom({ workload: "nope", batch: 3, at: 999, lookup: -5 }), { workload: "random", batch: 1, at: 64, key: 0 });
});
