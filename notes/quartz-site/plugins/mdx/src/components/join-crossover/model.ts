// Recorded results of the join experiments (see the note's "How this was
// measured"), reduced by join-experiments/summarize.py. Nothing here is
// simulated: every time is the median of real EXPLAIN ANALYZE runs on
// PostgreSQL 16, and every cost is the planner's own estimate for that query.

import summaryJson from "../../../../../../content/systems/databases/join-experiments/join-summary.json";

export type Method = "nestloop" | "hash" | "merge";
export const METHODS: Method[] = ["nestloop", "hash", "merge"];
export type Layout = "rand" | "clu";
export const LAYOUTS: Layout[] = ["rand", "clu"];
export type Rpc = "4" | "1.1";
export const RPCS: Rpc[] = ["4", "1.1"];

export interface Timed {
  k: number;
  median: number;
  min: number;
  max: number;
  runs: number;
  join?: string;
}

export interface Estimate {
  k: number;
  nestloop: number;
  hash: number;
  merge: number;
  choice: string;
  choice_ms?: number;
}

export interface RelStats {
  orders_pages: number;
  orders_rows: number;
  customers_pages: number;
  index_levels: number;
}

interface Summary {
  relstats: Record<string, RelStats>;
  meta: { version: string; settings: Record<string, string>; relpages: Record<string, number> };
  measured: Record<string, Record<Layout, Record<Method | "planner", Timed[]>>>;
  estimated: Record<string, Record<string, Record<Layout, Estimate[]>>>;
}

export const DATA = summaryJson as unknown as Summary;
export const SCALES: string[] = Object.keys(DATA.measured).sort((a, b) => +a - +b);

export const LABELS: Record<Method, string> = {
  nestloop: "nested loop",
  hash: "hash join",
  merge: "merge join",
};

const JOIN_NAME: Record<string, Method> = {
  "Nested Loop": "nestloop",
  "Hash Join": "hash",
  "Merge Join": "merge",
};
export const methodOf = (join: string | undefined): Method | undefined => (join ? JOIN_NAME[join] : undefined);

export interface View {
  scale: string;
  layout: Layout;
  rpc: Rpc;
  /** "time" draws measured milliseconds, "cost" the planner's estimated cost. */
  y: "time" | "cost";
}

export interface Preset extends View {
  /** Which control groups the reader gets. */
  controls: ("scale" | "layout" | "rpc")[];
  caption: string;
}

export const PRESETS: Record<string, Preset> = {
  measured: {
    scale: "1000000",
    layout: "rand",
    rpc: "4",
    y: "time",
    controls: ["scale", "layout"],
    caption:
      "Measured: execution time of one join, customers ⋈ orders on cust_id, against the number of customers the filter keeps (k). Each method was forced by turning the other two off; points are medians of 5 warm-cache runs (3 above 2 s), whiskers span the fastest and slowest run. The strips under the chart mark the fastest method at each k and the method PostgreSQL picks with default settings. Log-log.",
  },
  cost: {
    scale: "1000000",
    layout: "rand",
    rpc: "4",
    y: "cost",
    controls: ["scale", "layout", "rpc"],
    caption:
      "The planner's estimated total cost of the same three plans for the same queries (EXPLAIN without ANALYZE), in PostgreSQL's cost units. The planner picks the lowest line. Lowering random_page_cost from its default of 4 to 1.1 makes index probes cheaper in the model and moves the switch to hash join to larger k. The 'fastest' strip is measured, as in the chart above. Log-log.",
  },
};

export const DEFAULT_PRESET = "measured";
export const presetKey = (v: unknown): string => (typeof v === "string" && v in PRESETS ? v : DEFAULT_PRESET);

export const measured = (scale: string, layout: Layout) => DATA.measured[scale][layout];
export const estimated = (rpc: Rpc, scale: string, layout: Layout) => DATA.estimated[rpc][scale][layout];

/** Every k measured for this table, in increasing order. */
export const ks = (scale: string, layout: Layout): number[] =>
  measured(scale, layout)
    .planner.map((p) => p.k)
    .sort((a, b) => a - b);

export function timed(scale: string, layout: Layout, m: Method | "planner", k: number): Timed | undefined {
  return measured(scale, layout)[m].find((p) => p.k === k);
}

export function estimate(rpc: Rpc, scale: string, layout: Layout, k: number): Estimate {
  const e = estimated(rpc, scale, layout).find((p) => p.k === k);
  if (!e) throw new Error(`no estimate for ${rpc} ${scale} ${layout} ${k}`);
  return e;
}

/** The measured-fastest forced method at k, among those measured there. */
export function fastest(scale: string, layout: Layout, k: number): { method: Method; ms: number } {
  let best: { method: Method; ms: number } | undefined;
  for (const m of METHODS) {
    const p = timed(scale, layout, m, k);
    if (p && (!best || p.median < best.ms)) best = { method: m, ms: p.median };
  }
  if (!best) throw new Error(`nothing measured at ${scale} ${layout} ${k}`);
  return best;
}

/** The planner's pick at k and its measured time, under the given random_page_cost. */
export function pick(rpc: Rpc, scale: string, layout: Layout, k: number): { method: Method; ms: number } {
  if (rpc === "4") {
    const p = timed(scale, layout, "planner", k)!;
    return { method: methodOf(p.join)!, ms: p.median };
  }
  const e = estimate(rpc, scale, layout, k);
  return { method: methodOf(e.choice)!, ms: e.choice_ms! };
}

/**
 * The k at which method b first becomes cheaper than a, interpolated on log k
 * between the last k where a is cheaper and the first where b is. `value`
 * gives a method's time or cost at k, or undefined where it was not measured.
 * Returns undefined if b is never cheaper or is already cheaper at the first k.
 */
export function crossover(
  points: number[],
  value: (m: Method, k: number) => number | undefined,
  a: Method,
  b: Method,
): number | undefined {
  let prev: [number, number] | undefined;
  for (const k of points) {
    const va = value(a, k);
    const vb = value(b, k);
    if (va === undefined || vb === undefined) {
      prev = undefined;
      continue;
    }
    const d = Math.log(vb) - Math.log(va);
    if (d < 0) {
      if (!prev) return undefined;
      const [k0, d0] = prev;
      const t = d0 / (d0 - d);
      return Math.exp(Math.log(k0) + t * (Math.log(k) - Math.log(k0)));
    }
    prev = [k, d];
  }
  return undefined;
}

export const timeOf = (scale: string, layout: Layout) => (m: Method, k: number) => timed(scale, layout, m, k)?.median;
export const costOf = (rpc: Rpc, scale: string, layout: Layout) => (m: Method, k: number) => estimate(rpc, scale, layout, k)[m];

/** Measured and estimated k at which hash join overtakes nested loop. */
export function switchPoints(v: View): { measured?: number; planner?: number } {
  const pts = ks(v.scale, v.layout);
  return {
    measured: crossover(pts, timeOf(v.scale, v.layout), "nestloop", "hash"),
    planner: crossover(pts, costOf(v.rpc, v.scale, v.layout), "nestloop", "hash"),
  };
}

/** Orders per customer in every table. */
export const ORDERS_PER_CUSTOMER = 10;

/**
 * The textbook page-I/O model applied to these tables. An index nested loop
 * probe reads one page per B-tree level plus the heap pages holding the
 * customer's 10 orders: about 10 distinct pages when the orders are in
 * random physical order, about 1 when they are clustered by cust_id. A
 * one-pass hash join reads the orders table once. Both plans also read the
 * customers table once, so it cancels. The model's crossover is where
 * k probes cost as many page reads as one pass over orders.
 */
export function ioModel(scale: string, layout: Layout): { perProbe: number; ordersPages: number; crossover: number } {
  const s = DATA.relstats[`${scale}/${layout}`];
  const P = s.orders_pages;
  const perPage = s.orders_rows / P;
  const heap =
    layout === "rand"
      ? P * (1 - (1 - 1 / P) ** ORDERS_PER_CUSTOMER) // expected distinct pages of 10 random rows
      : 1 + (ORDERS_PER_CUSTOMER - 1) / perPage; // a run of 10 rows crosses a page boundary this often
  const perProbe = s.index_levels + heap;
  return { perProbe, ordersPages: P, crossover: P / perProbe };
}
