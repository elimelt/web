// The figure's starting interleavings. Each one is also in
// content/systems/databases/mvcc-experiments/schedules.json, which
// schedule.py replayed on PostgreSQL 16; the test checks the two agree.

import type { Level, Step } from "./model";

export interface Scenario {
  label: string;
  init: Record<string, number>;
  steps: Step[];
  level: Level;
  /** One line on what the transactions are doing. */
  story: string;
  /** What the outcome means for the application, given the final state. */
  check?: (final: Record<string, number>, reads: Record<number, Record<string, number>>) => string;
}

const r = (t: number, key: string): Step => ({ op: "r", t, key });
const set = (t: number, key: string, v: number): Step => ({ op: "w", t, key, set: v });
const add = (t: number, key: string, n: number): Step => ({ op: "w", t, key, add: n });
const c = (t: number): Step => ({ op: "c", t });

export const scenarios: Record<string, Scenario> = {
  write_skew: {
    label: "On-call doctors (write skew)",
    init: { alice: 1, bob: 1 },
    steps: [r(1, "alice"), r(1, "bob"), r(2, "alice"), r(2, "bob"), set(1, "alice", 0), set(2, "bob", 0), c(1), c(2)],
    level: "rr",
    story: "1 means on call. Alice (T1) and Bob (T2) each check that two doctors are on call, then take themselves off. The rule: at least one stays on.",
    check: (f) => {
      const n = (f.alice ?? 0) + (f.bob ?? 0);
      return n === 0 ? "Nobody is on call: the rule is broken." : `${n} on call: the rule holds.`;
    },
  },
  lost_update_wait: {
    label: "Two increments (lost update)",
    init: { x: 0 },
    steps: [r(1, "x"), r(2, "x"), add(1, "x", 1), add(2, "x", 1), c(1), c(2)],
    level: "rc",
    story: "Two clients each read a counter and write back what they read plus one, as an application's read-modify-write does.",
    check: (f) => (f.x === 2 ? "The counter is 2: both increments counted." : `The counter is ${f.x}.`),
  },
  read_skew: {
    label: "A transfer seen halfway (read skew)",
    init: { x: 50, y: 50 },
    steps: [r(1, "x"), r(2, "x"), r(2, "y"), add(2, "x", -10), add(2, "y", 10), c(2), r(1, "y"), c(1)],
    level: "rc",
    story: "T2 moves 10 from account x to account y while T1 adds up the two balances. The total is always 100.",
    check: (_f, reads) => {
      const t = reads[1];
      if (t?.x === undefined || t?.y === undefined) return "";
      const sum = t.x + t.y;
      return sum === 100 ? "T1 adds up 100, the true total." : `T1 adds up ${sum}, a total that never existed.`;
    },
  },
  read_only_anomaly: {
    label: "A read-only transaction sees too much",
    init: { x: 0, y: 0 },
    steps: [r(2, "x"), r(2, "y"), r(1, "y"), add(1, "y", 20), c(1), r(3, "x"), r(3, "y"), c(3), set(2, "x", -11), c(2)],
    level: "rr",
    story: "Checking x and savings y start at 0. T1 deposits 20 into savings. T2 withdraws 10 from checking and charges a 1 fee because x + y looked negative. T3 only prints the balances (Fekete, O'Neil and O'Neil, 2004).",
    check: (f, reads) => {
      const t3 = reads[3];
      if (t3?.x === undefined || t3?.y === undefined) return "";
      return f.x === -11 && t3.y === 20
        ? "T3 printed the deposit but no withdrawal, yet the fee says the withdrawal came first."
        : "";
    },
  },
  long_reader: {
    label: "A long reader holds back cleanup",
    init: { x: 0 },
    steps: [r(1, "x"), r(2, "x"), add(2, "x", 1), c(2), r(3, "x"), add(3, "x", 1), c(3), r(1, "x"), c(1)],
    level: "rr",
    story: "T1 reads x and stays open while T2 and T3 each add one. Watch which old versions can be removed while T1 is still running.",
  },
  chain_unsafe: {
    label: "Three transactions in a chain",
    init: { x: 0, y: 0 },
    steps: [r(1, "x"), set(2, "x", 1), r(2, "y"), set(3, "y", 1), c(3), c(2), c(1)],
    level: "ser",
    story: "T1 reads x before T2 changes it, and T2 reads y before T3 changes it. Move T3's commit to the end and compare.",
  },
};

export const scenarioKeys = Object.keys(scenarios);
export const startScenario = (key: unknown): string => (typeof key === "string" && key in scenarios ? key : "write_skew");
