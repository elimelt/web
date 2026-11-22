// The quantile-sketch figure's model: a KLL sketch and a DDSketch fed the
// same recorded latency sample, and the exact quantiles of the prefix they
// have seen. The figure's tests check every function here against an
// independent Python implementation
// (content/algorithms/probabilistic/quantile-experiments/figure_ref.py).

import { mulberry32 } from "../../shared/random";

export const KS = [8, 16, 32, 64, 128, 256];
export const ALPHAS = [0.05, 0.02, 0.01, 0.005, 0.002];
/** KLL's capacity ratio between adjacent levels and its smallest capacity. */
export const C = 2 / 3;
export const MIN_CAP = 2;

export interface Sample {
  values: Uint16Array;
  max: number;
}

/** stream.u16.gz, inflated: the sample in recorded order as little-endian uint16. */
export function decode(bytes: Uint8Array): Sample {
  const n = bytes.length >> 1;
  const values = new Uint16Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    values[i] = v;
    if (v > max) max = v;
  }
  return { values, max };
}

/** Capacity of level h when the sketch has H levels (0 is the lowest). */
export function capacity(k: number, h: number, H: number): number {
  return Math.max(MIN_CAP, Math.ceil(k * C ** (H - 1 - h)));
}

export interface Compaction {
  /** Number of values seen when the compaction ran. */
  at: number;
  level: number;
  /** Items the level held before it was halved. */
  size: number;
  /** 0 if the items at even positions were kept, 1 for odd. */
  offset: number;
}

export interface Kll {
  k: number;
  n: number;
  levels: number[][];
  compactions: number;
  last: Compaction | null;
}

/**
 * Feeds values[0..upto) to a KLL sketch with parameter k. A full sketch (more
 * items than the sum of its capacities) compacts its lowest level that is at
 * or over capacity: the level is sorted, a fair coin picks the even or the odd
 * positions, those items move up a level with twice the weight, and the rest
 * are dropped. An odd item out stays behind.
 */
export function kll(values: Uint16Array, upto: number, k: number, seed: number): Kll {
  const rnd = mulberry32(seed);
  const levels: number[][] = [[]];
  let compactions = 0;
  let last: Compaction | null = null;
  const total = () => {
    let s = 0;
    for (let h = 0; h < levels.length; h++) s += capacity(k, h, levels.length);
    return s;
  };
  let size = 0;
  let cap = total();
  for (let t = 0; t < upto; t++) {
    levels[0].push(values[t]);
    size++;
    while (size > cap) {
      const H = levels.length;
      let h = 0;
      while (h < H && levels[h].length < capacity(k, h, H)) h++;
      if (h === H) break;
      if (h === H - 1) {
        levels.push([]);
        cap = total();
      }
      const lv = levels[h].sort((a, b) => a - b);
      // An odd item out (the largest) stays at this level.
      const keep = lv.length % 2 === 1 ? [lv.pop()!] : [];
      const offset = rnd() < 0.5 ? 0 : 1;
      const before = lv.length + keep.length;
      for (let i = offset; i < lv.length; i += 2) levels[h + 1].push(lv[i]);
      size -= lv.length / 2;
      levels[h] = keep;
      compactions++;
      last = { at: t + 1, level: h, size: before, offset };
    }
  }
  return { k, n: upto, levels, compactions, last };
}

export function kllRetained(s: Kll): number {
  let r = 0;
  for (const lv of s.levels) r += lv.length;
  return r;
}

/** The weighted items of a KLL sketch, sorted by value. */
export function kllItems(s: Kll): { v: Float64Array; w: Float64Array } {
  const items: [number, number][] = [];
  s.levels.forEach((lv, h) => lv.forEach((v) => items.push([v, 2 ** h])));
  items.sort((a, b) => a[0] - b[0]);
  return { v: Float64Array.from(items, (x) => x[0]), w: Float64Array.from(items, (x) => x[1]) };
}

/** KLL's estimate of the q-quantile: the smallest item whose cumulative weight reaches ceil(q n). */
export function kllQuantile(items: { v: Float64Array; w: Float64Array }, n: number, q: number): number {
  const r = Math.max(1, Math.ceil(q * n));
  let c = 0;
  for (let i = 0; i < items.v.length; i++) {
    c += items.w[i];
    if (c >= r) return items.v[i];
  }
  return items.v[items.v.length - 1];
}

export interface Dd {
  alpha: number;
  gamma: number;
  n: number;
  /** Count per key, keys from minKey. */
  counts: Map<number, number>;
  minKey: number;
  maxKey: number;
}

/** DDSketch's bucket key for a positive value: ceil(log_gamma(x)). */
export function ddKey(x: number, gamma: number): number {
  return Math.ceil(Math.log(x) / Math.log(gamma));
}

export function dd(values: Uint16Array, upto: number, alpha: number): Dd {
  const gamma = (1 + alpha) / (1 - alpha);
  const counts = new Map<number, number>();
  let minKey = Infinity;
  let maxKey = -Infinity;
  for (let t = 0; t < upto; t++) {
    const key = ddKey(values[t], gamma);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (key < minKey) minKey = key;
    if (key > maxKey) maxKey = key;
  }
  return { alpha, gamma, n: upto, counts, minKey, maxKey };
}

/** Keys from the lowest to the highest occupied one, as a dense store holds them. */
export function ddBins(s: Dd): number {
  return s.n ? s.maxKey - s.minKey + 1 : 0;
}

/** DDSketch's estimate: the bucket holding rank ceil(q n), reported as 2 gamma^key / (gamma + 1). */
export function ddQuantile(s: Dd, q: number): number {
  const r = Math.max(1, Math.ceil(q * s.n));
  let c = 0;
  for (let key = s.minKey; key <= s.maxKey; key++) {
    c += s.counts.get(key) ?? 0;
    if (c >= r) return (2 * s.gamma ** key) / (s.gamma + 1);
  }
  return (2 * s.gamma ** s.maxKey) / (s.gamma + 1);
}

/** Counts of each value among values[0..upto), and their running sums. */
export interface Exact {
  n: number;
  /** below[v] = number of values < v, for v = 0..max+1. */
  below: Float64Array;
}

export function exact(values: Uint16Array, upto: number, max: number): Exact {
  const cnt = new Float64Array(max + 2);
  for (let t = 0; t < upto; t++) cnt[values[t]]++;
  const below = new Float64Array(max + 2);
  for (let v = 1; v <= max + 1; v++) below[v] = below[v - 1] + cnt[v - 1];
  return { n: upto, below };
}

/** The exact q-quantile, the value at sorted position ceil(q n). */
export function exactQuantile(e: Exact, q: number): number {
  const r = Math.max(1, Math.ceil(q * e.n));
  let lo = 0;
  let hi = e.below.length - 1;
  // Smallest v with below[v + 1] >= r.
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (e.below[m + 1] >= r) hi = m;
    else lo = m + 1;
  }
  return lo;
}

/** Rank error of an estimate: distance from q to the range of normalized ranks the estimate occupies. */
export function rankError(e: Exact, q: number, est: number): number {
  const top = e.below.length - 1;
  const lo = (est <= 0 ? 0 : est > top ? e.n : e.below[Math.ceil(est)]) / e.n;
  const hi = (est < 0 ? 0 : est >= top ? e.n : e.below[Math.floor(est) + 1]) / e.n;
  return Math.max(0, lo - q, q - hi);
}

/** The grid of quantiles the figure plots: 1 - 10^-s for s from 0.3 to 3. */
export function grid(points: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const s = 0.3 + (2.7 * i) / (points - 1);
    out.push(Number((1 - 10 ** -s).toPrecision(12)));
  }
  return out;
}

export interface Row {
  q: number;
  truth: number;
  kll: number;
  dd: number;
  kllRank: number;
  ddRank: number;
  kllRel: number;
  ddRel: number;
}

export function compare(sample: Sample, upto: number, k: number, alpha: number, seed: number, qs: number[]) {
  const s = kll(sample.values, upto, k, seed);
  const d = dd(sample.values, upto, alpha);
  const e = exact(sample.values, upto, sample.max);
  const items = kllItems(s);
  const rows: Row[] = qs.map((q) => {
    const truth = exactQuantile(e, q);
    const a = kllQuantile(items, upto, q);
    const b = ddQuantile(d, q);
    return {
      q,
      truth,
      kll: a,
      dd: b,
      kllRank: rankError(e, q, a),
      ddRank: rankError(e, q, b),
      kllRel: Math.abs(a - truth) / truth,
      ddRel: Math.abs(b - truth) / truth,
    };
  });
  return { kll: s, dd: d, rows };
}
