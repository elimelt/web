// Construction and insertion of five fingerprint-filter layouts on a table of
// S slots, as used by the threshold figure. Every step is 32-bit integer
// arithmetic so the Python reference (content/algorithms/probabilistic/
// filter-experiments/figure_ref.py) reproduces each run exactly.
//
// Keys are the integers 0..n-1. Hash word i of key x is fmix32(base ^ t_i),
// with base = fmix32(x + s) and s, t_i drawn from the seed.

export type Kind = "cuckoo2" | "cuckoo4" | "xor" | "fuse" | "ribbon32" | "ribbon64";

export const KINDS: { id: Kind; label: string; threshold: number | null }[] = [
  { id: "cuckoo2", label: "Cuckoo filter, 2 slots per bucket", threshold: 0.897 },
  { id: "cuckoo4", label: "Cuckoo filter, 4 slots per bucket", threshold: 0.9804 },
  { id: "xor", label: "Xor filter", threshold: 0.818 },
  { id: "fuse", label: "Binary fuse filter", threshold: 0.9179 },
  { id: "ribbon32", label: "Ribbon filter, width 32", threshold: null },
  { id: "ribbon64", label: "Ribbon filter, width 64", threshold: null },
];

export const MAXKICKS = 500;

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
  walk: number;
}

export function seeds(seed: number): Seeds {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x9e3779b9) >>> 0;
    return fmix32(a);
  };
  const s = next();
  const t = [next(), next(), next(), next()];
  return { s, t, walk: next() };
}

/** The four hash words of key x. */
export function words(sd: Seeds, x: number, out: Uint32Array): Uint32Array {
  const base = fmix32((x + sd.s) >>> 0);
  for (let i = 0; i < 4; i++) out[i] = fmix32((base ^ sd.t[i]) >>> 0);
  return out;
}

export interface Run {
  kind: Kind;
  S: number;
  n: number;
  /** Keys placed before the first failure (n when the build succeeds). */
  placed: number;
  ok: boolean;
  /** Per-slot state for drawing: 0 empty, 1 used, 2 part of the failure. */
  cells: Uint8Array;
  /** Cuckoo: evictions; xor and fuse: keys left in the 2-core; ribbon: index of the failing key or -1. */
  stat: number;
  /** First slot of each block boundary to draw (buckets or segments), and the failing key's slots. */
  group: number;
  fail: number[];
}

/** The fuse layout for n keys in S slots: segment length and segment count. */
export function fuseLayout(n: number, S: number): { seg: number; count: number } {
  const nn = Math.max(n, 2);
  let seg = 2 ** Math.floor(Math.log(nn) / Math.log(3.33) + 2.25);
  seg = Math.min(seg, 262144, S / 4);
  return { seg, count: S / seg - 2 };
}

/** The slot positions (cuckoo: bucket indices) of key x. */
export function positions(kind: Kind, S: number, n: number, sd: Seeds, x: number, w: Uint32Array, out: Int32Array): void {
  words(sd, x, w);
  if (kind === "xor") {
    const bl = Math.floor(S / 3);
    out[0] = range(w[0], bl);
    out[1] = bl + range(w[1], bl);
    out[2] = 2 * bl + range(w[2], bl);
  } else if (kind === "fuse") {
    const { seg, count } = fuseLayout(n, S);
    const p0 = range(w[0], seg * count);
    out[0] = p0;
    out[1] = (p0 + seg) ^ (w[1] & (seg - 1));
    out[2] = (p0 + 2 * seg) ^ (w[2] & (seg - 1));
  }
}

export const cuckooAlt = (i: number, fp: number, nb: number): number => (i ^ (fmix32(Math.imul(fp, 0x5bd1e995) >>> 0) & (nb - 1))) >>> 0;

function cuckoo(S: number, b: number, n: number, sd: Seeds): Run {
  const nb = S / b;
  const t = new Uint32Array(S);
  const w = new Uint32Array(4);
  let rng = sd.walk >>> 0;
  const rand = () => {
    rng = (rng + 0x6d2b79f5) >>> 0;
    return fmix32(rng);
  };
  const put = (i: number, fp: number) => {
    for (let j = 0; j < b; j++) if (t[i * b + j] === 0) { t[i * b + j] = fp; return true; }
    return false;
  };
  let kicks = 0;
  let placed = 0;
  let fail: number[] = [];
  for (let x = 0; x < n; x++) {
    words(sd, x, w);
    const i1 = w[0] & (nb - 1);
    let fp = w[1] & 0xffff || 1;
    const i2 = cuckooAlt(i1, fp, nb);
    if (put(i1, fp) || put(i2, fp)) { placed++; continue; }
    let i = rand() & 1 ? i1 : i2;
    let ok = false;
    for (let k = 0; k < MAXKICKS; k++) {
      const j = rand() % b;
      const v = t[i * b + j];
      t[i * b + j] = fp;
      fp = v;
      kicks++;
      i = cuckooAlt(i, fp, nb);
      if (put(i, fp)) { ok = true; break; }
    }
    if (!ok) { fail = [i1, i2]; break; }
    placed++;
  }
  const cells = new Uint8Array(S);
  for (let s = 0; s < S; s++) cells[s] = t[s] ? 1 : 0;
  for (const bk of fail) for (let j = 0; j < b; j++) cells[bk * b + j] = 2;
  return { kind: b === 2 ? "cuckoo2" : "cuckoo4", S, n, placed, ok: placed === n, cells, stat: kicks, group: b, fail };
}

function peel(kind: Kind, S: number, n: number, sd: Seeds): Run {
  const pos = new Int32Array(3 * n);
  const w = new Uint32Array(4);
  const p = new Int32Array(3);
  for (let x = 0; x < n; x++) {
    positions(kind, S, n, sd, x, w, p);
    pos[3 * x] = p[0];
    pos[3 * x + 1] = p[1];
    pos[3 * x + 2] = p[2];
  }
  const cnt = new Int32Array(S);
  const xm = new Int32Array(S);
  for (let x = 0; x < n; x++) for (let j = 0; j < 3; j++) { cnt[pos[3 * x + j]]++; xm[pos[3 * x + j]] ^= x; }
  const used = new Uint8Array(S);
  for (let s = 0; s < S; s++) used[s] = cnt[s] > 0 ? 1 : 0;
  const q: number[] = [];
  for (let s = 0; s < S; s++) if (cnt[s] === 1) q.push(s);
  let done = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (cnt[c] !== 1) continue;
    const x = xm[c];
    done++;
    for (let j = 0; j < 3; j++) {
      const d = pos[3 * x + j];
      cnt[d]--;
      xm[d] ^= x;
      if (cnt[d] === 1) q.push(d);
    }
  }
  const cells = new Uint8Array(S);
  for (let s = 0; s < S; s++) cells[s] = cnt[s] > 0 ? 2 : used[s];
  const group = kind === "fuse" ? fuseLayout(n, S).seg : Math.floor(S / 3);
  return { kind, S, n, placed: done, ok: done === n, cells, stat: n - done, group, fail: [] };
}

function ribbon(S: number, wd: 32 | 64, n: number, sd: Seeds): Run {
  const lo = new Uint32Array(S);
  const hi = new Uint32Array(S);
  const w = new Uint32Array(4);
  let failAt = -1;
  let failStart = 0;
  const ctz = (v: number) => 31 - Math.clz32(v & -v);
  for (let x = 0; x < n; x++) {
    words(sd, x, w);
    let i = range(w[0], S - wd + 1);
    const start = i;
    let cl = (w[1] | 1) >>> 0;
    let ch = wd === 64 ? w[2] : 0;
    for (;;) {
      if (lo[i] === 0 && hi[i] === 0) { lo[i] = cl; hi[i] = ch; break; }
      cl = (cl ^ lo[i]) >>> 0;
      ch = (ch ^ hi[i]) >>> 0;
      if (cl === 0 && ch === 0) { failAt = x; failStart = start; break; }
      const j = cl ? ctz(cl) : 32 + ctz(ch);
      if (j >= 32) { cl = ch >>> (j - 32); ch = 0; }
      else if (j > 0) { cl = ((cl >>> j) | (ch << (32 - j))) >>> 0; ch = ch >>> j; }
      i += j;
    }
    if (failAt >= 0) break;
  }
  const cells = new Uint8Array(S);
  for (let s = 0; s < S; s++) cells[s] = lo[s] || hi[s] ? 1 : 0;
  const fail: number[] = [];
  if (failAt >= 0) for (let s = failStart; s < failStart + wd; s++) { cells[s] = cells[s] ? 2 : cells[s]; fail.push(s); }
  return { kind: wd === 32 ? "ribbon32" : "ribbon64", S, n, placed: failAt < 0 ? n : failAt, ok: failAt < 0, cells, stat: failAt, group: wd, fail };
}

/** Inserts or builds n keys into S slots (S a power of two, at least 256). */
export function build(kind: Kind, S: number, n: number, seed: number): Run {
  const sd = seeds(seed);
  if (kind === "cuckoo2") return cuckoo(S, 2, n, sd);
  if (kind === "cuckoo4") return cuckoo(S, 4, n, sd);
  if (kind === "ribbon32") return ribbon(S, 32, n, sd);
  if (kind === "ribbon64") return ribbon(S, 64, n, sd);
  return peel(kind, S, n, sd);
}

export const LOADS: number[] = Array.from({ length: 41 }, (_, i) => Math.round((0.6 + 0.01 * i) * 100) / 100);
export const TRIALS = 24;
export const keysAt = (S: number, load: number): number => Math.round(load * S);
export const trialSeed = (seed: number, li: number, t: number): number => (Math.imul(seed, 1000003) + li * 7919 + t * 104729) >>> 0;

export interface Point {
  load: number;
  ok: number;
  trials: number;
}

/** Success count over TRIALS builds at LOADS[li]. */
export function measure(kind: Kind, S: number, li: number, seed: number, trials = TRIALS): Point {
  const n = keysAt(S, LOADS[li]);
  let ok = 0;
  for (let t = 0; t < trials; t++) if (build(kind, S, n, trialSeed(seed, li, t)).ok) ok++;
  return { load: LOADS[li], ok, trials };
}

/** Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
