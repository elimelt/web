// The computations behind the interval-greedy figure. Everything the figure
// shows comes from these functions: the greedy runs, the brute-force optimum,
// the stays-ahead comparison, the depth profile and the counterexample search.
// They mirror greedy_intervals.py beside the note, and a test checks both give
// the same answers on the fixtures that script exports.
//
// Intervals are half-open [s, f) with integer endpoints on [0, HORIZON]. Ties
// in every sort key are broken by finish time, then start time, then position
// in the input, the same as the Python.

export const HORIZON = 16;
export const MAX_INTERVALS = 14;

export interface Interval {
  s: number;
  f: number;
}

export type Rule = "finish" | "start" | "shortest" | "conflicts";
export type Order = "start" | "finish" | "input";
export type Mode = "schedule" | "partition";

export const RULES: { id: Rule; name: string }[] = [
  { id: "finish", name: "Earliest finish" },
  { id: "start", name: "Earliest start" },
  { id: "shortest", name: "Shortest first" },
  { id: "conflicts", name: "Fewest conflicts" },
];

export const ORDERS: { id: Order; name: string }[] = [
  { id: "start", name: "Start time" },
  { id: "finish", name: "Finish time" },
  { id: "input", name: "Arrival (A, B, C, …)" },
];

export const label = (i: number): string => String.fromCharCode(65 + i);

export const overlaps = (a: Interval, b: Interval): boolean => a.s < b.f && b.s < a.f;

/** How many other intervals each one overlaps. The fewest-conflicts rule counts once, up front. */
export function conflictCounts(iv: Interval[]): number[] {
  return iv.map((a, i) => iv.reduce((n, b, j) => n + (i !== j && overlaps(a, b) ? 1 : 0), 0));
}

/** The order a rule scans the intervals in. */
export function processingOrder(iv: Interval[], rule: Rule | Order): number[] {
  const idx = iv.map((_, i) => i);
  if (rule === "input") return idx;
  const counts = rule === "conflicts" ? conflictCounts(iv) : [];
  const key = (i: number): number[] => {
    const tie = [iv[i].f, iv[i].s, i];
    if (rule === "start") return [iv[i].s, ...tie];
    if (rule === "shortest") return [iv[i].f - iv[i].s, ...tie];
    if (rule === "conflicts") return [counts[i], ...tie];
    return tie;
  };
  return idx.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let k = 0; k < ka.length; k++) if (ka[k] !== kb[k]) return ka[k] - kb[k];
    return 0;
  });
}

export interface ScheduleStep {
  index: number;
  kept: boolean;
  /** A kept interval this one overlaps, when it was skipped. */
  blocker: number | null;
}

export interface ScheduleRun {
  order: number[];
  steps: ScheduleStep[];
  kept: number[];
}

/** The greedy template: scan in order, keep each interval compatible with everything kept so far. */
export function runSchedule(iv: Interval[], rule: Rule): ScheduleRun {
  const order = processingOrder(iv, rule);
  const kept: number[] = [];
  const steps = order.map((index) => {
    const blocker = kept.find((k) => overlaps(iv[k], iv[index])) ?? null;
    if (blocker === null) kept.push(index);
    return { index, kept: blocker === null, blocker };
  });
  return { order, steps, kept };
}

export interface Optima {
  size: number;
  /** Every maximum compatible subset, each sorted by finish time, up to `limit`. */
  sets: number[][];
  total: number;
}

/** Brute force over all 2^n subsets. Independent of every greedy rule. */
export function optima(iv: Interval[], limit = 500): Optima {
  const n = iv.length;
  const clash = iv.map((a, i) => iv.reduce((m, b, j) => (i !== j && overlaps(a, b) ? m | (1 << j) : m), 0));
  let size = 0;
  let masks: number[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    let ok = true;
    let count = 0;
    for (let i = 0; i < n && ok; i++) {
      if (mask & (1 << i)) {
        count++;
        if (clash[i] & mask) ok = false;
      }
    }
    if (!ok) continue;
    if (count > size) {
      size = count;
      masks = [mask];
    } else if (count === size) masks.push(mask);
  }
  const sets = masks.slice(0, limit).map((mask) => byFinish(iv, iv.map((_, i) => i).filter((i) => mask & (1 << i))));
  return { size, sets, total: masks.length };
}

export const byFinish = (iv: Interval[], ids: number[]): number[] =>
  [...ids].sort((a, b) => iv[a].f - iv[b].f || iv[a].s - iv[b].s || a - b);

export interface AheadRow {
  r: number;
  greedy: number | null;
  optimum: number | null;
  /** f(i_r) <= f(j_r); null when one side has no r-th interval. */
  holds: boolean | null;
}

/**
 * The stays-ahead lemma, row by row: the r-th kept interval, by finish time,
 * against the r-th interval of an optimal solution.
 */
export function staysAhead(iv: Interval[], kept: number[], optimum: number[]): { rows: AheadRow[]; firstFailure: number | null } {
  const g = byFinish(iv, kept);
  const o = byFinish(iv, optimum);
  const rows: AheadRow[] = [];
  for (let r = 0; r < Math.max(g.length, o.length); r++) {
    const greedy = r < g.length ? g[r] : null;
    const opt = r < o.length ? o[r] : null;
    const holds = greedy !== null && opt !== null ? iv[greedy].f <= iv[opt].f : null;
    rows.push({ r: r + 1, greedy, optimum: opt, holds });
  }
  const fail = rows.find((row) => row.holds === false);
  return { rows, firstFailure: fail ? fail.r : null };
}

/**
 * The certificate that earliest finish is optimal. Every interval contains the
 * last instant before some kept interval's finish, so these k times stab every
 * interval, and k disjoint intervals need k different stabbing times.
 */
export function stabTimes(iv: Interval[], kept: number[]): number[] {
  return byFinish(iv, kept).map((i) => iv[i].f);
}

export const stabbedBy = (a: Interval, t: number): boolean => a.s < t && t <= a.f;

export interface PartitionStep {
  index: number;
  room: number;
  opened: boolean;
  /** When a room was opened: for each existing room, an interval in it that overlaps this one. */
  blockers: number[];
}

export interface PartitionRun {
  order: number[];
  steps: PartitionStep[];
  rooms: number[][];
}

/** First fit: the lowest-numbered room with nothing overlapping, or a new room. */
export function runPartition(iv: Interval[], order: Order): PartitionRun {
  const ord = processingOrder(iv, order);
  const rooms: number[][] = [];
  const steps = ord.map((index) => {
    const a = iv[index];
    const room = rooms.findIndex((r) => r.every((k) => !overlaps(iv[k], a)));
    if (room >= 0) {
      rooms[room].push(index);
      return { index, room, opened: false, blockers: [] };
    }
    // The overlapping interval that starts last; under start order it is the room's last interval.
    const blockers = rooms.map((r) =>
      r.filter((k) => overlaps(iv[k], a)).reduce((best, k) => (iv[k].s > iv[best].s ? k : best)),
    );
    rooms.push([index]);
    return { index, room: rooms.length - 1, opened: true, blockers };
  });
  return { order: ord, steps, rooms };
}

export interface DepthProfile {
  /** depth[t] = intervals containing [t, t + 1). */
  depth: number[];
  max: number;
  at: number;
}

export function depthProfile(iv: Interval[]): DepthProfile {
  const depth = Array.from({ length: HORIZON }, (_, t) => iv.filter((a) => a.s <= t && t < a.f).length);
  const max = Math.max(0, ...depth);
  return { depth, max, at: depth.indexOf(max) };
}

/** The latest start among the intervals if they all share a moment, else null. */
export function commonTime(iv: Interval[], ids: number[]): number | null {
  if (ids.length === 0) return null;
  const s = Math.max(...ids.map((i) => iv[i].s));
  const f = Math.min(...ids.map((i) => iv[i].f));
  return s < f ? s : null;
}

/** Seeded generator (mulberry32), so a search is repeatable from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInstance(rand: () => number, n: number, maxLen = 6): Interval[] {
  return Array.from({ length: n }, () => {
    const s = Math.floor(rand() * (HORIZON - 1));
    return { s, f: Math.min(HORIZON, s + 1 + Math.floor(rand() * maxLen)) };
  });
}

/** Sort by start, then finish, so labels A, B, C read left to right. */
export const tidy = (iv: Interval[]): Interval[] => [...iv].sort((a, b) => a.s - b.s || a.f - b.f);

/**
 * Does this rule lose on this input? Partitioning is measured against the
 * depth. Scheduling is measured against earliest finish, which the tests check
 * equals brute force, because brute force is too slow inside a search loop;
 * earliest finish itself is checked against brute force.
 */
export function fails(iv: Interval[], mode: Mode, rule: Rule | Order): boolean {
  if (mode === "partition") return runPartition(iv, rule as Order).rooms.length > depthProfile(iv).max;
  const best = rule === "finish" ? optima(iv, 1).size : runSchedule(iv, "finish").kept.length;
  return runSchedule(iv, rule as Rule).kept.length < best;
}

export interface Search {
  found: Interval[] | null;
  tried: number;
}

/**
 * Random inputs until the rule loses, then remove intervals one at a time
 * while it still loses. Arrival order is shuffled with the input, so its
 * labels are kept in the order that fails.
 */
export function searchCounterexample(mode: Mode, rule: Rule | Order, seed: number, tries = 20000): Search {
  const rand = rng(seed);
  for (let t = 1; t <= tries; t++) {
    let iv = randomInstance(rand, 4 + Math.floor(rand() * 7));
    if (!fails(iv, mode, rule)) continue;
    let shrunk = true;
    while (shrunk) {
      shrunk = false;
      for (let i = 0; i < iv.length; i++) {
        const smaller = iv.filter((_, j) => j !== i);
        if (fails(smaller, mode, rule)) {
          iv = smaller;
          shrunk = true;
          break;
        }
      }
    }
    if (rule !== "input") {
      const sorted = tidy(iv);
      if (fails(sorted, mode, rule)) iv = sorted;
    }
    return { found: iv, tried: t };
  }
  return { found: null, tried: tries };
}

const iv = (pairs: [number, number][]): Interval[] => pairs.map(([s, f]) => ({ s, f }));

export interface Preset {
  id: string;
  name: string;
  intervals: Interval[];
  mode: Mode;
  rule: Rule | Order;
}

// The counterexamples come from greedy_intervals.py: exhaustive search for
// the smallest failing inputs, and a random search with shrinking for fewest
// conflicts, whose failures are too large to enumerate.
export const PRESETS: Preset[] = [
  {
    id: "mixed",
    name: "Eight intervals, four rules",
    intervals: iv([[0, 6], [4, 5], [4, 10], [5, 7], [8, 14], [9, 12], [11, 13], [12, 15]]),
    mode: "schedule",
    rule: "finish",
  },
  { id: "start", name: "Earliest start loses (3 intervals)", intervals: iv([[0, 3], [1, 2], [2, 3]]), mode: "schedule", rule: "start" },
  { id: "shortest", name: "Shortest first loses (3 intervals)", intervals: iv([[0, 3], [2, 4], [3, 5]]), mode: "schedule", rule: "shortest" },
  {
    id: "conflicts",
    name: "Fewest conflicts loses (8 intervals)",
    intervals: iv([[0, 1], [0, 2], [0, 2], [1, 4], [3, 5], [4, 7], [5, 8], [7, 8]]),
    mode: "schedule",
    rule: "conflicts",
  },
  {
    id: "rooms",
    name: "Finish order wastes a room (4 intervals)",
    intervals: iv([[0, 1], [0, 2], [1, 4], [2, 3]]),
    mode: "partition",
    rule: "finish",
  },
];
