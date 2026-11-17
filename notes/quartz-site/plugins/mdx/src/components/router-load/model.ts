// Router load model for the RouterLoad figure, free of the DOM.
//
// The data are the expert each token chose (argmax of the router softmax) in
// one switch layer of a released Switch-Base encoder, for four kinds of real
// text, in 256-token windows. The figure forms batches from those choices,
// gives every expert a buffer of ceil(c * B / N) tokens, and counts the tokens
// that overflow: the tokens a fixed-capacity switch layer drops.

import { mulberry32 } from "../../shared/random";

export const DOMAINS = ["prose", "code", "shakespeare", "math"] as const;
export type Domain = (typeof DOMAINS)[number];
export type Traffic = Domain | "mixed";
export type Mode = "tokens" | "sequences";

export interface RouterData {
  model: string; // "e8" | "e64"
  layer: number; // encoder block index in the checkpoint
  N: number; // routed experts
  win: number; // tokens per window
  domains: Record<Domain, string>; // base64, one byte per token: chosen expert
}

export interface Routes {
  model: string;
  layer: number;
  N: number;
  win: number;
  choices: Record<Domain, Uint8Array>;
}

export interface Settings {
  traffic: Traffic;
  batch: number;
  mode: Mode;
  cf: number;
  draw: number; // which sampled batch is drawn; Resample increments it
}

export const DEFAULTS: Settings = { traffic: "mixed", batch: 256, mode: "tokens", cf: 1.25, draw: 0 };
export const BATCHES = [16, 64, 256, 1024, 4096];
export const AVG_BATCHES = 400;

function fromBase64(s: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, "base64"));
}

export function loadRoutes(d: RouterData): Routes {
  const choices = {} as Record<Domain, Uint8Array>;
  for (const k of DOMAINS) {
    const a = fromBase64(d.domains[k]);
    if (a.length % d.win) throw new Error(`${k}: ${a.length} tokens is not a whole number of windows`);
    for (const e of a) if (e >= d.N) throw new Error(`${k}: expert ${e} out of range`);
    choices[k] = a;
  }
  return { model: d.model, layer: d.layer, N: d.N, win: d.win, choices };
}

/** The windows (as arrays of choices) that make up a traffic pool. */
export function pool(r: Routes, t: Traffic): Uint8Array[] {
  const doms = t === "mixed" ? DOMAINS : [t];
  const out: Uint8Array[] = [];
  for (const d of doms) {
    const a = r.choices[d];
    for (let s = 0; s < a.length; s += r.win) out.push(a.subarray(s, s + r.win));
  }
  return out;
}

/** Share of the whole pool's tokens that chose each expert. */
export function poolLoad(r: Routes, t: Traffic): Float64Array {
  const f = new Float64Array(r.N);
  let n = 0;
  for (const w of pool(r, t)) for (const e of w) (f[e]++, n++);
  for (let i = 0; i < r.N; i++) f[i] /= n;
  return f;
}

export function capacity(cf: number, B: number, N: number): number {
  // round first so 1.15 * 64 / 8 does not become 9.200000000000001 -> 10
  return Math.ceil(Math.round(cf * B / N * 1e9) / 1e9);
}

/**
 * One batch of B chosen experts. "tokens": B tokens drawn independently, with
 * replacement, from the pool (decode-like: one token from each of B requests).
 * "sequences": whole windows (B >= win, distinct windows) or one contiguous
 * span of B tokens in a random window (prefill-like).
 */
export function sampleBatch(windows: Uint8Array[], B: number, mode: Mode, rand: () => number): Uint8Array {
  const out = new Uint8Array(B);
  const W = windows.length;
  const win = windows[0].length;
  if (mode === "tokens") {
    for (let i = 0; i < B; i++) {
      const w = windows[Math.floor(rand() * W)];
      out[i] = w[Math.floor(rand() * win)];
    }
    return out;
  }
  if (B < win) {
    const w = windows[Math.floor(rand() * W)];
    const s = Math.floor(rand() * (win - B + 1));
    out.set(w.subarray(s, s + B));
    return out;
  }
  const k = B / win;
  // partial Fisher-Yates over window indices: k distinct windows when k <= W
  const idx = Array.from({ length: W }, (_, i) => i);
  for (let j = 0; j < k; j++) {
    let pick: number;
    if (k <= W) {
      const r = j + Math.floor(rand() * (W - j));
      [idx[j], idx[r]] = [idx[r], idx[j]];
      pick = idx[j];
    } else pick = Math.floor(rand() * W);
    out.set(windows[pick], j * win);
  }
  return out;
}

export function counts(batch: Uint8Array, N: number): Int32Array {
  const n = new Int32Array(N);
  for (const e of batch) n[e]++;
  return n;
}

export function dropped(n: Int32Array, C: number): number {
  let d = 0;
  for (const v of n) if (v > C) d += v - C;
  return d;
}

export interface Result {
  C: number;
  batch: Int32Array; // tokens per expert in the drawn batch
  batchDropped: number;
  meanDrop: number; // fraction of tokens dropped, averaged over AVG_BATCHES batches
  p95Drop: number;
  meanMaxOverMean: number; // busiest expert / mean, averaged over the same batches
  poolMaxOverMean: number; // over the whole pool
  pool: Float64Array;
}

export function simulate(r: Routes, s: Settings, R = AVG_BATCHES): Result {
  const windows = pool(r, s.traffic);
  const C = capacity(s.cf, s.batch, r.N);
  // the averaged batches never depend on the draw counter, so resampling only changes the bars
  const rand = mulberry32(1000 + s.batch + (s.mode === "tokens" ? 0 : 7) + 31 * DOMAINS.indexOf(s.traffic as Domain));
  const drops: number[] = [];
  let mm = 0;
  for (let i = 0; i < R; i++) {
    const n = counts(sampleBatch(windows, s.batch, s.mode, rand), r.N);
    drops.push(dropped(n, C) / s.batch);
    mm += Math.max(...n) / (s.batch / r.N);
  }
  drops.sort((a, b) => a - b);
  const one = counts(sampleBatch(windows, s.batch, s.mode, mulberry32(77 + s.draw)), r.N);
  const f = poolLoad(r, s.traffic);
  return {
    C,
    batch: one,
    batchDropped: dropped(one, C),
    meanDrop: drops.reduce((a, b) => a + b, 0) / R,
    p95Drop: drops[Math.min(R - 1, Math.floor(0.95 * R))],
    meanMaxOverMean: mm / R,
    poolMaxOverMean: Math.max(...f) * r.N,
    pool: f,
  };
}
