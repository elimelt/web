// Count-Min sketch (Cormode and Muthukrishnan 2005) on one hour of real
// English Wikipedia page-view counts.
//
// Each page is identified by its rank i (0 = most viewed). Row j hashes a page
// to bucket fmix32(i * 0x9e3779b1 + s_j) >>> (32 - log2 w), where fmix32 is the
// MurmurHash3 finalizer and s_j is a per-row seed; the error depends only on
// the counts and on the hashing, not on page titles. The sketch adds each
// page's hourly count to one counter per row and estimates a page's count as
// the minimum of its d counters.

import { mulberry32 } from "../../shared/random";
import { COUNT_PAIRS, PAGES, VIEWS } from "./data";

export { PAGES, VIEWS };

export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Page counts in descending order (index 0 is the most viewed page). */
export function expandCounts(pairs: readonly number[] = COUNT_PAIRS): Uint32Array {
  let n = 0;
  for (let k = 1; k < pairs.length; k += 2) n += pairs[k];
  const out = new Uint32Array(n);
  let i = n;
  for (let k = 0; k < pairs.length; k += 2) for (let r = 0; r < pairs[k + 1]; r++) out[--i] = pairs[k];
  return out;
}

export function rowSeeds(seed: number, d: number): number[] {
  const rnd = mulberry32(seed >>> 0);
  return Array.from({ length: d }, () => (rnd() * 4294967296) >>> 0);
}

export const bucket = (i: number, s: number, logW: number): number =>
  fmix32((Math.imul(i, 0x9e3779b1) + s) >>> 0) >>> (32 - logW);

/** Estimates for every page from a depth-d, width-2^logW sketch. */
export function sketch(counts: Uint32Array, logW: number, d: number, seed: number): Float64Array {
  const w = 2 ** logW;
  const seeds = rowSeeds(seed, d);
  const rows = seeds.map(() => new Float64Array(w));
  const n = counts.length;
  for (let j = 0; j < d; j++) {
    const row = rows[j];
    const s = seeds[j];
    for (let i = 0; i < n; i++) row[bucket(i, s, logW)] += counts[i];
  }
  const est = new Float64Array(n).fill(Infinity);
  for (let j = 0; j < d; j++) {
    const row = rows[j];
    const s = seeds[j];
    for (let i = 0; i < n; i++) {
      const v = row[bucket(i, s, logW)];
      if (v < est[i]) est[i] = v;
    }
  }
  return est;
}

export interface Stats {
  w: number;
  d: number;
  epsN: number;
  delta: number;
  exceed: number;
  exact: number;
  meanErr: number;
  medianSingle: number;
  top100Rel: number;
  sample: { a: number; est: number }[];
}

/** Indices plotted: the 1,500 most viewed pages and 2,500 others drawn without replacement. */
export function sampleIndices(n: number, seed = 20260304): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.min(1500, n); i++) out.push(i);
  const rnd = mulberry32(seed);
  const seen = new Set<number>();
  while (seen.size < Math.min(2500, n - 1500)) seen.add(1500 + Math.floor(rnd() * (n - 1500)));
  return out.concat([...seen].sort((a, b) => a - b));
}

export function analyze(counts: Uint32Array, logW: number, d: number, seed: number, idx: number[]): Stats {
  const est = sketch(counts, logW, d, seed);
  const w = 2 ** logW;
  let N = 0;
  for (const c of counts) N += c;
  const epsN = (Math.E / w) * N;
  let exceed = 0;
  let exact = 0;
  let sum = 0;
  const singles: number[] = [];
  for (let i = 0; i < counts.length; i++) {
    const e = est[i] - counts[i];
    sum += e;
    if (e > epsN) exceed++;
    if (e === 0) exact++;
    if (counts[i] === 1) singles.push(est[i]);
  }
  singles.sort((a, b) => a - b);
  let top = 0;
  for (let i = 0; i < 100; i++) top += (est[i] - counts[i]) / counts[i];
  return {
    w,
    d,
    epsN,
    delta: Math.exp(-d),
    exceed: exceed / counts.length,
    exact: exact / counts.length,
    meanErr: sum / counts.length,
    medianSingle: singles[Math.floor((singles.length - 1) / 2)],
    top100Rel: top / 100,
    sample: idx.map((i) => ({ a: counts[i], est: est[i] })),
  };
}

export const DEFAULT_LOGW = 10;
export const DEFAULT_D = 4;
