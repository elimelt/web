// The stream-sampling figure's model: three samplers of K records run over
// the same recorded substream of pageview records, and each one's estimate
// of the views in a chosen subset of the records. The figure's tests check
// every function here against an independent Python implementation
// (content/algorithms/probabilistic/sampling-experiments/figure_ref.py).

import { mulberry32 } from "../../shared/random";

export const KS = [10, 20, 50, 100, 200, 500, 1000];
export const TRIALS = 100;
export const METHODS = ["uniform", "priority", "ppswor"] as const;
export type Method = (typeof METHODS)[number];

export interface Data {
  /** Project of each record, as an index into names. */
  p: Uint16Array;
  /** Hour of each record, 0 to 23 (UTC). */
  h: Uint8Array;
  /** Views of each record: the page's views in that project and hour. */
  w: Uint16Array;
  names: string[];
  n: number;
  total: number;
}

/** records.bin.gz, inflated: per record a little-endian u16 project index, u8 hour and u16 views. */
export function decode(bytes: Uint8Array, names: string[]): Data {
  const n = Math.floor(bytes.length / 5);
  const p = new Uint16Array(n);
  const h = new Uint8Array(n);
  const w = new Uint16Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const o = 5 * i;
    p[i] = bytes[o] | (bytes[o + 1] << 8);
    h[i] = bytes[o + 2];
    w[i] = bytes[o + 3] | (bytes[o + 4] << 8);
    total += w[i];
  }
  return { p, h, w, names, n, total };
}

export interface Subset {
  id: string;
  label: string;
}

/** The subsets the figure offers: all records, projects, an hour, and records by weight. */
export const SUBSETS: Subset[] = [
  { id: "all", label: "All records" },
  { id: "p:en.m", label: "English Wikipedia, mobile" },
  { id: "p:en", label: "English Wikipedia, desktop" },
  { id: "p:ja", label: "Japanese Wikipedia, desktop" },
  { id: "p:de", label: "German Wikipedia, desktop" },
  { id: "p:tr.m", label: "Turkish Wikipedia, mobile" },
  { id: "h:12", label: "The hour ending 12:00 UTC" },
  { id: "w:1", label: "Records with 1 view" },
  { id: "w:100", label: "Records with 100 views or more" },
];

/** 1 for each record in the subset, 0 otherwise. */
export function subsetMask(d: Data, id: string): Uint8Array {
  const m = new Uint8Array(d.n);
  const [kind, arg] = id.includes(":") ? id.split(":") : [id, ""];
  const proj = kind === "p" ? d.names.indexOf(arg) : -1;
  if (kind === "p" && proj < 0) throw new Error(`no project ${arg}`);
  for (let i = 0; i < d.n; i++) {
    if (kind === "all") m[i] = 1;
    else if (kind === "p") m[i] = d.p[i] === proj ? 1 : 0;
    else if (kind === "h") m[i] = d.h[i] === Number(arg) ? 1 : 0;
    else if (kind === "w") m[i] = (arg === "1" ? d.w[i] === 1 : d.w[i] >= Number(arg)) ? 1 : 0;
    else throw new Error(`unknown subset ${id}`);
  }
  return m;
}

/** The seed of one method's generator in one trial. */
export function trialSeed(base: number, trial: number, method: number): number {
  return (Math.imul(base, 0x9e3779b1) + 3 * trial + method) >>> 0;
}

/**
 * Algorithm L (Li 1994): the positions of a uniform sample of K of the n
 * records, drawn in one pass. Draws come from rnd in [0, 1); u = 1 - rnd() is
 * uniform on (0, 1].
 */
export function algorithmL(n: number, K: number, rnd: () => number): Int32Array {
  const res = new Int32Array(K);
  for (let i = 0; i < K; i++) res[i] = i;
  let W = Math.exp(Math.log(1 - rnd()) / K);
  let t = K - 1;
  for (;;) {
    t += Math.floor(Math.log(1 - rnd()) / Math.log1p(-W)) + 1;
    if (t >= n) break;
    res[Math.floor(rnd() * K)] = t;
    W *= Math.exp(Math.log(1 - rnd()) / K);
  }
  return res;
}

/** The k-th smallest value of a (0-based), by quickselect on a copy. */
export function kthSmallest(a: Float64Array, k: number): number {
  const x = Float64Array.from(a);
  let lo = 0;
  let hi = x.length - 1;
  while (lo < hi) {
    const pivot = x[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (x[i] < pivot) i++;
      while (x[j] > pivot) j--;
      if (i <= j) {
        const s = x[i];
        x[i] = x[j];
        x[j] = s;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return x[k];
  }
  return x[k];
}

export interface Sample {
  /** Positions of the sampled records, in record order. */
  idx: number[];
  /** Each sampled record's weight in a subset-sum estimate. */
  adj: number[];
  /** The threshold: the (K+1)-th largest priority, or the (K+1)-th smallest rank. */
  tau: number;
}

/** Uniform sample by Algorithm L; each record counts n / K times its views. */
export function uniformSample(d: Data, K: number, rnd: () => number): Sample {
  const idx = Array.from(algorithmL(d.n, K, rnd).sort());
  return { idx, adj: idx.map((i) => (d.n / K) * d.w[i]), tau: NaN };
}

/** A max-heap of the K + 1 smallest keys seen, with the record of each. */
class SmallestKeys {
  keys: Float64Array;
  pos: Int32Array;
  len = 0;
  constructor(size: number) {
    this.keys = new Float64Array(size);
    this.pos = new Int32Array(size);
  }
  /** The largest key held, or Infinity while the heap is not full. */
  bound(): number {
    return this.len < this.keys.length ? Infinity : this.keys[0];
  }
  offer(k: number, i: number): void {
    const keys = this.keys;
    const pos = this.pos;
    if (this.len < keys.length) {
      let c = this.len++;
      while (c > 0 && keys[(c - 1) >> 1] < k) {
        keys[c] = keys[(c - 1) >> 1];
        pos[c] = pos[(c - 1) >> 1];
        c = (c - 1) >> 1;
      }
      keys[c] = k;
      pos[c] = i;
      return;
    }
    if (!(k < keys[0])) return;
    let c = 0;
    for (;;) {
      const l = 2 * c + 1;
      if (l >= this.len) break;
      const r = l + 1;
      const m = r < this.len && keys[r] > keys[l] ? r : l;
      if (keys[m] <= k) break;
      keys[c] = keys[m];
      pos[c] = pos[m];
      c = m;
    }
    keys[c] = k;
    pos[c] = i;
  }
  /** Every record but the root, in record order, and the root's key. */
  sample(): { idx: number[]; tau: number } {
    const tau = this.keys[0];
    const kept: number[] = [];
    for (let j = 0; j < this.len; j++) if (this.keys[j] < tau) kept.push(this.pos[j]);
    return { idx: Array.from(Int32Array.from(kept).sort()), tau };
  }
}

/**
 * Priority sampling (Duffield, Lund and Thorup): priority w / u, keep the K
 * largest; with tau the (K+1)-th largest priority, a kept record counts
 * max(w, tau). The heap holds the negated priorities.
 */
export function prioritySample(d: Data, K: number, rnd: () => number): Sample {
  const heap = new SmallestKeys(K + 1);
  const w = d.w;
  for (let i = 0; i < d.n; i++) {
    const k = -w[i] / (1 - rnd());
    if (k < heap.bound()) heap.offer(k, i);
  }
  const { idx, tau: negTau } = heap.sample();
  const tau = -negTau;
  return { idx, adj: idx.map((i) => Math.max(w[i], tau)), tau };
}

/**
 * Weighted sampling without replacement (Efraimidis and Spirakis): rank
 * -ln(u) / w, which is exponential with rate w, keep the K smallest; with tau
 * the (K+1)-th smallest rank, a kept record counts w / (1 - exp(-w tau))
 * (Cohen and Kaplan's rank-conditioning estimator). Since -ln(u) >= 1 - u,
 * a record whose (1 - u) / w already reaches the heap's bound is skipped
 * without a logarithm.
 */
export function ppsworSample(d: Data, K: number, rnd: () => number): Sample {
  const heap = new SmallestKeys(K + 1);
  const w = d.w;
  for (let i = 0; i < d.n; i++) {
    const r = rnd();
    const bound = heap.bound();
    if (r / w[i] >= bound) continue;
    const k = -Math.log(1 - r) / w[i];
    if (k < bound) heap.offer(k, i);
  }
  const { idx, tau } = heap.sample();
  return { idx, adj: idx.map((i) => w[i] / -Math.expm1(-w[i] * tau)), tau };
}

export const SAMPLERS: Record<Method, (d: Data, K: number, rnd: () => number) => Sample> = {
  uniform: uniformSample,
  priority: prioritySample,
  ppswor: ppsworSample,
};

/** The sample's estimate of the subset's views. */
export function estimate(s: Sample, mask: Uint8Array): number {
  let e = 0;
  s.idx.forEach((i, j) => {
    if (mask[i]) e += s.adj[j];
  });
  return e;
}

/** Priority sampling's unbiased variance estimate: tau (tau - w) per kept record with w < tau. */
export function priorityVariance(d: Data, s: Sample, mask: Uint8Array): number {
  let v = 0;
  for (const i of s.idx) if (mask[i] && d.w[i] < s.tau) v += s.tau * (s.tau - d.w[i]);
  return v;
}

export interface Run {
  truth: number;
  records: number;
  est: Record<Method, number[]>;
  /** Priority sampling's variance estimate in each trial. */
  pvar: number[];
  /** The first trial's priority sample. */
  first: Sample;
}

export function run(d: Data, K: number, mask: Uint8Array, base: number, trials = TRIALS): Run {
  let truth = 0;
  let records = 0;
  for (let i = 0; i < d.n; i++) {
    if (mask[i]) {
      truth += d.w[i];
      records++;
    }
  }
  const est = { uniform: [] as number[], priority: [] as number[], ppswor: [] as number[] };
  const pvar: number[] = [];
  let first: Sample | null = null;
  for (let t = 0; t < trials; t++) {
    METHODS.forEach((m, mi) => {
      const s = SAMPLERS[m](d, K, mulberry32(trialSeed(base, t, mi)));
      est[m].push(estimate(s, mask));
      if (m === "priority") {
        pvar.push(priorityVariance(d, s, mask));
        if (t === 0) first = s;
      }
    });
  }
  return { truth, records, est, pvar, first: first! };
}

export interface Summary {
  /** Root mean squared error relative to the truth. */
  rrmse: number;
  /** Mean estimate relative to the truth, minus 1. */
  bias: number;
  /** Share of trials whose estimate is 0. */
  zero: number;
}

export function summarize(est: number[], truth: number): Summary {
  let se = 0;
  let sum = 0;
  let zero = 0;
  for (const e of est) {
    se += (e - truth) ** 2;
    sum += e;
    if (e === 0) zero++;
  }
  return { rrmse: Math.sqrt(se / est.length) / truth, bias: sum / est.length / truth - 1, zero: zero / est.length };
}

/** Share of trials in which truth lies within estimate ± 2 sqrt(variance estimate). */
export function coverage(est: number[], pvar: number[], truth: number): number {
  let c = 0;
  est.forEach((e, i) => {
    if (Math.abs(e - truth) <= 2 * Math.sqrt(pvar[i])) c++;
  });
  return c / est.length;
}
