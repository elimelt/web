// Heavy-hitter summaries run on a recorded substream of the pageview
// benchmark: Misra-Gries, Space-Saving, and Count Sketch and Count-Min, each
// with a set of candidate keys. Every rule that a tie could make ambiguous is
// fixed (the smallest counter with the lowest slot index is the one replaced),
// so the Python reference in heavy-hitter-experiments/figure_ref.py produces
// the same summaries exactly.

export type Alg = "mg" | "ss" | "cs" | "cms";

export interface AlgInfo {
  id: Alg;
  label: string;
  /** Rows of a sketch. */
  rows: number;
}

export const ALGS: AlgInfo[] = [
  { id: "mg", label: "Misra–Gries", rows: 0 },
  { id: "ss", label: "Space-Saving", rows: 0 },
  { id: "cs", label: "Count Sketch and candidates", rows: 5 },
  { id: "cms", label: "Count-Min and candidates", rows: 4 },
];

/** Budgets, in counters of 16 bytes (an 8-byte key and an 8-byte count). */
export const BUDGETS = [16, 32, 64, 128, 256, 512];

/** Number of keys the figure follows and the summaries report. */
export const TOP = 20;

export interface Stream {
  /** Key of each record, numbered by total views (0 is the most viewed key). */
  keys: Uint16Array;
  /** Views in each record. */
  counts: Uint16Array;
  /** Number of distinct keys. */
  nkeys: number;
}

/** Splits a planar buffer: T little-endian uint16 keys, then T uint16 counts. */
export function decode(bytes: Uint8Array): Stream {
  const T = bytes.byteLength >> 2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keys = new Uint16Array(T);
  const counts = new Uint16Array(T);
  let nkeys = 0;
  for (let i = 0; i < T; i++) {
    keys[i] = view.getUint16(2 * i, true);
    counts[i] = view.getUint16(2 * (T + i), true);
    if (keys[i] + 1 > nkeys) nkeys = keys[i] + 1;
  }
  return { keys, counts, nkeys };
}

/** MurmurHash3's 32-bit finalizer. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A 32-bit splitmix-style sequence: x += golden ratio, output fmix32(x). */
export function seq(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    return fmix32(x);
  };
}

/** Record order: the file order (null) or a Fisher-Yates shuffle with the seed. */
export function permutation(T: number, seed: number): Int32Array {
  const p = new Int32Array(T);
  for (let i = 0; i < T; i++) p[i] = i;
  const next = seq(seed ^ 0x5bd1e995);
  for (let i = T - 1; i > 0; i--) {
    const j = Math.floor((next() * (i + 1)) / 4294967296);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  return p;
}

/** Key, estimate and the interval the summary guarantees for the true count. */
export interface Estimate {
  key: number;
  est: number;
  lo: number;
  hi: number;
}

export interface Event {
  t: number;
  key: number;
  c: number;
  /** "add": the key had a counter; "new": a free counter; "replace": the smallest
   * counter was taken over; "decrement": every counter was lowered; "sketch". */
  kind: "add" | "new" | "replace" | "decrement" | "sketch";
  /** Key whose counter was replaced, or -1. */
  evicted: number;
  /** Count of the replaced counter, or the amount of the decrement. */
  amount: number;
  /** Whether the key holds a counter or candidate place afterwards. */
  kept: boolean;
}

export interface Summary {
  alg: Alg;
  budget: number;
  /** Records processed and the views they hold. */
  t: number;
  n: number;
  /** Monitored keys (counters) or candidate keys (sketches), by slot. */
  slotKey: Int32Array;
  slotVal: Float64Array;
  slotErr: Float64Array;
  used: number;
  /** Sketch cells, rows times width, and the width. */
  cells: Float64Array | null;
  width: number;
  rowSeeds: number[];
  /** Misra-Gries: views removed by decrements in all. */
  removed: number;
  last: Event | null;
}

/** Counters of a counter summary; sketch candidates take a quarter of the bytes. */
export function capacity(alg: Alg, budget: number): number {
  return alg === "mg" || alg === "ss" ? budget : budget / 4;
}
/** Cells per row: three quarters of the bytes as 4-byte cells. */
export function width(alg: Alg, budget: number): number {
  const rows = ALGS.find((a) => a.id === alg)!.rows;
  return rows ? Math.floor((3 * budget) / rows) : 0;
}

function rowHash(seed: number, key: number): number {
  return fmix32((key + 1) ^ seed);
}

function median(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length & 1 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Point estimate from the sketch rows. */
export function sketchQuery(s: Summary, key: number): number {
  const rows = s.rowSeeds.length;
  const v: number[] = [];
  for (let j = 0; j < rows; j++) {
    const h = rowHash(s.rowSeeds[j], key);
    const b = Math.floor((h * s.width) / 4294967296);
    const cell = s.cells![j * s.width + b];
    v.push(s.alg === "cs" ? (h & 1 ? cell : -cell) : cell);
  }
  return s.alg === "cs" ? median(v) : Math.min(...v);
}

/**
 * Runs a summary over the first `upto` records in the given order. `slotOf`
 * is scratch space indexed by key; pass one of length nkeys to reuse it.
 */
export function run(alg: Alg, budget: number, stream: Stream, order: Int32Array | null, upto: number, seed: number): Summary {
  const cap = capacity(alg, budget);
  const w = width(alg, budget);
  const rows = ALGS.find((a) => a.id === alg)!.rows;
  const next = seq(seed);
  const rowSeeds: number[] = [];
  for (let j = 0; j < rows; j++) rowSeeds.push(next());
  const s: Summary = {
    alg,
    budget,
    t: 0,
    n: 0,
    slotKey: new Int32Array(cap).fill(-1),
    slotVal: new Float64Array(cap),
    slotErr: new Float64Array(cap),
    used: 0,
    cells: rows ? new Float64Array(rows * w) : null,
    width: w,
    rowSeeds,
    removed: 0,
    last: null,
  };
  const slotOf = new Int32Array(stream.nkeys).fill(-1);
  const minSlot = () => {
    let m = 0;
    for (let i = 1; i < s.used; i++) if (s.slotVal[i] < s.slotVal[m]) m = i;
    return m;
  };
  const T = Math.min(upto, stream.keys.length);
  for (let t = 0; t < T; t++) {
    const r = order ? order[t] : t;
    const key = stream.keys[r];
    const c = stream.counts[r];
    s.n += c;
    const ev: Event = { t, key, c, kind: "add", evicted: -1, amount: 0, kept: true };
    const p = slotOf[key];
    if (alg === "mg" || alg === "ss") {
      if (p >= 0) s.slotVal[p] += c;
      else if (s.used < cap) {
        const q = s.used++;
        s.slotKey[q] = key;
        s.slotVal[q] = c;
        s.slotErr[q] = 0;
        slotOf[key] = q;
        ev.kind = "new";
      } else if (alg === "ss") {
        const q = minSlot();
        const mn = s.slotVal[q];
        slotOf[s.slotKey[q]] = -1;
        ev.kind = "replace";
        ev.evicted = s.slotKey[q];
        ev.amount = mn;
        s.slotKey[q] = key;
        s.slotVal[q] = mn + c;
        s.slotErr[q] = mn;
        slotOf[key] = q;
      } else {
        // Misra-Gries: lower every counter, and the new key, by d.
        const mn = s.slotVal[minSlot()];
        const d = Math.min(c, mn);
        s.removed += d * (s.used + 1);
        let j = 0;
        for (let i = 0; i < s.used; i++) {
          const v = s.slotVal[i] - d;
          if (v > 0) {
            s.slotKey[j] = s.slotKey[i];
            s.slotVal[j] = v;
            slotOf[s.slotKey[j]] = j;
            j++;
          } else slotOf[s.slotKey[i]] = -1;
        }
        for (let i = j; i < s.used; i++) s.slotKey[i] = -1;
        s.used = j;
        ev.kind = "decrement";
        ev.amount = d;
        if (c > d) {
          const q = s.used++;
          s.slotKey[q] = key;
          s.slotVal[q] = c - d;
          slotOf[key] = q;
        } else ev.kept = false;
      }
    } else {
      // Sketch update, then offer the key's new estimate to the candidates.
      for (let j = 0; j < rows; j++) {
        const h = rowHash(rowSeeds[j], key);
        const b = Math.floor((h * w) / 4294967296);
        s.cells![j * w + b] += alg === "cs" ? (h & 1 ? c : -c) : c;
      }
      const e = sketchQuery(s, key);
      ev.kind = "sketch";
      if (p >= 0) s.slotVal[p] = e;
      else if (s.used < cap) {
        const q = s.used++;
        s.slotKey[q] = key;
        s.slotVal[q] = e;
        slotOf[key] = q;
      } else {
        const q = minSlot();
        if (e > s.slotVal[q]) {
          slotOf[s.slotKey[q]] = -1;
          ev.evicted = s.slotKey[q];
          ev.amount = s.slotVal[q];
          s.slotKey[q] = key;
          s.slotVal[q] = e;
          slotOf[key] = q;
        } else ev.kept = false;
      }
    }
    s.last = ev;
  }
  s.t = T;
  return s;
}

/** True views per key in the first `upto` records of the order. */
export function truth(stream: Stream, order: Int32Array | null, upto: number): Float64Array {
  const a = new Float64Array(stream.nkeys);
  const T = Math.min(upto, stream.keys.length);
  for (let t = 0; t < T; t++) {
    const r = order ? order[t] : t;
    a[stream.keys[r]] += stream.counts[r];
  }
  return a;
}

/** Sum of the counters (counter summaries). */
export function counted(s: Summary): number {
  let x = 0;
  for (let i = 0; i < s.used; i++) x += s.slotVal[i];
  return x;
}

/** The smallest counter of a full summary, 0 otherwise. */
export function minCount(s: Summary): number {
  if (s.used < capacity(s.alg, s.budget)) return 0;
  let m = Infinity;
  for (let i = 0; i < s.used; i++) m = Math.min(m, s.slotVal[i]);
  return m;
}

/** Root of the sum of squared counts, for the Count Sketch interval. */
export function l2(a: Float64Array): number {
  let x = 0;
  for (let i = 0; i < a.length; i++) x += a[i] * a[i];
  return Math.sqrt(x);
}

/**
 * Estimate for one key with the interval each summary guarantees:
 * Misra-Gries [c, c + (n - counted)/(k+1)], deterministic;
 * Space-Saving [c - err, c] for a monitored key and [0, min] otherwise, deterministic;
 * Count-Min [c - e n / w, c], with probability at least 1 - e^-d;
 * Count Sketch c ± sqrt(3/w) ||a||_2, with probability at least 0.79 for 5 rows.
 */
export function estimate(s: Summary, key: number, norm2: number, slotOf?: Map<number, number>): Estimate {
  let p = -1;
  if (slotOf) p = slotOf.get(key) ?? -1;
  else for (let i = 0; i < s.used; i++) if (s.slotKey[i] === key) p = i;
  if (s.alg === "mg") {
    const c = p >= 0 ? s.slotVal[p] : 0;
    const k = s.budget;
    return { key, est: c, lo: c, hi: c + (s.n - counted(s)) / (k + 1) };
  }
  if (s.alg === "ss") {
    if (p >= 0) return { key, est: s.slotVal[p], lo: s.slotVal[p] - s.slotErr[p], hi: s.slotVal[p] };
    return { key, est: 0, lo: 0, hi: minCount(s) };
  }
  const c = sketchQuery(s, key);
  if (s.alg === "cms") return { key, est: c, lo: Math.max(0, c - (Math.E * s.n) / s.width), hi: c };
  const r = Math.sqrt(3 / s.width) * norm2;
  return { key, est: c, lo: Math.max(0, c - r), hi: c + r };
}

/** The TOP keys the summary reports: largest counters or candidates. */
export function reported(s: Summary): number[] {
  const idx: number[] = [];
  for (let i = 0; i < s.used; i++) idx.push(i);
  idx.sort((a, b) => s.slotVal[b] - s.slotVal[a] || s.slotKey[a] - s.slotKey[b]);
  return idx.slice(0, TOP).map((i) => s.slotKey[i]);
}

/** The TOP keys by true count (ties by key number). */
export function trueTop(a: Float64Array): number[] {
  const idx: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] > 0) idx.push(i);
  idx.sort((x, y) => a[y] - a[x] || x - y);
  return idx.slice(0, TOP);
}

export interface Outcome {
  top: number[];
  rows: (Estimate & { truth: number; reported: boolean })[];
  /** True top keys among the reported keys. */
  hits: number;
  /** Largest |estimate - truth| over the true top keys. */
  maxErr: number;
  /** Bound the summary states for that error (deterministic for counters). */
  bound: number;
}

export function outcome(s: Summary, a: Float64Array): Outcome {
  const top = trueTop(a);
  const rep = new Set(reported(s));
  const slotOf = new Map<number, number>();
  for (let i = 0; i < s.used; i++) slotOf.set(s.slotKey[i], i);
  const norm2 = s.alg === "cs" ? l2(a) : 0;
  const rows = top.map((k) => ({ ...estimate(s, k, norm2, slotOf), truth: a[k], reported: rep.has(k) }));
  let maxErr = 0;
  for (const r of rows) maxErr = Math.max(maxErr, Math.abs(r.est - r.truth));
  let hits = 0;
  for (const k of top) if (rep.has(k)) hits++;
  const bound =
    s.alg === "mg"
      ? (s.n - counted(s)) / (s.budget + 1)
      : s.alg === "ss"
        ? minCount(s)
        : s.alg === "cms"
          ? (Math.E * s.n) / s.width
          : Math.sqrt(3 / s.width) * norm2;
  return { top, rows, hits, maxErr, bound };
}
