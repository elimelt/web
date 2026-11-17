// Checks the Paxos stepper against independent references: an exhaustive
// search of every interleaving of a small instance (one round per proposer,
// so rounds 1 and 2, as in the two-ballot TLA+ model of Paxos.tla;
// any delivery order, any message never delivered), which must find no
// state with two chosen values under the Paxos rule and must find one when
// the proposer ignores reported values; random runs with crashes and losses;
// and the three scripted presets the note describes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/paxos-stepper/model.ts");
const r = await load("components/paxos-stepper/render.ts");

function run(s, steps) {
  for (let i = 0; i < steps; i++) {
    const t = m.apply(s, { type: "next" });
    if (t === s) return s;
    s = t;
  }
  return s;
}

/** A state's identity for the search: message ids, history and counters left out. */
function key(s) {
  const msgs = s.inFlight.map((x) => JSON.stringify([x.from, x.to, x.kind, x.n, x.prev ?? null, x.v ?? null])).sort();
  const votes = [...new Set(s.votes.map((v) => `${v.a}${v.n}${v.v}`))].sort();
  const prop = m.PROPOSERS.map((p) => {
    const q = s.prop[p];
    return [q.n, q.phase, q.value, q.rounds, JSON.stringify(Object.entries(q.promises).sort()), [...q.acks].sort().join()];
  });
  return JSON.stringify([s.acc, prop, msgs, votes]);
}

function search(adopt, maxRounds = 1) {
  const start = m.initial({ adopt });
  const seen = new Set([key(start)]);
  const queue = [start];
  let violation = null;
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i];
    if (m.chosenValues(s).length > 1) {
      violation = s;
      break;
    }
    const next = [];
    for (const p of m.PROPOSERS) if (s.prop[p].rounds < maxRounds) next.push(m.apply(s, { type: "start", p }));
    const done = new Set();
    for (const msg of s.inFlight) {
      const k = JSON.stringify([msg.from, msg.to, msg.kind, msg.n, msg.prev ?? null, msg.v ?? null]);
      if (done.has(k)) continue;
      done.add(k);
      next.push(m.apply(s, { type: "deliver", id: msg.id }));
    }
    for (const t of next) {
      const k = key(t);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(t);
      }
    }
  }
  return { states: seen.size, violation };
}

test("exhaustive search: the Paxos rule never chooses two values", () => {
  const res = search(true);
  assert.equal(res.violation, null);
  assert.ok(res.states > 1000, `searched ${res.states} states`);
});

test("exhaustive search: ignoring reported values can choose two values", () => {
  const res = search(false);
  assert.ok(res.violation, "expected a violation");
  assert.equal(m.chosenValues(res.violation).length, 2);
});

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("random runs with crashes, losses and reordering keep agreement and the acceptor invariants", () => {
  for (let seed = 1; seed <= 1500; seed++) {
    const rand = rng(seed);
    const pick = (xs) => xs[Math.floor(rand() * xs.length)];
    let s = m.initial({ adopt: true });
    for (let i = 0; i < 80; i++) {
      const u = rand();
      let a;
      if (u < 0.6 && s.inFlight.length) a = { type: "deliver", id: pick(s.inFlight).id };
      else if (u < 0.7 && s.inFlight.length) a = { type: "drop", id: pick(s.inFlight).id };
      else if (u < 0.88) a = { type: "start", p: pick(m.PROPOSERS) };
      else if (u < 0.94) a = { type: "crash", p: pick(m.PROPOSERS) };
      else a = { type: "recover", p: pick(m.PROPOSERS) };
      s = m.manual(s, a);
      assert.ok(m.chosenValues(s).length <= 1, `seed ${seed}: two values chosen`);
      for (const ac of m.ACCEPTORS) {
        const x = s.acc[ac];
        if (x.accepted) assert.ok(x.promised >= x.accepted.n, `seed ${seed}: ${ac} accepted above its promise`);
      }
      // Every reported proposal in a promise is one that acceptor actually accepted.
      for (const msg of s.inFlight)
        if (msg.kind === "promise" && msg.prev) assert.ok(s.votes.some((v) => v.a === msg.from && v.n === msg.prev.n && v.v === msg.prev.v));
    }
  }
});

test("basic preset: x is chosen after 12 messages and P1 learns it", () => {
  const s = run(m.presets.basic.build(true), 100);
  assert.deepEqual(m.chosenValues(s), ["x"]);
  assert.equal(s.sent, 12);
  assert.equal(s.prop.P1.phase, "learned");
});

test("takeover preset: P2 re-proposes x; with the rule off, y is chosen too", () => {
  const good = run(m.presets.takeover.build(true), 200);
  assert.deepEqual(m.chosenValues(good), ["x"]);
  assert.equal(good.prop.P2.value, "x");
  assert.equal(good.prop.P2.phase, "learned");
  const bad = run(m.presets.takeover.build(false), 200);
  assert.deepEqual(m.chosenValues(bad).sort(), ["x", "y"]);
  assert.equal(m.summarize(bad).tone, "bad");
});

test("duel preset: no value is chosen however long it runs, and rounds keep starting", () => {
  let s = m.presets.duel.build(true);
  for (let i = 0; i < 400; i++) {
    const t = m.apply(s, { type: "next" });
    assert.notEqual(t, s, "Next should always have a step");
    s = t;
  }
  assert.deepEqual(m.chosenValues(s), []);
  assert.ok(s.prop.P1.rounds + s.prop.P2.rounds >= 40);
  assert.ok(s.inFlight.length < 10, "rejected messages are delivered, not left to pile up");
});

test("render: each preset renders with controls disabled, and a manual step clears the script", () => {
  for (const preset of ["basic", "takeover", "duel"]) {
    const html = r.render({ preset });
    assert.match(html, /<figure class="px"/);
    assert.doesNotMatch(html, /<button(?![^>]*disabled)[^>]*>/);
  }
  const s = m.presets.takeover.build(true);
  const t = m.manual(s, { type: "deliver", id: s.inFlight[2].id });
  assert.equal(t.script.length, 0);
});
