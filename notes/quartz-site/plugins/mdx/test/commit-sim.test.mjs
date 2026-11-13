// Checks that the two-phase commit simulator behaves like the protocol the
// note describes: the atomic commitment properties hold on random runs, and
// the blocking cases block exactly where the theory says they do.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/commit-sim/model.ts");
const r = await load("components/commit-sim/render.ts");
const P = ["P1", "P2", "P3"];

/** Press Next until nothing more happens. */
function settle(s, limit = 500) {
  for (let i = 0; i < limit; i++) {
    const next = m.apply(s, { type: "next" });
    if (next === s) return s;
    s = next;
  }
  throw new Error("did not settle");
}

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A random run: Next most of the time, with crashes, recoveries, cuts, losses and reordering mixed in. */
function randomRun(seed, steps = 60) {
  const rand = rng(seed);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  let s = m.initial({ cooperative: rand() < 0.5, voteNo: P.filter(() => rand() < 0.15) });
  const trace = [s];
  for (let i = 0; i < steps; i++) {
    const u = rand();
    let a;
    if (u < 0.55) a = { type: "next" };
    else if (u < 0.65 && s.inFlight.length) a = { type: "deliver", id: pick(s.inFlight).id };
    else if (u < 0.7 && s.inFlight.length) a = { type: "lose", id: pick(s.inFlight).id };
    else if (u < 0.8) a = { type: "crash", node: pick(m.NODES) };
    else if (u < 0.9) a = { type: "recover", node: pick(m.NODES) };
    else if (u < 0.95) {
      const [x, y] = pick(m.LINKS);
      a = { type: "cut", a: x, b: y };
    } else a = { type: "timeouts" };
    s = m.apply(s, a);
    trace.push(s);
  }
  return trace;
}

/** Repair every failure: recover all nodes and heal all links. */
function repairAll(s) {
  for (const n of m.NODES) s = m.apply(s, { type: "recover", node: n });
  for (const k of [...s.cut]) {
    const [a, b] = k.split("-");
    s = m.apply(s, { type: "cut", a, b });
  }
  return s;
}

test("the happy path commits with the textbook message and forced-write counts", () => {
  const s = settle(m.initial());
  assert.deepEqual(P.map((p) => s.p[p]), ["committed", "committed", "committed"]);
  assert.equal(s.c.state, "done");
  // PREPARE, vote, decision, ACK to each of 3 participants.
  assert.equal(s.sent, 4 * 3);
  // A prepared and a commit record at each participant, plus the coordinator's commit record.
  assert.equal(s.forced, 2 * 3 + 1);
  assert.equal(m.summarize(s).tone, "good");
});

test("one no vote aborts everyone", () => {
  const s = settle(m.initial({ voteNo: ["P2"] }));
  assert.deepEqual(P.map((p) => s.p[p]), ["aborted", "aborted", "aborted"]);
  assert.deepEqual([...m.outcomes(s)], ["abort"]);
});

test("AC1 and AC2: no run ever decides both ways, and no node changes its decision", () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const trace = randomRun(seed);
    const first = {};
    for (const s of trace) {
      assert.ok(m.outcomes(s).size <= 1, `seed ${seed}: ${JSON.stringify(s.log)}`);
      for (const n of m.NODES) {
        const d = m.loggedDecision(s, n);
        if (d) {
          first[n] ??= d;
          assert.equal(d, first[n], `seed ${seed}: ${n} changed its decision`);
        }
      }
    }
  }
});

test("AC3: commit only if every participant voted yes", () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const trace = randomRun(seed);
    const last = trace.at(-1);
    if (m.outcomes(last).has("commit")) {
      for (const p of P) assert.ok(last.log[p].some((x) => x.text === "prepared"), `seed ${seed}: ${p} committed without voting yes`);
    }
  }
});

test("AC5: once every failure is repaired, every node decides", () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const s = settle(repairAll(randomRun(seed).at(-1)));
    if (s.c.state === "idle") continue; // the commit never started
    for (const p of P) assert.ok(s.p[p] === "committed" || s.p[p] === "aborted", `seed ${seed}: ${p} is ${s.p[p]}`);
    for (const p of P) assert.ok(!m.holdsLocks(s, p));
  }
});

test("a forced record is on disk before the message that depends on it is sent", () => {
  // Crash each node right after each step of a clean run: whatever it said, its log backs up.
  let s = m.initial();
  for (let i = 0; i < 30; i++) {
    for (const p of P) {
      const voted = s.inFlight.some((x) => x.from === p && x.kind === "yes") || s.c.votes[p] === "yes";
      if (voted) assert.ok(s.log[p].some((x) => x.text === "prepared" && x.forced));
    }
    if (s.inFlight.some((x) => x.from === "C" && x.kind === "commit")) assert.ok(s.log.C.some((x) => x.text === "commit" && x.forced));
    const next = m.apply(s, { type: "next" });
    if (next === s) break;
    s = next;
  }
});

test("a coordinator crash during voting blocks every participant, with or without cooperative termination", () => {
  for (const cooperative of [true, false]) {
    let s = m.scenarios.coordCrash.build();
    s = m.apply(s, { type: "cooperative", on: cooperative });
    s = settle(s);
    for (const p of P) {
      const st = m.status(s, p);
      assert.equal(st.kind, "uncertain");
      assert.equal(st.blocked, true);
      assert.ok(st.waitingOn.includes("C"));
    }
    assert.equal(m.summarize(s).tone, "bad");
    // Next shows one futile round of questions before it stops.
    assert.ok(s.history.some((line) => line.includes("asks")), "no participant asked for the decision");
    assert.equal(m.nextAction(s), null);
    // Recovery finds no decision in C's log and aborts.
    s = settle(m.apply(s, { type: "recover", node: "C" }));
    assert.deepEqual(P.map((p) => s.p[p]), ["aborted", "aborted", "aborted"]);
  }
});

test("cooperative termination unblocks participants when one of them learned the decision", () => {
  const on = settle(m.scenarios.partialCommit.build());
  assert.deepEqual(P.map((p) => on.p[p]), ["committed", "committed", "committed"]);
  const off = settle(m.apply(m.scenarios.partialCommit.build(), { type: "cooperative", on: false }));
  assert.equal(off.p.P1, "committed");
  for (const p of ["P2", "P3"]) assert.equal(m.status(off, p).blocked, true);
});

test("a participant cut off from the coordinator learns the outcome from a peer", () => {
  const s = settle(m.scenarios.partition.build());
  assert.equal(s.p.P3, "committed");
  const off = settle(m.apply(m.scenarios.partition.build(), { type: "cooperative", on: false }));
  assert.equal(off.p.P3, "uncertain");
  assert.equal(m.status(off, "P3").blocked, true);
  // Healing the link lets the coordinator's retry through.
  const healed = settle(m.apply(off, { type: "cut", a: "C", b: "P3" }));
  assert.equal(healed.p.P3, "committed");
  assert.equal(healed.c.state, "done");
});

test("a participant that hasn't voted can always settle an uncertain peer by aborting", () => {
  // P1 and P2 vote yes, P3's PREPARE is lost, then C crashes.
  let s = m.run([{ type: "begin" }]);
  const toP3 = s.inFlight.find((x) => x.to === "P3").id;
  s = m.run([{ type: "lose", id: toP3 }, { type: "next" }, { type: "next" }, { type: "crash", node: "C" }], s);
  // P3 is still working, so cooperative termination can abort.
  s = settle(s);
  assert.deepEqual(P.map((p) => s.p[p]), ["aborted", "aborted", "aborted"]);
});

test("repairing the nodes a blocked participant waits on unblocks it", () => {
  let checked = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const s = randomRun(seed).at(-1);
    for (const p of P) {
      const st = m.status(s, p);
      if (st.kind !== "uncertain" || !st.blocked) continue;
      assert.ok(st.waitingOn.length > 0, `seed ${seed}: ${p} blocked on nothing`);
      // Blocked really means stuck: timers and deliveries alone don't help.
      let t = s;
      for (let i = 0; i < 10; i++) {
        t = m.apply(t, { type: "timeouts" });
        while (t.inFlight.length) t = m.apply(t, { type: "deliver", id: t.inFlight[0].id });
      }
      assert.equal(t.p[p], "uncertain", `seed ${seed}: ${p} said blocked but decided`);
      // Bringing back just the nodes it waits on is enough.
      for (const n of st.waitingOn) {
        if (!t.up[n]) t = m.apply(t, { type: "recover", node: n });
        if (t.cut.includes(m.linkKey(p, n))) t = m.apply(t, { type: "cut", a: p, b: n });
      }
      t = settle(t);
      assert.notEqual(t.p[p], "uncertain", `seed ${seed}: ${p} still uncertain after repairing ${st.waitingOn}`);
      checked++;
    }
  }
  assert.ok(checked > 50, `only ${checked} blocked participants checked`);
});

test("the build renders every scenario, and two figures on a page keep separate controls", () => {
  for (const key of Object.keys(m.scenarios)) {
    const html = r.render({ scenario: key });
    assert.match(html, /<figure class="cs"/);
    assert.match(html, /data-part="nodes"/);
  }
  const a = r.render({ scenario: "fresh" });
  // Radio and checkbox names must be scoped by a form, or two figures would share them.
  assert.match(a, /<form class="cs-controls"/);
});
