// Measured time per element of an indexed gather, sum += mix(a[idx[i]], W),
// with __builtin_prefetch(&a[idx[i + D]]), on a 4 GiB array in a KVM guest on
// an Intel Xeon reporting family 6, model 207 (Emerald Rapids). Nothing here
// is simulated: every point is a median of 12 recorded runs, and the derived
// quantities are arithmetic on those medians.
//
//   lead time   D x t(D): how long before its load each prefetch is issued
//   in flight   L / t(D): Little's law, with one line per element and the
//               single-chain miss latency L from the MLP benchmark on the
//               same VM
//   Mowry D*    ceil(L / c): the distance at which the lead time first
//               covers L, with c the time per element when the data is in L1
//               (Mowry, Lam and Gupta 1992)

import { DATA, type Curve, type Row } from "./data";

export { DATA };
export type { Curve, Row };

/** Single-chain pointer-chase medians from mlp_bench-summary.json (same VM). */
export const LATENCY: Record<string, number> = { "2m": 151.6, "4k": 243.8 };
/** L1D fill buffers per core that Intel documents for Golden Cove. */
export const BUFFERS = 16;
export const WORKS = [0, 4, 16, 64] as const;
export const PAGES = ["2m", "4k"] as const;
export const HINT_NAME: Record<number, string> = { 3: "t0", 2: "t1", 1: "t2", 0: "nta" };
export const HINT_INSN: Record<number, string> = { 3: "prefetcht0", 2: "prefetcht1", 1: "prefetcht2", 0: "prefetchnta" };

export interface Preset {
  pages: string;
  work: number;
  hints: number[];
}

export function curve(p: Preset, hint: number): Curve {
  const c = DATA[p.pages][p.work].curves.find((x) => x.hint === hint);
  if (!c) throw new Error(`no data for hint ${hint} at W=${p.work}, ${p.pages}`);
  return c;
}

/** The distances on the slider: those measured with the primary (first) hint. */
export const distances = (p: Preset): number[] => curve(p, p.hints[0]).rows.map((r) => r[0]);

export const row = (p: Preset, hint: number, d: number): Row | undefined =>
  curve(p, hint).rows.find((r) => r[0] === d);

export interface Derived {
  d: number;
  t: number;
  lo: number;
  hi: number;
  /** t(0) / t(D). */
  speedup: number;
  /** D x t(D), ns. */
  lead: number;
  /** L / t(D). */
  inFlight: number;
}

export function derive(p: Preset, hint: number, d: number): Derived | undefined {
  const r = row(p, hint, d);
  if (!r) return undefined;
  const base = curve(p, hint).rows[0];
  const L = LATENCY[p.pages];
  return { d, t: r[1], lo: r[2], hi: r[3], speedup: base[1] / r[1], lead: d * r[1], inFlight: L / r[1] };
}

/** Time per element with the data in L1 (the "hot" run): the compute floor. */
export const hot = (p: Preset): number => DATA[p.pages][p.work].hot;

/** Mowry, Lam and Gupta's distance: iterations needed for the lead time to cover L. */
export const mowry = (p: Preset): number => Math.ceil(LATENCY[p.pages] / hot(p));

/** The floor L / C when every fill buffer holds a miss for the full latency. */
export const bufferFloor = (p: Preset): number => LATENCY[p.pages] / BUFFERS;

/** The distance with the lowest median for a hint, and its median. */
export function best(p: Preset, hint: number): Row {
  const rows = curve(p, hint).rows.filter((r) => r[0] > 0);
  return rows.reduce((a, b) => (b[1] < a[1] ? b : a));
}

export function preset(props: { pages?: unknown; work?: unknown; hints?: unknown }): Preset {
  const pages = PAGES.includes(String(props.pages) as never) ? String(props.pages) : "2m";
  const w = Number(props.work);
  const work = (WORKS as readonly number[]).includes(w) ? w : 16;
  const available = DATA[pages][work].curves.map((c) => c.hint);
  const asked = String(props.hints ?? "3")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((h, i, a) => available.includes(h) && a.indexOf(h) === i);
  return { pages, work, hints: asked.length ? asked : [3] };
}
