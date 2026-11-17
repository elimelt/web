// Checks the snapshot cut figure against independent references: the Python
// analysis of the same recorded run (analyze.py and figure_trace.py, which
// read the full logs rather than the window), Babaoglu and Marzullo's vector
// clock test, and the money-conservation identity, on the recorded window
// and on random computations.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/snapshot-cut/model.ts");
const { trace } = await load("components/snapshot-cut/trace.ts");
const r = await load("components/snapshot-cut/render.ts");

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

/** A random message-passing computation in the figure's trace format. */
function randomTrace(seed) {
  const R = rng(seed);
  const n = 2 + Math.floor(R() * 3);
  const events = Array.from({ length: n }, () => []);
  const messages = [];
  const pending = [];
  let t = 0;
  for (let step = 0; step < 6 + Math.floor(R() * 14); step++) {
    t += 1 + R() * 10;
    const p = Math.floor(R() * n);
    const ready = pending.filter((x) => x.dst === p && x.at <= t);
    if (ready.length && R() < 0.6) {
      const x = ready[Math.floor(R() * ready.length)];
      pending.splice(pending.indexOf(x), 1);
      events[p].push({ kind: "recv", t, msg: x.msg });
      messages[x.msg].to = [p, events[p].length];
    } else {
      const dst = (p + 1 + Math.floor(R() * (n - 1))) % n;
      const msg = messages.length;
      events[p].push({ kind: "send", t, msg });
      messages.push({ amount: 1 + Math.floor(R() * 50), src: p, dst, from: [p, events[p].length], to: null });
      pending.push({ dst, msg, at: t + 1 + R() * 15 });
    }
  }
  return { events, messages, base: new Array(n).fill(100), total: 100 * n, inflightAtStart: [], markers: [] };
}

test("message test and vector clock test agree on every cut of the recorded window", () => {
  const vc = m.vectorClocks(trace);
  const cuts = m.allCuts(trace);
  assert.equal(cuts.length, trace.allCuts);
  for (const c of cuts) assert.equal(m.analyzeCut(trace, c).consistent, m.vcConsistent(vc, c), `cut ${c}`);
});

test("the consistent-cut count matches figure_trace.py, which checked the full run", () => {
  assert.equal(m.countConsistent(trace), trace.consistentCuts);
  assert.equal(trace.consistentCuts, 85);
});

test("money is conserved exactly on consistent cuts, and orphans are double counted", () => {
  for (const c of m.allCuts(trace)) {
    const s = m.analyzeCut(trace, c);
    assert.equal(s.balanceSum + s.inflightSum, trace.total + s.orphanSum, `cut ${c}`);
    if (s.consistent) assert.equal(s.balanceSum + s.inflightSum, trace.total);
  }
});

test("the recorded Chandy-Lamport cut is consistent and its channel records are the messages in flight", () => {
  const cl = trace.cuts.cl;
  const s = m.analyzeCut(trace, cl.cut);
  assert.ok(s.consistent);
  assert.deepEqual(s.balances, cl.balances);
  assert.deepEqual([...s.inflight].sort(), cl.channels.map((x) => x.msg).sort());
  for (const x of cl.channels) {
    assert.equal(trace.messages[x.msg].src, x.from);
    assert.equal(trace.messages[x.msg].dst, x.to);
  }
  // analyze.py, run on the whole log: 0 orphans, 3 messages in flight.
  assert.equal(s.orphans.length, 0);
  assert.equal(s.inflight.length, 3);
});

test("the recorded uncoordinated cut matches analyze.py: one orphan, three in flight", () => {
  const nv = trace.cuts.naive;
  const s = m.analyzeCut(trace, nv.cut);
  assert.deepEqual(s.balances, nv.balances);
  assert.equal(s.orphans.length, 1);
  assert.equal(s.inflight.length, 3);
});

test("largestConsistentWithin is consistent, inside the cut, and the componentwise maximum", () => {
  const all = m.allCuts(trace);
  const consistent = all.filter((c) => m.analyzeCut(trace, c).consistent);
  for (const c of all) {
    const f = m.largestConsistentWithin(trace, c);
    assert.ok(m.analyzeCut(trace, f).consistent);
    assert.ok(f.every((x, i) => x <= c[i]));
    for (const d of consistent) {
      if (d.every((x, i) => x <= c[i])) assert.ok(d.every((x, i) => x <= f[i]), `${d} is inside ${c} but not ${f}`);
    }
  }
});

test("on random computations the two consistency tests agree and conservation holds", () => {
  let inconsistent = 0;
  let total = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const t = randomTrace(seed);
    const vc = m.vectorClocks(t);
    for (const c of m.allCuts(t)) {
      const s = m.analyzeCut(t, c);
      assert.equal(s.consistent, m.vcConsistent(vc, c), `seed ${seed} cut ${c}`);
      assert.equal(s.balanceSum + s.inflightSum, t.total + s.orphanSum);
      total++;
      if (!s.consistent) inconsistent++;
    }
  }
  assert.ok(inconsistent > 0.2 * total && inconsistent < total, `${inconsistent} of ${total}`);
});

test("the figure renders, and cutAtX inverts gapX", () => {
  const html = r.render({ start: "naive" });
  assert.match(html, /Inconsistent/);
  assert.match(r.render({ start: "cl" }), /Consistent\./);
  for (let p = 0; p < r.PROCS; p++) {
    for (let k = 0; k <= trace.events[p].length; k++) assert.equal(r.cutAtX(p, r.gapX(p, k)), k);
  }
});
