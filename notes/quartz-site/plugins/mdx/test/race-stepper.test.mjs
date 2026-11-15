// Checks the race stepper's machine against facts derived independently of
// it: the closed-form count of lost updates for two unlocked increments, a
// specific order that breaks the load-then-store lock, and randomized
// schedules that never break the test-and-set lock.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/race-stepper/model.ts");
const r = await load("components/race-stepper/render.ts");

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("two unlocked increments: 20 orders, and only the 2 serial ones reach 2", () => {
  const finals = m.allOrders("counter");
  // C(6, 3) ways to interleave two 3-line threads.
  assert.equal(finals.length, 20);
  // Independently: the result is 2 exactly when one thread's store precedes
  // the other's load, which for 3-line threads means one runs entirely first.
  assert.equal(finals.filter((c) => c === 2).length, 2);
  assert.equal(finals.filter((c) => c === 1).length, 18);
  assert.equal(m.run("counter", ["A", "A", "A", "B", "B", "B"]).mem.counter, 2);
  assert.equal(m.run("counter", ["A", "B", "A", "A", "B", "B"]).mem.counter, 1);
});

test("every interleaving of the unlocked increment matches the store-before-load rule", () => {
  const go = (order, a, b) => {
    if (a === 3 && b === 3) {
      const idx = (t, line) => {
        let seen = -1;
        for (let i = 0; i < order.length; i++) if (order[i] === t && ++seen === line) return i;
      };
      const serial = idx("A", 2) < idx("B", 0) || idx("B", 2) < idx("A", 0);
      assert.equal(m.run("counter", order).mem.counter, serial ? 2 : 1, order.join(""));
      return;
    }
    if (a < 3) go([...order, "A"], a + 1, b);
    if (b < 3) go([...order, "B"], a, b + 1);
  };
  go([], 0, 0);
});

test("the load-then-store lock lets both threads in under A, B, A, B", () => {
  const mm = m.run("broken-lock", ["A", "B", "A", "B", "A", "B"]);
  assert.ok(m.bothInCS(mm));
  assert.ok(mm.overlapSeen);
  assert.equal(m.summary(mm).tone, "bad");
  // And run serially it is fine.
  const serial = m.run("broken-lock", Array(7).fill("A").concat(Array(7).fill("B")));
  assert.ok(m.finished(serial));
  assert.equal(serial.mem.counter, 2);
  assert.equal(serial.overlapSeen, false);
});

test("the test-and-set lock never admits both threads, on 20,000 random schedules", () => {
  const rand = rng(7);
  let finishedRuns = 0;
  let spins = 0;
  for (let trial = 0; trial < 20000; trial++) {
    const mm = m.fresh("tas");
    for (let i = 0; i < 200 && !m.finished(mm); i++) {
      const t = m.done(mm, "A") ? "B" : m.done(mm, "B") ? "A" : rand() < 0.5 ? "A" : "B";
      m.step(mm, t);
      assert.ok(!m.bothInCS(mm), `trial ${trial}`);
    }
    assert.ok(m.finished(mm), `trial ${trial} did not finish`);
    assert.equal(mm.mem.counter, 2);
    assert.equal(mm.mem.held, 0);
    finishedRuns++;
    spins += mm.spins;
  }
  assert.equal(finishedRuns, 20000);
  assert.ok(spins > 0, "some schedules should make a thread spin");
});

test("the same random schedules break the load-then-store lock some of the time", () => {
  const rand = rng(7);
  let overlaps = 0;
  for (let trial = 0; trial < 2000; trial++) {
    const mm = m.fresh("broken-lock");
    for (let i = 0; i < 200 && !m.finished(mm); i++) {
      const t = m.done(mm, "A") ? "B" : m.done(mm, "B") ? "A" : rand() < 0.5 ? "A" : "B";
      m.step(mm, t);
    }
    if (mm.overlapSeen) overlaps++;
  }
  assert.ok(overlaps > 100 && overlaps < 2000, `${overlaps}`);
});

test("the spin hint order makes B spin while A holds the lock", () => {
  const mm = m.run("tas", ["A", "B", "B", "B"]);
  assert.equal(mm.spins, 2);
  assert.equal(mm.th.B.pc, 1);
  assert.match(m.summary(mm).text, /B read held = 1/);
});

test("render: disabled buttons, every preset, unknown preset falls back", () => {
  for (const p of ["counter", "broken-lock", "tas", "nope"]) {
    const html = r.render({ preset: p });
    assert.match(html, /<figure class="rs"/);
    assert.equal((html.match(/ disabled>/g) || []).length, 3);
    assert.ok(!/<(ol|table|input)/.test(html));
  }
  assert.match(r.render({ preset: "nope" }), /data-preset="counter"/);
  assert.doesNotMatch(r.render({ preset: "counter" }), /held/);
  assert.match(r.render({ preset: "tas" }), /test_and_set/);
});
