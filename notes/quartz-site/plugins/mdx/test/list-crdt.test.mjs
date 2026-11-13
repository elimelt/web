// Checks the replicated-text figure's three list CRDTs against independent
// references: its RGA must converge to the same text as Automerge (whose text
// type is RGA) and its Fugue to the same text as a separate Python Fugue, on
// recorded random sessions. Logoot positions are checked by property, and the
// interleaving behavior against what the papers prove.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/list-crdt/model.ts");
const r = await load("components/list-crdt/render.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(
  readFileSync(path.join(here, "../../../../content/systems/distributed-systems/crdts-experiments/reference-sessions.json"), "utf8"),
);

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Replays a recorded session (base text, edits at A and B, full syncs) through one algorithm. */
function replaySession(algo, s, seed = 1) {
  const sim = m.newSim(algo, false, s.base, seed);
  for (const a of s.actions) m.act(sim, a.sync ? { sync: true } : a);
  return sim;
}

test("RGA converges to the same text as Automerge on every recorded session", () => {
  assert.ok(ref.sessions.length >= 50);
  for (const s of ref.sessions) {
    const sim = replaySession("rga", s);
    assert.equal(sim.docs.A.text(), s.automerge, `session ${s.seed}`);
    assert.equal(sim.docs.B.text(), s.automerge, `session ${s.seed}`);
  }
});

test("Fugue converges to the same text as the Python Fugue on every recorded session", () => {
  for (const s of ref.sessions) {
    const sim = replaySession("fugue", s);
    assert.equal(sim.docs.A.text(), s.fugue, `session ${s.seed}`);
    assert.equal(sim.docs.B.text(), s.fugue, `session ${s.seed}`);
  }
});

test("every algorithm converges on the recorded sessions, whatever the Logoot seed", () => {
  for (const s of ref.sessions) {
    for (const seed of [1, 2, 3]) {
      const sim = replaySession("logoot", s, seed);
      assert.equal(sim.docs.A.text(), sim.docs.B.text(), `session ${s.seed} seed ${seed}`);
    }
  }
});

test("Logoot positions fall strictly between their neighbours and stay sorted", () => {
  const rand = rng(11);
  for (let t = 0; t < 300; t++) {
    let ps = [[], null];
    const doc = [];
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(rand() * (doc.length + 1));
      const p = i > 0 ? doc[i - 1] : [];
      const q = i < doc.length ? doc[i] : null;
      const pos = m.between(p, q, rand() < 0.5 ? "A" : "B", k + 1, rand);
      assert.ok(m.cmpPos(p, pos) < 0, "above the left neighbour");
      if (q) assert.ok(m.cmpPos(pos, q) < 0, "below the right neighbour");
      doc.splice(i, 0, pos);
    }
    ps = doc;
    for (let k = 1; k < ps.length; k++) assert.ok(m.cmpPos(ps[k - 1], ps[k]) < 0);
  }
});

test("delivering an op twice changes nothing", () => {
  for (const algo of m.ALGOS) {
    const a = m.createDoc(algo, "A", 3);
    const b = m.createDoc(algo, "B", 4);
    const ops = [...m.splice(a, 0, 0, "hello"), a.remove(1), a.insert(2, "X")];
    for (const op of ops) b.apply(op);
    const before = JSON.stringify(b.elems());
    for (const op of ops) assert.equal(b.apply(op), false);
    assert.equal(JSON.stringify(b.elems()), before);
    assert.equal(b.text(), a.text());
  }
});

test("interleaving: Fugue never, RGA only when typing backwards, Logoot often", () => {
  const counts = { fugue: [0, 0], rga: [0, 0], logoot: [0, 0] };
  for (let t = 1; t <= 200; t++) {
    const rand = rng(t);
    const word = (abc) => Array.from({ length: 3 + Math.floor(rand() * 5) }, () => abc[Math.floor(rand() * abc.length)]).join("");
    const w1 = word("abcdef");
    const w2 = word("UVWXYZ");
    const at = Math.floor(rand() * 7);
    for (const algo of m.ALGOS) {
      for (const [k, back] of [[0, false], [1, true]]) {
        const sim = m.newSim(algo, false, "------", t);
        m.type(sim, "A", w1, at, back);
        m.type(sim, "B", w2, at, back);
        m.sync(sim);
        const region = sim.docs.A.text().slice(at, at + w1.length + w2.length);
        const mixed = region !== w1 + w2 && region !== w2 + w1;
        assert.equal(mixed, sim.splits > 0, `${algo} ${back}: splits agrees with the text`);
        if (mixed) counts[algo][k]++;
      }
    }
  }
  assert.deepEqual(counts.fugue, [0, 0]);
  assert.equal(counts.rga[0], 0, "RGA is forward non-interleaving");
  assert.equal(counts.rga[1], 200, "RGA interleaves two words typed back to front");
  assert.ok(counts.logoot[0] > 100 && counts.logoot[1] > 100);
});

test("the scenarios show what the note says", () => {
  const after = (algo, key) => {
    const sim = m.scenarioSim(algo, key);
    assert.ok(m.pending(sim) > 0, "a scenario starts with edits in flight");
    m.sync(sim);
    return sim;
  };
  assert.equal(after("fugue", "forwards").docs.A.text(), "Hello Alice Charlie!");
  assert.equal(after("fugue", "backwards").docs.A.text(), "Hello Alice Charlie!");
  assert.equal(after("rga", "forwards").splits, 0);
  assert.ok(after("rga", "backwards").splits > 0);
  assert.ok(after("logoot", "forwards").splits > 0);
  for (const algo of m.ALGOS) assert.equal(after(algo, "deleteEdit").docs.A.text(), "Hi there!");
});

test("switching algorithm replays the same keystrokes", () => {
  const sim = m.scenarioSim("logoot", "backwards");
  m.sync(sim);
  m.edit(sim, "B", sim.docs.B.text() + "?");
  for (const algo of m.ALGOS) {
    const again = m.replay(algo, sim.log, false);
    assert.equal(again.log.length, sim.log.length);
    assert.equal(again.docs.B.text().endsWith("!?"), true);
  }
  assert.equal(m.replay("logoot", sim.log, false).docs.B.text(), sim.docs.B.text());
});

test("diff finds the single splice between two strings", () => {
  const rand = rng(5);
  for (let t = 0; t < 500; t++) {
    const s = Array.from({ length: Math.floor(rand() * 8) }, () => "ab"[Math.floor(rand() * 2)]).join("");
    const at = Math.floor(rand() * (s.length + 1));
    const del = Math.floor(rand() * (s.length - at + 1));
    const ins = Array.from({ length: Math.floor(rand() * 3) }, () => "ab"[Math.floor(rand() * 2)]).join("");
    const after = s.slice(0, at) + ins + s.slice(at + del);
    const d = m.diff(s, after);
    assert.equal(s.slice(0, d.at) + d.ins + s.slice(d.at + d.del), after);
    assert.ok(d.del <= del && d.ins.length <= ins.length, "no larger than the edit made");
  }
});

test("the build renders the finished figure with its controls disabled", () => {
  const html = r.render({ algo: "rga", scenario: "backwards" });
  assert.match(html, /<figure class="lc" data-algo="rga">/);
  assert.match(html, /value="Hello Alice!"/);
  assert.match(html, /value="Hello Charlie!"/);
  assert.match(html, /14 in flight/);
  for (const control of html.match(/<(input|select|button)\b[^>]*>/g)) assert.match(control, /\bdisabled\b/);
  assert.doesNotMatch(html, /\bid="/, "no page-global ids, so two copies can share a page");
  assert.equal(r.render({ algo: "nope", scenario: "nope" }), r.render({}));
});
