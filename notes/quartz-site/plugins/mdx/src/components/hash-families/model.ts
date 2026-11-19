// Seven 32-bit hash families feeding one HyperLogLog sketch (p = 10, the
// estimator of Ertl 2017), on three sets of integer keys.
//
// Families, each seeded from mulberry32:
//   ms     multiply-shift, a*x mod 2^32 with a odd; the sketch takes the top bits
//   mslo   the same product, with the register index taken from the low bits
//   mas    multiply-add-shift, the top 32 bits of (a*x + b) mod 2^64
//   cw     (a*x + b) mod p, p = 2^31 - 1 (2-independent), times 2
//   poly4  a degree-3 polynomial mod p (4-independent), times 2
//   tab    simple tabulation, 4 tables of 256 random 32-bit words
//   fmix   MurmurHash3's fmix32 applied to x XOR a random word
// Key sets: dense IDs 0..n-1, multiples of 1024, and a fixed bijective
// scrambling of 0..n-1 within 31 bits. hashing-experiments/figure_ref.py, next to the note,
// implements the same computation independently.

import { mulberry32 } from "../../shared/random";

export const P = 10;
export const M = 1 << P;
export const Q = 32 - P;
export const TRIALS = 32;
export const P31 = 2147483647;

export type Family = "ms" | "mslo" | "mas" | "cw" | "poly4" | "tab" | "fmix";
export const FAMILIES: { id: Family; label: string; short: string; long: string }[] = [
  { id: "ms", label: "multiply-shift", short: "mult-shift", long: "multiply-shift" },
  { id: "mslo", label: "multiply-shift, low bits", short: "mult-shift low", long: "multiply-shift with the index taken from the low bits" },
  { id: "mas", label: "multiply-add-shift", short: "mult-add-shift", long: "multiply-add-shift" },
  { id: "cw", label: "(ax + b) mod p", short: "(ax+b) mod p", long: "(ax + b) mod p" },
  { id: "poly4", label: "cubic polynomial mod p", short: "cubic mod p", long: "a degree-3 polynomial mod p" },
  { id: "tab", label: "simple tabulation", short: "tabulation", long: "simple tabulation" },
  { id: "fmix", label: "fmix32", short: "fmix32", long: "fmix32" },
];

export type KeySet = "dense" | "stride" | "scrambled";
export const KEYSETS: { id: KeySet; label: string }[] = [
  { id: "dense", label: "dense IDs 0, 1, …, n − 1" },
  { id: "stride", label: "multiples of 1024" },
  { id: "scrambled", label: "scrambled IDs" },
];

export interface Params {
  a: number;
  ah: number;
  al: number;
  bh: number;
  bl: number;
  c: number[];
  T: Uint32Array;
  s: number;
}

const u32 = (r: () => number) => Math.floor(r() * 4294967296) >>> 0;

/** Draws a family's parameters in the same order as the reference implementation. */
export function params(f: Family, seed: number): Params {
  const r = mulberry32(seed);
  const p: Params = { a: 0, ah: 0, al: 0, bh: 0, bl: 0, c: [], T: new Uint32Array(0), s: 0 };
  if (f === "ms" || f === "mslo") p.a = (u32(r) | 1) >>> 0;
  else if (f === "mas") {
    p.ah = u32(r);
    p.al = u32(r);
    p.bh = u32(r);
    p.bl = u32(r);
  } else if (f === "cw") p.c = [(u32(r) % (P31 - 1)) + 1, u32(r) % P31];
  else if (f === "poly4") p.c = [0, 1, 2, 3].map(() => u32(r) % P31);
  else if (f === "tab") {
    p.T = new Uint32Array(1024);
    for (let i = 0; i < 1024; i++) p.T[i] = u32(r);
  } else p.s = u32(r);
  return p;
}

/** The high and low 32 bits of the 64-bit product of two 32-bit integers. */
export function mul32(a: number, b: number): [number, number] {
  const al = a & 0xffff;
  const ah = a >>> 16;
  const bl = b & 0xffff;
  const bh = b >>> 16;
  const ll = al * bl;
  const lh = al * bh;
  const hl = ah * bl;
  const hh = ah * bh;
  const mid = (ll >>> 16) + (lh & 0xffff) + (hl & 0xffff);
  const lo = (mid & 0xffff) * 65536 + (ll & 0xffff);
  const hi = hh + (lh >>> 16) + (hl >>> 16) + Math.floor(mid / 65536);
  return [hi >>> 0, lo >>> 0];
}

/** a*b mod 2^31 - 1 for a, b < 2^31, with every intermediate below 2^53. */
export function mulmod(a: number, b: number): number {
  const bh = Math.floor(b / 65536);
  const bl = b & 0xffff;
  let r = (a * bh) % P31;
  r = (r * 65536) % P31;
  return (r + ((a * bl) % P31)) % P31;
}

export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hash(f: Family, p: Params, x: number): number {
  switch (f) {
    case "ms":
    case "mslo":
      return Math.imul(p.a, x) >>> 0;
    case "mas": {
      const [hi, lo] = mul32(p.al, x);
      const carry = lo + p.bl >= 4294967296 ? 1 : 0;
      return (hi + (Math.imul(p.ah, x) >>> 0) + p.bh + carry) >>> 0;
    }
    case "cw":
      return ((mulmod(p.c[0], x % P31) + p.c[1]) % P31) * 2;
    case "poly4": {
      const y = x % P31;
      let h = p.c[0];
      for (let k = 1; k < 4; k++) h = (mulmod(h, y) + p.c[k]) % P31;
      return h * 2;
    }
    case "tab":
      return (p.T[x & 255] ^ p.T[256 + ((x >>> 8) & 255)] ^ p.T[512 + ((x >>> 16) & 255)] ^ p.T[768 + (x >>> 24)]) >>> 0;
    default:
      return fmix32((x ^ p.s) >>> 0);
  }
}

/** A bijection of [0, 2^31): xorshifts and odd multiplications modulo 2^31. */
export function scramble31(i: number): number {
  let x = i;
  x ^= x >>> 16;
  x = Math.imul(x, 0x2c1b3c6d) & 0x7fffffff;
  x ^= x >>> 13;
  x = Math.imul(x, 0x297a2d39) & 0x7fffffff;
  x ^= x >>> 16;
  return x;
}

export function key(ks: KeySet, i: number): number {
  if (ks === "dense") return i;
  if (ks === "stride") return i * 1024;
  return scramble31(i);
}

/** Ertl (2017) eq. 33. */
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

/** Ertl (2017) eq. 37. */
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

/** Ertl's estimate from a register histogram C[0..Q+1]. */
export function ertl(C: ArrayLike<number>): number {
  let z = M * tau((M - C[Q + 1]) / M);
  for (let k = Q; k >= 1; k--) z = (z + C[k]) * 0.5;
  z += M * sigma(C[0] / M);
  return (M * M) / (2 * Math.LN2) / z;
}

/** Inserts n keys and returns the register histogram C[0..Q+1]. */
export function sketch(ks: KeySet, f: Family, n: number, seed: number): Uint32Array {
  const p = params(f, seed);
  const reg = new Uint8Array(M);
  const low = f === "mslo";
  for (let i = 0; i < n; i++) {
    const v = hash(f, p, key(ks, i));
    let idx: number;
    let w: number;
    if (low) {
      idx = v & (M - 1);
      w = (v & ~(M - 1)) >>> 0;
    } else {
      idx = v >>> Q;
      w = (v << P) >>> 0;
    }
    const r = w ? Math.clz32(w) + 1 : Q + 1;
    if (r > reg[idx]) reg[idx] = r;
  }
  const C = new Uint32Array(Q + 2);
  for (let j = 0; j < M; j++) C[reg[j]]++;
  return C;
}

export const trialSeed = (seed: number, fi: number, t: number) => (seed * 1000 + fi * 64 + t) >>> 0;

export interface Row {
  family: Family;
  errors: number[];
  /** Smallest register value in each trial's sketch. */
  mins: number[];
  median: number;
  rms: number;
  /** Register-value distribution of the trial whose estimate is the (lower) median. */
  hist: number[];
}

export interface Result {
  ks: KeySet;
  n: number;
  rows: Row[];
}

export function simulate(ks: KeySet, n: number, seed: number, trials = TRIALS): Result {
  const rows = FAMILIES.map(({ id }, fi) => {
    const errors: number[] = [];
    const mins: number[] = [];
    const sketches: Uint32Array[] = [];
    for (let t = 0; t < trials; t++) {
      const C = sketch(ks, id, n, trialSeed(seed, fi, t));
      errors.push(ertl(C) / n - 1);
      let k = 0;
      while (C[k] === 0) k++;
      mins.push(k);
      sketches.push(C);
    }
    const order = errors.map((_, t) => t).sort((a, b) => errors[a] - errors[b]);
    const mid = order[(trials - 1) >> 1];
    const median = trials % 2 ? errors[mid] : (errors[order[trials / 2 - 1]] + errors[order[trials / 2]]) / 2;
    const rms = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / trials);
    const hist = Array.from(sketches[mid], (c) => c / M);
    return { family: id, errors, mins, median, rms, hist };
  });
  return { ks, n, rows };
}

/** P(register = k) when n keys are hashed by a truly random function (Poisson model, lambda = n/m). */
export function modelHist(n: number): number[] {
  const lam = n / M;
  const F = (k: number) => Math.exp(-lam * 2 ** -k);
  const out: number[] = [];
  for (let k = 0; k <= Q + 1; k++) out.push(k === 0 ? Math.exp(-lam) : k === Q + 1 ? 1 - F(Q) : F(k) - F(k - 1));
  return out;
}

/**
 * Smallest k such that a random hash leaves every one of the m registers at k or above
 * with probability below 0.001, and that probability.
 */
export function floorTest(n: number): { k: number; p: number } {
  const model = modelHist(n);
  let below = 0;
  for (let k = 0; k < model.length; k++) {
    const p = Math.pow(1 - below, M);
    if (p < 1e-3) return { k, p };
    below += model[k];
  }
  return { k: model.length, p: 0 };
}
