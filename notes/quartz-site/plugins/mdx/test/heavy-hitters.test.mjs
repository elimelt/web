// The heavy-hitter figure against an independent Python implementation of
// the same summaries on the same recorded substream
// (content/algorithms/probabilistic/heavy-hitter-experiments/figure_ref.py),
// and against the guarantees each summary states.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/algorithms/probabilistic/heavy-hitter-experiments");
const ref = JSON.parse(readFileSync(path.join(dir, "figure-check.json"), "utf8"));
const initial = JSON.parse(readFileSync(path.join(dir, "initial.json"), "utf8"));
const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8"));
const m = await load("components/heavy-hitters/model.ts");
const r = await load("components/heavy-hitters/render.ts");
const stream = m.decode(new Uint8Array(gunzipSync(readFileSync(path.join(dir, "stream.u16.gz")))));
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

test("the decoded substream matches the reference's record count, views and key count", () => {
  assert.equal(stream.keys.length, ref.T);
  assert.equal(stream.keys.length, meta.records);
  let views = 0;
  for (const c of stream.counts) views += c;
  assert.equal(views, ref.views);
  assert.equal(stream.nkeys, meta.keys);
});

test("hash, sequence and permutation match the reference", () => {
  for (const x of ref.mix) assert.equal(m.fmix32(x.x >>> 0), x.fmix32);
  const g = m.seq(7);
  assert.deepEqual([g(), g(), g(), g(), g()], ref.seq7);
  assert.deepEqual(Array.from(m.permutation(ref.T, 1).slice(0, 10)), ref.perm1_head);
});

test(`${ref.cases.length} summaries match the reference exactly`, () => {
  const perm = m.permutation(ref.T, 1);
  for (const c of ref.cases) {
    const what = `${c.alg} budget ${c.budget} ${c.order} upto ${c.upto}`;
    const ord = c.order === "file" ? null : perm;
    const s = m.run(c.alg, c.budget, stream, ord, c.upto, 1);
    const slots = [];
    for (let i = 0; i < s.used; i++) slots.push([s.slotKey[i], s.slotVal[i], s.slotErr[i]]);
    slots.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    assert.deepEqual(slots, c.slots, `${what}: slots`);
    const o = m.outcome(s, m.truth(stream, ord, c.upto));
    assert.equal(s.n, c.n, `${what}: views`);
    assert.deepEqual(o.top, c.top, `${what}: true top`);
    assert.deepEqual(o.rows.map((x) => x.truth), c.truth, `${what}: truth`);
    o.rows.forEach((x, i) => {
      assert.ok(close(x.est, c.est[i]), `${what}: estimate ${i}`);
      assert.ok(close(x.lo, c.lo[i]) && close(x.hi, c.hi[i]), `${what}: interval ${i}`);
    });
    assert.deepEqual(m.reported(s), c.reported, `${what}: reported`);
    assert.equal(o.hits, c.hits, `${what}: hits`);
    assert.ok(close(o.maxErr, c.maxErr) && close(o.bound, c.bound), `${what}: error and bound`);
  }
});

test("Misra–Gries with k counters is Space-Saving with k + 1 counters minus its minimum", () => {
  for (const e of ref.equivalence) assert.ok(e.equal, `reference k=${e.k}`);
  for (const k of [15, 63, 255]) {
    for (const ord of [null, m.permutation(ref.T, 3)]) {
      // run() takes budgets, so drive the counts through the summaries directly.
      const mg = m.run("mg", k, stream, ord, ref.T, 1);
      const ss = m.run("ss", k + 1, stream, ord, ref.T, 1);
      const mn = m.minCount(ss);
      const a = new Map();
      for (let i = 0; i < ss.used; i++) if (ss.slotVal[i] - mn > 0) a.set(ss.slotKey[i], ss.slotVal[i] - mn);
      const b = new Map();
      for (let i = 0; i < mg.used; i++) b.set(mg.slotKey[i], mg.slotVal[i]);
      assert.deepEqual([...a].sort((x, y) => x[0] - y[0]), [...b].sort((x, y) => x[0] - y[0]), `k=${k}`);
      // Agarwal et al. (2013), Lemma 2.3: the minimum is (n - counted_MG)/(k + 1).
      assert.ok(close(mn, (mg.n - m.counted(mg)) / (k + 1)), `k=${k} minimum`);
    }
  }
});

test("the deterministic guarantees hold for every key at every hour boundary", () => {
  for (const alg of ["mg", "ss"]) {
    for (const budget of [16, 64, 256]) {
      for (const upto of meta.hourStart.slice(1)) {
        const s = m.run(alg, budget, stream, null, upto, 1);
        const a = m.truth(stream, null, upto);
        let counted = 0;
        for (let i = 0; i < s.used; i++) counted += s.slotVal[i];
        if (alg === "ss") assert.equal(counted, s.n, "Space-Saving counters sum to n");
        const slotOf = new Map();
        for (let i = 0; i < s.used; i++) slotOf.set(s.slotKey[i], i);
        for (let key = 0; key < stream.nkeys; key++) {
          const e = m.estimate(s, key, 0, slotOf);
          assert.ok(e.lo - 1e-9 <= a[key] && a[key] <= e.hi + 1e-9, `${alg} ${budget} at ${upto}: key ${key} truth ${a[key]} outside [${e.lo}, ${e.hi}]`);
        }
      }
    }
  }
});

test("a sketch fills its candidate set, and Count-Min never underestimates", () => {
  for (const alg of ["cs", "cms"]) {
    const s = m.run(alg, 128, stream, null, ref.T, 1);
    assert.equal(s.used, 32);
    const a = m.truth(stream, null, ref.T);
    // Count-Min never underestimates.
    if (alg === "cms") for (let key = 0; key < stream.nkeys; key += 7) assert.ok(m.sketchQuery(s, key) >= a[key]);
  }
});

test("the build-time view is the model's default view", () => {
  const s = m.run(r.DEFAULT_ALG, r.DEFAULT_BUDGET, stream, null, ref.T, 1);
  const o = m.outcome(s, m.truth(stream, null, ref.T));
  assert.deepEqual(o.top, initial.top);
  assert.deepEqual(o.rows.map((x) => x.est), initial.est);
  assert.equal(o.hits, initial.hits);
  const html = r.render({ base: "/x/" });
  assert.match(html, /data-base="\/x\/"/);
  assert.match(html, new RegExp(`<strong>${initial.hits} of the 20</strong>`));
  assert.equal((html.match(/class="hh-true"/g) || []).length, 20);
  assert.equal((r.chart(r.initialView(), true).match(/viewBox="0 0 360 /g) || []).length, 1);
});

test("labels name the day's top pages and rank the rest", () => {
  assert.equal(r.keyLabel(0), `${meta.top[0].split(" ").slice(1).join(" ").replace(/_/g, " ")} (${meta.top[0].split(" ")[0]})`);
  assert.equal(r.keyLabel(99), "page ranked 100");
  assert.equal(r.hourOf(meta.hourStart[5] + 1), 5);
  assert.equal(r.positionText(meta.records), `all ${meta.records.toLocaleString("en-US")} records`);
});
