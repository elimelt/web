// Checks that the interval-greedy figure computes what the note says it does:
// the same results as greedy_intervals.py on that script's fixtures, the
// brute-force optimum, the depth bound, and the proof's invariants.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const m = await load("components/interval-greedy/model.ts");
const r = await load("components/interval-greedy/render.ts");
const results = JSON.parse(readFileSync(path.join(here, "../../../../content/algorithms/greedy-intervals/greedy_intervals_results.json"), "utf8"));
const toIv = (pairs) => pairs.map(([s, f]) => ({ s, f }));

function* randomInputs(seed, count, maxN = 12) {
  const rand = m.rng(seed);
  for (let i = 0; i < count; i++) yield m.randomInstance(rand, 1 + Math.floor(rand() * maxN));
}

test("matches greedy_intervals.py on every fixture", () => {
  assert.ok(results.fixtures.length >= 50);
  for (const fx of results.fixtures) {
    const iv = toIv(fx.intervals);
    for (const rule of ["finish", "start", "shortest", "conflicts"]) {
      assert.deepEqual(m.runSchedule(iv, rule).kept, fx.schedule[rule], `${rule} on ${JSON.stringify(fx.intervals)}`);
    }
    assert.equal(m.optima(iv, 1).size, fx.optimum);
    for (const order of ["start", "finish", "input"]) assert.equal(m.runPartition(iv, order).rooms.length, fx.rooms[order]);
    assert.equal(m.depthProfile(iv).max, fx.depth);
  }
});

test("earliest finish equals the brute-force optimum", () => {
  for (const iv of randomInputs(1, 3000)) assert.equal(m.runSchedule(iv, "finish").kept.length, m.optima(iv, 1).size);
});

test("start-order first fit uses exactly depth rooms, and every new room has a common-time witness", () => {
  for (const iv of randomInputs(2, 3000)) {
    const run = m.runPartition(iv, "start");
    assert.equal(run.rooms.length, m.depthProfile(iv).max);
    for (const step of run.steps.filter((s) => s.opened)) {
      assert.equal(m.commonTime(iv, [...step.blockers, step.index]), iv[step.index].s);
    }
    for (const room of run.rooms) for (let a = 0; a < room.length; a++) for (let b = a + 1; b < room.length; b++) assert.ok(!m.overlaps(iv[room[a]], iv[room[b]]));
  }
});

test("the stays-ahead lemma holds for earliest finish against every optimum, and breaks for every loss", () => {
  for (const iv of randomInputs(3, 800, 10)) {
    const best = m.optima(iv);
    for (const rule of ["finish", "start", "shortest", "conflicts"]) {
      const kept = m.runSchedule(iv, rule).kept;
      for (const opt of best.sets) {
        const { firstFailure } = m.staysAhead(iv, kept, opt);
        if (rule === "finish") assert.equal(firstFailure, null);
        if (kept.length < best.size) assert.notEqual(firstFailure, null, `${rule} lost but the lemma held`);
      }
    }
  }
});

test("the stab lines are a certificate: one per kept interval, and every interval crosses one", () => {
  for (const iv of randomInputs(4, 2000)) {
    const kept = m.runSchedule(iv, "finish").kept;
    const times = m.stabTimes(iv, kept);
    assert.equal(times.length, kept.length);
    for (const a of iv) assert.ok(times.some((t) => m.stabbedBy(a, t)));
  }
});

test("each preset loses for its rule, as the experiment's search found", () => {
  const byRule = Object.fromEntries(results.smallest_counterexamples.filter(Boolean).map((c) => [`${c.kind}:${c.rule}`, c]));
  for (const p of m.PRESETS.filter((p) => p.id !== "mixed")) {
    assert.ok(m.fails(p.intervals, p.mode, p.rule), p.id);
    const key = `${p.mode === "schedule" ? "scheduling" : "partitioning"}:${p.rule}`;
    const source = p.rule === "conflicts" ? results.conflicts_shrink_search : byRule[key];
    assert.deepEqual(p.intervals.map((a) => [a.s, a.f]), source.intervals, p.id);
  }
  const mixed = m.PRESETS[0].intervals;
  assert.deepEqual(["finish", "start", "shortest", "conflicts"].map((rule) => m.runSchedule(mixed, rule).kept.length), [4, 2, 3, 4]);
});

test("the search finds losses for wrong rules and none for the proven ones", () => {
  for (const rule of ["start", "shortest"]) assert.ok(m.searchCounterexample("schedule", rule, 5, 5000).found, rule);
  assert.ok(m.searchCounterexample("partition", "finish", 5, 5000).found);
  assert.equal(m.searchCounterexample("schedule", "finish", 5, 500).found, null);
  assert.equal(m.searchCounterexample("partition", "start", 5, 2000).found, null);
});

test("renders every preset in both modes with one draggable bar per interval", () => {
  for (const p of m.PRESETS) {
    const html = r.render({ preset: p.id });
    assert.equal((html.match(/<g class="ig-bar ig-edit[^"]*" data-i=/g) ?? []).length, p.intervals.length, p.id);
    for (const mode of ["schedule", "partition"]) {
      const state = { ...r.initialState({ preset: p.id }), mode };
      for (let step = 0; step <= p.intervals.length; step++) {
        state.step = step;
        assert.match(r.chart(state), /^<svg class="ig-svg"/);
        assert.ok(r.narration(state).length > 20);
      }
    }
  }
});
