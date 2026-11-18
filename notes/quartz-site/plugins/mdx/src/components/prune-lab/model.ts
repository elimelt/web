// The arithmetic behind the pruning figure, free of the DOM so the build, the
// browser and the tests run the same code. The layer is the one the
// quantization figure uses: the inputs X reaching the feed-forward output
// projection (wo) of encoder layer 8 in Google's T5 v1.1 base (LM-adapted)
// for 24 tokens of a Go blog post, and 16 of that projection's 768 output
// columns W, as released. prune-layer.json adds each input channel's RMS over
// 128 calibration windows (Wanda's activation norm, up to a constant) and,
// for whole-layer comparison groups, the score threshold over the full
// 2048 x 768 matrix. Everything below prunes those numbers and multiplies,
// as prune.py does for the whole model.

import { loadLayer as loadQuantLayer, type LayerData } from "../outlier-lab/model";

export type { LayerData };

export interface PruneData {
  linear: string;
  model: string;
  n_cal_tokens: number;
  rms_f16: number[];
  grid: number[];
  layer_threshold: { magnitude: number[]; wanda: number[] };
  sweep: Sweep;
}

/** Whole-model perplexity on the Go-blog evaluation windows, measured offline. */
export interface Sweep {
  dense: number;
  sparsity: number[];
  curves: { key: string; label: string; ppl: number[] }[];
  nm: { key: string; label: string; pattern: string; ppl: number }[];
}

export interface Layer {
  tokens: string[];
  T: number;
  N: number;
  C: number;
  X: Float64Array; // T x N
  W: Float64Array; // N x C
  Y: Float64Array; // T x C, exact product
  rms: Float64Array; // N
  grid: number[];
  thr: { magnitude: number[]; wanda: number[] };
}

export type Method = "magnitude" | "wanda";
export type Group = "output" | "layer";
export type Pattern = "unstructured" | "2:4" | "4:8";

export interface Settings {
  method: Method;
  group: Group;
  pattern: Pattern;
  level: number; // index into grid (unstructured sparsity)
}

export const DEFAULTS: Settings = { method: "magnitude", group: "output", pattern: "unstructured", level: 10 };

export interface Result {
  keep: Uint8Array; // N x C, 1 = kept
  sparsity: number; // fraction of the shown weights removed
  relErr: number; // ||X Wp - X W|| / ||X W||
  tokenErr: Float64Array; // per token
  normRemoved: number; // ||W - Wp||_F / ||W||_F over the shown columns
  keptByChannel: Float64Array; // per input channel, fraction of the C weights kept
}

export function loadLayer(q: LayerData, p: PruneData): Layer {
  const L = loadQuantLayer(q);
  if (p.rms_f16.length !== L.N) throw new Error("prune-layer.json does not match the layer");
  return {
    tokens: L.tokens,
    T: L.T,
    N: L.N,
    C: L.C,
    X: L.X,
    W: L.W,
    Y: L.Y,
    rms: Float64Array.from(p.rms_f16),
    grid: p.grid,
    thr: p.layer_threshold,
  };
}

export function sparsityOf(L: Layer, set: Settings): number {
  return set.pattern === "unstructured" ? L.grid[set.level] : 0.5;
}

/** Importance of weight (j, c): |w| for magnitude, |w| * ||x_j|| for Wanda. */
export function scores(L: Layer, method: Method): Float64Array {
  const S = new Float64Array(L.N * L.C);
  for (let j = 0; j < L.N; j++) {
    const a = method === "wanda" ? L.rms[j] : 1;
    for (let c = 0; c < L.C; c++) S[j * L.C + c] = Math.abs(L.W[j * L.C + c]) * a;
  }
  return S;
}

/** Ascending order of one column's scores, ties by input index (numpy's stable argsort). */
function orderOf(vals: Float64Array): Int32Array {
  const idx = Int32Array.from({ length: vals.length }, (_, i) => i);
  idx.sort((a, b) => vals[a] - vals[b] || a - b);
  return idx;
}

export function mask(L: Layer, set: Settings): Uint8Array {
  const S = scores(L, set.method);
  const { N, C } = L;
  const keep = new Uint8Array(N * C).fill(1);
  if (set.pattern !== "unstructured") {
    const m = set.pattern === "2:4" ? 4 : 8;
    const drop = m / 2;
    const g = new Float64Array(m);
    for (let c = 0; c < C; c++)
      for (let j0 = 0; j0 < N; j0 += m) {
        for (let i = 0; i < m; i++) g[i] = S[(j0 + i) * C + c];
        const o = orderOf(g);
        for (let i = 0; i < drop; i++) keep[(j0 + o[i]) * C + c] = 0;
      }
    return keep;
  }
  const s = L.grid[set.level];
  if (set.group === "layer") {
    const t = L.thr[set.method][set.level];
    for (let i = 0; i < N * C; i++) keep[i] = S[i] > t ? 1 : 0;
    return keep;
  }
  const k = Math.floor(N * s);
  const col = new Float64Array(N);
  for (let c = 0; c < C; c++) {
    for (let j = 0; j < N; j++) col[j] = S[j * C + c];
    const o = orderOf(col);
    for (let i = 0; i < k; i++) keep[o[i] * C + c] = 0;
  }
  return keep;
}

export function prune(L: Layer, set: Settings): Result {
  const { T, N, C, X, W, Y } = L;
  const keep = mask(L, set);
  const Wp = new Float64Array(N * C);
  let rem = 0;
  let tot = 0;
  let removed = 0;
  const keptByChannel = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    let k = 0;
    for (let c = 0; c < C; c++) {
      const i = j * C + c;
      const w = W[i];
      tot += w * w;
      if (keep[i]) {
        Wp[i] = w;
        k++;
      } else {
        rem += w * w;
        removed++;
      }
    }
    keptByChannel[j] = k / C;
  }
  const tokenErr = new Float64Array(T);
  let num = 0;
  let den = 0;
  for (let t = 0; t < T; t++) {
    let tn = 0;
    let td = 0;
    for (let c = 0; c < C; c++) {
      let acc = 0;
      for (let j = 0; j < N; j++) acc += X[t * N + j] * Wp[j * C + c];
      const y = Y[t * C + c];
      tn += (acc - y) ** 2;
      td += y * y;
    }
    tokenErr[t] = td > 0 ? Math.sqrt(tn / td) : 0;
    num += tn;
    den += td;
  }
  return {
    keep,
    sparsity: removed / (N * C),
    relErr: Math.sqrt(num / den),
    tokenErr,
    normRemoved: Math.sqrt(rem / tot),
    keptByChannel,
  };
}

/** Channels binned by log10 of their activation RMS. */
export interface Bin {
  lo: number; // log10 lower edge
  hi: number;
  count: number;
  kept: number; // mean fraction of weights kept, NaN if empty
}

export function bins(L: Layer, r: Result, edges: number[]): Bin[] {
  const out: Bin[] = [];
  for (let b = 0; b + 1 < edges.length; b++) out.push({ lo: edges[b], hi: edges[b + 1], count: 0, kept: 0 });
  for (let j = 0; j < L.N; j++) {
    const l = Math.log10(Math.max(L.rms[j], 1e-12));
    let b = out.findIndex((x) => l >= x.lo && l < x.hi);
    if (b < 0) b = l < edges[0] ? 0 : out.length - 1;
    out[b].count++;
    out[b].kept += r.keptByChannel[j];
  }
  for (const x of out) x.kept = x.count ? x.kept / x.count : NaN;
  return out;
}

/** The input channel with the largest activation RMS. */
export function loudest(L: Layer): number {
  let best = 0;
  for (let j = 1; j < L.N; j++) if (L.rms[j] > L.rms[best]) best = j;
  return best;
}
