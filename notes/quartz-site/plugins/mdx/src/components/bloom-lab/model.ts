// Bloom filter layouts on a simulated filter of 2^20 bits, and the closed forms
// the note compares them with. Everything is 32-bit integer arithmetic so the
// NumPy reference (content/algorithms/probabilistic/bloom-experiments/
// figure_ref.py) can reproduce every bit.
//
// Keys are the integers 0, 1, 2, ...: the first n are inserted and the next Q
// are the negative queries. Hash i of key x is fmix32(fmix32(x + s) ^ t_i),
// with s and the t_i drawn from the seed, so the key set is dense but every
// probe sees a mixed value.

export type Layout = "standard" | "partitioned" | "double" | "blocked512" | "blocked64" | "leveldb";

export const LAYOUTS: { id: Layout; label: string; block: number }[] = [
  { id: "standard", label: "Standard", block: 0 },
  { id: "partitioned", label: "Partitioned", block: 0 },
  { id: "double", label: "Double hashing", block: 0 },
  { id: "blocked512", label: "Blocked, 512-bit lines", block: 512 },
  { id: "blocked64", label: "Blocked, 64-bit words", block: 64 },
  { id: "leveldb", label: "LevelDB's probe sequence", block: 0 },
];

export const LOGM = 20;
export const M = 1 << LOGM;
export const Q = 1 << 19;
export const KMAX = 16;

export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** floor(h * r / 2^32) for a 32-bit h and r < 2^21: exact in doubles. */
export const range = (h: number, r: number): number => Math.floor((h * r) / 4294967296);

export interface Seeds {
  s: number;
  t: number[];
}

export function seeds(seed: number): Seeds {
  // splitmix32-style stream of 32-bit constants
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x9e3779b9) >>> 0;
    return fmix32(a);
  };
  const s = next();
  const t: number[] = [];
  for (let i = 0; i <= KMAX; i++) t.push(next());
  return { s, t };
}

/** Writes the k bit positions of key x into out; returns out. */
export function probes(layout: Layout, m: number, k: number, sd: Seeds, x: number, out: Int32Array): Int32Array {
  const base = fmix32((x + sd.s) >>> 0);
  const h = (i: number) => fmix32((base ^ sd.t[i]) >>> 0);
  switch (layout) {
    case "standard":
      for (let i = 0; i < k; i++) out[i] = range(h(i), m);
      break;
    case "partitioned": {
      const w = Math.floor(m / k);
      for (let i = 0; i < k; i++) out[i] = i * w + range(h(i), w);
      break;
    }
    case "double": {
      let a = range(h(0), m);
      const b = range(h(1), m);
      for (let i = 0; i < k; i++) {
        out[i] = a;
        a += b;
        if (a >= m) a -= m;
      }
      break;
    }
    case "blocked512": {
      const blk = range(h(0), m / 512) * 512;
      for (let i = 0; i < k; i++) out[i] = blk + (h(i + 1) >>> 23);
      break;
    }
    case "blocked64": {
      const blk = range(h(0), m / 64) * 64;
      for (let i = 0; i < k; i++) out[i] = blk + (h(i + 1) >>> 26);
      break;
    }
    case "leveldb": {
      let g = h(0);
      const delta = ((g >>> 17) | (g << 15)) >>> 0;
      for (let i = 0; i < k; i++) {
        out[i] = g % m;
        g = (g + delta) >>> 0;
      }
      break;
    }
  }
  return out;
}

export interface Filter {
  layout: Layout;
  m: number;
  n: number;
  k: number;
  sd: Seeds;
  bits: Uint32Array;
}

export function build(layout: Layout, m: number, n: number, k: number, seed: number): Filter {
  const sd = seeds(seed);
  const bits = new Uint32Array(m >>> 5);
  const p = new Int32Array(KMAX);
  for (let x = 0; x < n; x++) {
    probes(layout, m, k, sd, x, p);
    for (let i = 0; i < k; i++) bits[p[i] >>> 5] |= 1 << (p[i] & 31);
  }
  return { layout, m, n, k, sd, bits };
}

export function ones(f: Filter): number {
  let c = 0;
  for (const w of f.bits) {
    let v = w - ((w >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    c += (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
  }
  return c;
}

export const has = (f: Filter, x: number, p: Int32Array): boolean => {
  probes(f.layout, f.m, f.k, f.sd, x, p);
  for (let i = 0; i < f.k; i++) if (!((f.bits[p[i] >>> 5] >>> (p[i] & 31)) & 1)) return false;
  return true;
};

/** False positives among the Q keys n, n + 1, ..., n + Q - 1, none of which was inserted. */
export function falsePositives(f: Filter, q = Q): number {
  const p = new Int32Array(KMAX);
  let c = 0;
  for (let x = f.n; x < f.n + q; x++) if (has(f, x, p)) c++;
  return c;
}

export interface Point {
  k: number;
  fill: number;
  fp: number;
  q: number;
}

/** Builds the filter at every k from 1 to KMAX and counts its false positives. */
export function sweep(layout: Layout, bitsPerKey: number, seed: number, m = M, q = Q): Point[] {
  const n = Math.round(m / bitsPerKey);
  const out: Point[] = [];
  for (let k = 1; k <= KMAX; k++) {
    const f = build(layout, m, n, k, (seed * 131 + k) >>> 0);
    out.push({ k, fill: ones(f) / m, fp: falsePositives(f, q), q });
  }
  return out;
}

// ---- closed forms ----

/** (1 - e^{-k/b})^k: the standard approximation, b bits per key. */
export const fprStandard = (b: number, k: number): number => (1 - Math.exp(-k / b)) ** k;

const lgamma = (x: number): number => {
  // Stirling series; x >= 1 here, exact enough for Poisson weights
  if (x < 7) {
    let p = 1;
    while (x < 7) {
      p *= x;
      x += 1;
    }
    return lgamma(x) - Math.log(p);
  }
  const x2 = 1 / (x * x);
  return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + (1 / x) * (1 / 12 - x2 * (1 / 360 - x2 * (1 / 1260 - x2 / 1680)));
};

const poisson = (lam: number, imax: number): Float64Array => {
  const p = new Float64Array(imax + 1);
  for (let i = 0; i <= imax; i++) p[i] = Math.exp(-lam + i * Math.log(lam) - lgamma(i + 1));
  return p;
};

/**
 * Putze, Sanders and Singler's blocked rate: a block of B bits holds
 * Poisson(B/b) keys, and a block with i keys is a standard filter with fill
 * 1 - (1 - 1/B)^{ik}.
 */
export function fprBlockedPutze(b: number, k: number, B: number): number {
  const lam = B / b;
  const imax = Math.ceil(lam + 20 * Math.sqrt(lam) + 50);
  const p = poisson(lam, imax);
  let s = 0;
  for (let i = 0; i <= imax; i++) s += p[i] * (1 - (1 - 1 / B) ** (i * k)) ** k;
  return s;
}

const cache = new Map<string, number>();

/**
 * The same, with the fill of a block treated as the random variable it is:
 * E[(X/B)^k] where X is the number of distinct bits after ik uniform throws
 * into B bits, computed exactly by dynamic programming over X.
 */
export function fprBlockedExact(b: number, k: number, B: number): number {
  const key = `${b}|${k}|${B}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const lam = B / b;
  const imax = Math.ceil(lam + 20 * Math.sqrt(lam) + 50);
  const p = poisson(lam, imax);
  const w = new Float64Array(B + 1);
  for (let x = 0; x <= B; x++) w[x] = (x / B) ** k;
  let dist = new Float64Array(B + 1);
  let next = new Float64Array(B + 1);
  dist[0] = 1;
  let s = 0;
  for (let t = 0; t <= imax * k; t++) {
    if (t % k === 0) {
      let e = 0;
      for (let x = 0; x <= B; x++) e += dist[x] * w[x];
      s += p[t / k] * e;
    }
    next.fill(0);
    for (let x = 0; x <= B; x++) {
      const d = dist[x];
      if (d === 0) continue;
      next[x] += d * (x / B);
      if (x < B) next[x + 1] += d * (1 - x / B);
    }
    [dist, next] = [next, dist];
  }
  cache.set(key, s);
  return s;
}

/** The closed form the figure draws for a layout. */
export function theory(layout: Layout, b: number, k: number): number {
  const B = LAYOUTS.find((l) => l.id === layout)!.block;
  return B ? fprBlockedExact(b, k, B) : fprStandard(b, k);
}

/** Wilson 95% interval for a binomial proportion. */
export function wilson(x: number, n: number): [number, number] {
  const z = 1.959964;
  const p = x / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), c + h];
}
