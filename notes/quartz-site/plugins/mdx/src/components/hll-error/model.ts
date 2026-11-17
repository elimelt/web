// HyperLogLog with three estimators, run on random 64-bit hash values.
//
// A HyperLogLog sketch sees only the hash values of the keys, so with a good
// hash any set of n distinct keys produces the same distribution of sketch
// states as n independent uniform 64-bit values. The figure therefore draws
// the hash values from a seeded generator and runs many independent trials.
//
// Estimators:
//   raw   E = alpha_m m^2 / sum_j 2^-M_j            (Flajolet et al. 2007, eq. 3)
//   orig  linear counting m ln(m/V) when E <= 5m/2 and V > 0, else E
//         (Flajolet et al. 2007, Fig. 3; no large-range correction with 64 bits)
//   ertl  the improved raw estimator of Ertl (2017), Algorithm 6, which uses
//         the register histogram C_0..C_{q+1} with q = 64 - p.

import { mulberry32 } from "../../shared/random";

export type EstimatorName = "raw" | "orig" | "ertl";
export const ESTIMATORS: EstimatorName[] = ["raw", "orig", "ertl"];

export function alphaM(m: number): number {
  if (m === 16) return 0.673;
  if (m === 32) return 0.697;
  if (m === 64) return 0.709;
  return 0.7213 / (1 + 1.079 / m);
}

/** Ertl (2017) eq. 33: sigma(x) = x + sum_{k>=1} x^(2^k) 2^(k-1). */
export function sigma(x: number): number {
  if (x === 1) return Infinity;
  let y = 1;
  let z = x;
  let prev: number;
  do {
    x *= x;
    prev = z;
    z += x * y;
    y += y;
  } while (prev !== z);
  return z;
}

/** Ertl (2017) eq. 37: tau(x) = (1 - x - sum_{k>=1} (1 - x^(2^-k))^2 2^-k) / 3. */
export function tau(x: number): number {
  if (x === 0 || x === 1) return 0;
  let y = 1;
  let z = 1 - x;
  let prev: number;
  do {
    x = Math.sqrt(x);
    prev = z;
    y *= 0.5;
    z -= (1 - x) * (1 - x) * y;
  } while (prev !== z);
  return z / 3;
}

/** Estimates from a register histogram C[0..q+1] of a sketch with m = 2^p registers. */
export function estimates(C: ArrayLike<number>, p: number): Record<EstimatorName, number> {
  const m = 2 ** p;
  const q = 64 - p;
  let s = 0;
  let w = 1;
  for (let k = 0; k <= q + 1; k++) {
    s += C[k] * w;
    w *= 0.5;
  }
  const raw = (alphaM(m) * m * m) / s;
  const V = C[0];
  const orig = raw <= 2.5 * m && V > 0 ? m * Math.log(m / V) : raw;
  let z = m * tau((m - C[q + 1]) / m);
  for (let k = q; k >= 1; k--) {
    z += C[k];
    z *= 0.5;
  }
  z += m * sigma(V / m);
  const ertl = ((0.5 / Math.LN2) * m * m) / z;
  return { raw, orig, ertl };
}

/** Register value rho for a 64-bit hash given as two 32-bit halves. */
export function update(reg: Uint8Array, C: Int32Array, p: number, hi: number, lo: number): void {
  const j = hi >>> (32 - p);
  const rest = (hi << p) >>> 0;
  let r: number;
  if (rest !== 0) r = Math.clz32(rest) + 1;
  else if (lo !== 0) r = 32 - p + Math.clz32(lo) + 1;
  else r = 64 - p + 1;
  if (r > reg[j]) {
    C[reg[j]]--;
    C[r]++;
    reg[j] = r;
  }
}

/** Checkpoints n, about 16 per decade, from 1 to maxRatio * m. */
export function checkpoints(m: number, maxRatio = 32): number[] {
  const out: number[] = [];
  const top = Math.log10(maxRatio * m);
  for (let x = 0; x <= top + 1e-9; x += 1 / 16) {
    const v = Math.round(10 ** x);
    if (v !== out[out.length - 1]) out.push(v);
  }
  return out;
}

export interface Curves {
  p: number;
  m: number;
  trials: number;
  n: number[];
  /** For each estimator, the 5th, 50th and 95th percentiles of the relative error at each n. */
  q: Record<EstimatorName, { lo: number[]; mid: number[]; hi: number[] }>;
  /** Relative standard error of the improved estimator at each n. */
  sd: number[];
}

const quantile = (sorted: Float64Array, f: number): number => {
  const pos = (sorted.length - 1) * f;
  const i = Math.floor(pos);
  const frac = pos - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - frac) + sorted[i + 1] * frac : sorted[i];
};

/** Runs `trials` independent sketches of precision p and summarizes the error curves. */
export function simulate(p: number, trials: number, seed: number, maxRatio = 32): Curves {
  const m = 2 ** p;
  const n = checkpoints(m, maxRatio);
  const errs: Record<EstimatorName, Float64Array[]> = { raw: [], orig: [], ertl: [] };
  for (const e of ESTIMATORS) for (let c = 0; c < n.length; c++) errs[e].push(new Float64Array(trials));
  const reg = new Uint8Array(m);
  const C = new Int32Array(66 - p + 1);
  for (let t = 0; t < trials; t++) {
    const rnd = mulberry32((seed * 7919 + t * 104729) >>> 0);
    reg.fill(0);
    C.fill(0);
    C[0] = m;
    let c = 0;
    for (let i = 1; c < n.length; i++) {
      update(reg, C, p, (rnd() * 4294967296) >>> 0, (rnd() * 4294967296) >>> 0);
      if (i === n[c]) {
        const est = estimates(C, p);
        for (const e of ESTIMATORS) errs[e][c][t] = est[e] / i - 1;
        c++;
      }
    }
  }
  const q = {} as Curves["q"];
  for (const e of ESTIMATORS) {
    const lo: number[] = [];
    const mid: number[] = [];
    const hi: number[] = [];
    for (let c = 0; c < n.length; c++) {
      const s = errs[e][c].slice().sort();
      lo.push(quantile(s, 0.05));
      mid.push(quantile(s, 0.5));
      hi.push(quantile(s, 0.95));
    }
    q[e] = { lo, mid, hi };
  }
  const sd = n.map((_, c) => {
    const x = errs.ertl[c];
    let mean = 0;
    for (const v of x) mean += v;
    mean /= x.length;
    let ss = 0;
    for (const v of x) ss += (v - mean) ** 2;
    return Math.sqrt(ss / (x.length - 1));
  });
  return { p, m, trials, n, q, sd };
}

export const DEFAULT_P = 6;
export const TRIALS = 300;
