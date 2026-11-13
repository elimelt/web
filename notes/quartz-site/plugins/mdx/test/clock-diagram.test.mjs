// Checks that the clock diagram computes what the clocks note says it does.
// Each clock is checked against an independent definition computed from the
// diagram's happens-before relation, on many random diagrams.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/clock-diagram/model.ts");

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

function randomDiagram(seed) {
  const r = rng(seed);
  const offsets = Array.from({ length: m.PROCS }, () => Math.round((r() * 2 - 1) * m.OFFSET_LIMIT));
  let d = { events: [], msgs: [], offsets };
  for (let tries = 0; tries < 60 && d.events.length < m.MAX_EVENTS - 1; tries++) {
    const p = Math.floor(r() * m.PROCS);
    const t = r() * m.T_MAX;
    const edit =
      r() < 0.5
        ? m.addLocal(d, p, t)
        : m.addMessage(d, { proc: p, t }, { proc: (p + 1 + Math.floor(r() * (m.PROCS - 1))) % m.PROCS, t: t + 1 + r() * 20 });
    if (edit.ok) d = edit.diagram;
  }
  return d;
}

const diagrams = Array.from({ length: 300 }, (_, i) => randomDiagram(i + 1));

test("random diagrams are nontrivial", () => {
  const sizes = diagrams.map((d) => d.events.length);
  const msgs = diagrams.map((d) => d.msgs.length);
  assert.ok(Math.min(...sizes) >= 8, `smallest diagram has ${Math.min(...sizes)} events`);
  assert.ok(msgs.reduce((a, b) => a + b) / msgs.length >= 3);
});

test("vector order is exactly happens-before", () => {
  for (const d of diagrams) {
    const c = m.compute(d);
    for (const a of c.events) for (const b of c.events) {
      assert.equal(m.vectorOrder(a.vector, b.vector), m.happensBefore(c, a.id, b.id), `${a.name} vs ${b.name}`);
    }
  }
});

test("a vector entry counts that process's events in the causal past", () => {
  for (const d of diagrams) {
    const c = m.compute(d);
    for (const e of c.events) {
      const i = c.index.get(e.id);
      const counts = new Array(m.PROCS).fill(0);
      counts[e.proc] += 1;
      for (const j of c.past[i]) counts[c.events[j].proc] += 1;
      assert.deepEqual(e.vector, counts);
    }
  }
});

test("a Lamport timestamp is the length of the longest causal chain ending at the event", () => {
  for (const d of diagrams) {
    const c = m.compute(d);
    const chain = [];
    c.events.forEach((e, i) => {
      chain[i] = 1 + Math.max(0, ...[...c.past[i]].map((j) => chain[j]));
      assert.equal(e.lamport, chain[i]);
    });
  }
});

test("Lamport and hybrid clocks respect happens-before; physical clocks need not", () => {
  let physicalWrong = 0;
  for (const d of diagrams) {
    const c = m.compute(d);
    for (const a of c.events) for (const b of c.events) {
      if (m.happensBefore(c, a.id, b.id) !== "before") continue;
      assert.equal(m.lamportOrder(a, b), "before");
      assert.equal(m.hlcOrder(a, b), "before");
      if (m.physicalOrder(a, b) !== "before") physicalWrong += 1;
    }
  }
  assert.ok(physicalWrong > 0, "random offsets should break physical ordering somewhere");
});

test("the hybrid clock never trails its physical clock and leads it by at most the clock spread", () => {
  for (const d of diagrams) {
    const c = m.compute(d);
    // Readings are truncated to whole ms, which can add one more.
    const spread = Math.max(...d.offsets) - Math.min(...d.offsets) + 1;
    for (const e of c.events) {
      assert.ok(e.hlc.l >= e.pt);
      assert.ok(m.hlcLead(e) <= spread, `${e.name}: lead ${m.hlcLead(e)} > ${spread}`);
    }
  }
});

test("hybrid clock update rules follow Kulkarni et al.", () => {
  assert.deepEqual(m.hlcLocal({ l: 10, c: 3 }, 12), { l: 12, c: 0 });
  assert.deepEqual(m.hlcLocal({ l: 10, c: 3 }, 9), { l: 10, c: 4 });
  assert.deepEqual(m.hlcRecv({ l: 10, c: 3 }, { l: 10, c: 5 }, 8), { l: 10, c: 6 });
  assert.deepEqual(m.hlcRecv({ l: 10, c: 3 }, { l: 9, c: 7 }, 8), { l: 10, c: 4 });
  assert.deepEqual(m.hlcRecv({ l: 8, c: 3 }, { l: 11, c: 7 }, 9), { l: 11, c: 8 });
  assert.deepEqual(m.hlcRecv({ l: 8, c: 3 }, { l: 9, c: 7 }, 12), { l: 12, c: 0 });
});

test("the skew example shows a message the physical clocks put backwards", () => {
  const d = m.examples.skew.diagram;
  const c = m.compute(d);
  const [a2, b1] = ["a2", "b1"].map((id) => c.byId.get(id));
  assert.equal(m.happensBefore(c, "a2", "b1"), "before");
  assert.equal(m.physicalOrder(a2, b1), "after");
  assert.equal(m.hlcOrder(a2, b1), "before");
  assert.deepEqual(b1.hlc, { l: a2.hlc.l, c: a2.hlc.c + 1 });
});

test("the concurrent example has concurrent events that Lamport orders anyway", () => {
  const c = m.compute(m.examples.concurrent.diagram);
  const [a3, c1] = m.examples.concurrent.pick.map((id) => c.byId.get(id));
  assert.equal(m.happensBefore(c, a3.id, c1.id), "concurrent");
  assert.notEqual(m.lamportOrder(a3, c1), "same");
  assert.equal(m.vectorOrder(a3.vector, c1.vector), "concurrent");
});

test("edits reject impossible diagrams", () => {
  const d = { events: [], msgs: [], offsets: [0, 0, 0] };
  assert.equal(m.addMessage(d, { proc: 0, t: 20 }, { proc: 1, t: 20 }).ok, false);
  assert.equal(m.addMessage(d, { proc: 0, t: 20 }, { proc: 0, t: 30 }).ok, false);
  const one = m.addLocal(d, 0, 10);
  assert.ok(one.ok);
  assert.equal(m.addLocal(one.diagram, 0, 12).ok, false);
  const msg = m.addMessage(one.diagram, { proc: 1, t: 5 }, { proc: 2, t: 9 });
  assert.ok(msg.ok);
  const removed = m.remove(msg.diagram, msg.id);
  assert.equal(removed.events.length, 1);
  assert.equal(removed.msgs.length, 0);
});

test("renders the figure for both examples", async () => {
  const { render } = await load("components/clock-diagram/render.ts");
  for (const [example, ex] of Object.entries(m.examples)) {
    const html = render({ example, view: "vector" });
    assert.match(html, new RegExp(`^<figure class="cd" data-example="${example}" data-view="vector">`));
    assert.equal((html.match(/class="cd-ev /g) ?? []).length, ex.diagram.events.length);
    assert.ok(html.includes("<table class=\"cd-table\">"));
  }
});
