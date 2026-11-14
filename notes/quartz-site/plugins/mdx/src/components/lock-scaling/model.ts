// Recorded results of lock_bench.c (see the note's "How this was measured"),
// summarized by summarize_lock_bench.py, and the presets that pick which of
// them a chart shows. Nothing here is simulated: every point is a median of
// real runs, with the fastest and slowest run as its whiskers.

import summaryJson from "../../../../../../content/systems/operating-systems/v2-concurrency/lock_bench-summary.json";

export type Lock = "racy" | "atomic" | "tas" | "ttas" | "ticket" | "mcs" | "mutex";

export interface Point {
  threads: number;
  runs: number;
  /** Operations per second, over all threads. */
  median: number;
  min: number;
  max: number;
  /** The slowest thread's operations as a fraction of an even split (1 is perfectly fair). */
  share: number;
  /** Fraction of increments lost (only nonzero for the racy counter). */
  lost: number;
}

export const DATA = summaryJson as Record<Lock, Point[]>;

/** Cores on the machine that ran the benchmark. */
export const CORES = 4;

export const LABELS: Record<Lock, string> = {
  racy: "no lock (wrong answer)",
  atomic: "atomic fetch_add",
  tas: "test-and-set",
  ttas: "test-and-test-and-set",
  ticket: "ticket",
  mcs: "MCS",
  mutex: "pthread mutex",
};

export type Metric = "throughput" | "share";

export interface Preset {
  locks: Lock[];
  threads: number[];
  metric: Metric;
  caption: string;
}

export const PRESETS: Record<string, Preset> = {
  contention: {
    locks: ["tas", "ttas", "ticket", "mcs", "mutex"],
    threads: [1, 2, 3, 4],
    metric: "throughput",
    caption:
      "Measured: total lock acquisitions per second, summed over all threads, when every thread wants the lock all the time. One thread per core, four cores. Points are medians of five one-second runs; whiskers span the fastest and slowest run. Log scale.",
  },
  oversubscribed: {
    locks: ["ttas", "ticket", "mcs", "mutex"],
    threads: [1, 2, 3, 4, 6, 8, 12, 16],
    metric: "throughput",
    caption:
      "Measured: the same benchmark continued past the four cores. In the shaded region there are more threads than cores, so the scheduler preempts some of them. Log scale.",
  },
  fairness: {
    locks: ["tas", "ttas", "ticket", "mcs", "mutex"],
    threads: [2, 3, 4],
    metric: "share",
    caption:
      "Measured: how much the unluckiest thread got, as a fraction of an even split. 1 means every thread acquired the lock equally often; 0.5 means the slowest thread got half its share. Medians of five runs, one thread per core.",
  },
  lockfree: {
    locks: ["atomic", "mutex", "ttas"],
    threads: [1, 2, 3, 4, 6, 8, 12, 16],
    metric: "throughput",
    caption:
      "Measured: incrementing the counter with one atomic fetch_add, against wrapping counter++ in a lock. Shaded: more threads than cores. Log scale.",
  },
};

export const DEFAULT_PRESET = "contention";
export const presetKey = (v: unknown): string => (typeof v === "string" && v in PRESETS ? v : DEFAULT_PRESET);

export function point(lock: Lock, threads: number): Point {
  const p = DATA[lock].find((q) => q.threads === threads);
  if (!p) throw new Error(`no ${lock} result for ${threads} threads`);
  return p;
}

export const value = (p: Point, metric: Metric): number => (metric === "share" ? p.share : p.median);

/** Throughput of `lock` at `threads` relative to the same lock on one thread. */
export const vsOne = (lock: Lock, threads: number): number => point(lock, threads).median / point(lock, 1).median;
