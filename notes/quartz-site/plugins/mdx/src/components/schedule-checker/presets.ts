// The figure's starting schedules. Each is also in
// content/systems/databases/isolation-experiments/anomalies.py, which replayed
// it on PostgreSQL 16 and MySQL 8.0 at all four isolation levels; the test
// checks that the two lists agree.

import type { Step } from "./model";

export interface Preset {
  label: string;
  init: Record<string, number>;
  steps: Step[];
  /** What the transactions do, in one or two sentences. */
  story: string;
}

const r = (t: number, key: string): Step => ({ op: "r", t, key });
const set = (t: number, key: string, v: number): Step => ({ op: "w", t, key, set: v });
const add = (t: number, key: string, n: number): Step => ({ op: "w", t, key, add: n });
const c = (t: number): Step => ({ op: "c", t });
const a = (t: number): Step => ({ op: "a", t });

export const presets: Record<string, Preset> = {
  P4_lost_update: {
    label: "Lost update (P4)",
    init: { x: 100 },
    steps: [r(1, "x"), r(2, "x"), add(2, "x", 20), c(2), add(1, "x", 10), c(1)],
    story: "T1 adds 10 and T2 adds 20 to x = 100, each writing back the value it read plus its amount. A serial run ends at 130.",
  },
  A5B_write_skew: {
    label: "Write skew (A5B)",
    init: { x: 1, y: 1 },
    steps: [r(1, "x"), r(1, "y"), r(2, "x"), r(2, "y"), set(1, "x", 0), set(2, "y", 0), c(1), c(2)],
    story: "x and y are two doctors, 1 meaning on call. Each transaction sees both on call and takes one off. The rule is that one stays on.",
  },
  A5A_read_skew: {
    label: "Read skew (A5A)",
    init: { x: 50, y: 50 },
    steps: [r(1, "x"), set(2, "x", 40), set(2, "y", 60), c(2), r(1, "y"), c(1)],
    story: "T2 moves 10 from x to y, keeping x + y = 100. T1 reads x before the transfer and y after it.",
  },
  P2_fuzzy_read: {
    label: "Fuzzy read (P2)",
    init: { x: 50 },
    steps: [r(1, "x"), set(2, "x", 5), c(2), r(1, "x"), c(1)],
    story: "T1 reads x twice; between the reads T2 changes it and commits.",
  },
  P1_dirty_read: {
    label: "Dirty read (P1)",
    init: { x: 50, y: 50 },
    steps: [set(1, "x", 10), r(2, "x"), a(1), c(2)],
    story: "T1 writes x = 10 and then rolls back. T2 reads x while T1 is still running.",
  },
  P0_dirty_write: {
    label: "Dirty write (P0)",
    init: { x: 0 },
    steps: [set(1, "x", 1), set(2, "x", 2), a(1), c(2)],
    story: "T2 writes x while T1's uncommitted write is still in place, then T1 rolls back. Restoring x's value from before T1 would also erase T2's write.",
  },
  H1_transfer_dirty_read: {
    label: "Critique H1 (P1 without A1)",
    init: { x: 50, y: 50 },
    steps: [r(1, "x"), add(1, "x", -40), r(2, "x"), r(2, "y"), c(2), r(1, "y"), add(1, "y", 40), c(1)],
    story: "T1 moves 40 from x to y. T2 reads both in the middle of the transfer and commits. Nothing aborts, so the strict reading A1 does not apply.",
  },
  H2_transfer_fuzzy_read: {
    label: "Critique H2 (P2 without A2)",
    init: { x: 50, y: 50 },
    steps: [r(1, "x"), r(2, "x"), add(2, "x", -40), r(2, "y"), add(2, "y", 40), c(2), r(1, "y"), c(1)],
    story: "T2 moves 40 from x to y while T1 reads x before the transfer and y after it. T1 never rereads x, so the strict reading A2 does not apply.",
  },
};
