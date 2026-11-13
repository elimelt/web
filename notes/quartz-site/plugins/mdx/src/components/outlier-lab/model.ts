// The arithmetic behind the outlier figure, free of the DOM so the build, the
// browser and the tests run the same code. The data is one real layer of
// Google's T5 v1.1 base (LM-adapted): the inputs X that reach the encoder's
// layer-8 feed-forward output projection for 24 tokens of a Go blog post,
// 16 columns of that projection's released weights W, and the per-channel
// input maximum over calibration text. Everything below quantizes those
// numbers and multiplies them, exactly as the experiment harness does.

export interface LayerData {
  linear: string;
  model: string;
  tokens: string[];
  n_in: number;
  cols: number[];
  x_f16: string;
  w_bf16: string;
  w_rowmax_bf16: string;
  cal_absmax_f16: string;
}

export interface Layer {
  name: string;
  tokens: string[];
  T: number; // tokens
  N: number; // input channels
  C: number; // output columns shown
  X: Float64Array; // T x N, row-major
  W: Float64Array; // N x C, row-major
  wRowMax: Float64Array; // max |W[j, :]| over all 768 output columns of the full weight
  calMax: Float64Array; // max |x_j| over calibration text
  Y: Float64Array; // T x C, the exact product
}

export type Method = "tensor" | "token" | "smooth" | "int8" | "fp8";

export interface Settings {
  method: Method;
  bits: number; // 8 or 4 (ignored by fp8)
  alpha: number; // SmoothQuant migration strength
  threshold: number; // LLM.int8() outlier threshold
}

export interface Result {
  Yq: Float64Array;
  relErr: number; // ||Yq - Y|| / ||Y||
  sqnr: number; // dB
  zeroFrac: number; // nonzero activations that round to zero (of the quantized ones)
  tokenErr: Float64Array; // per-token relative output error
  xChan: Float64Array; // per-channel max |x| as quantized (after any smoothing)
  wChan: Float64Array; // per-channel max |w| over the full row (after any smoothing)
  step: number; // activation step size for one-scale schemes, else NaN
  floatCols: number; // input channels kept in floating point (LLM.int8())
}

// ---- decoding ------------------------------------------------------------------
function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function u16(b64: string): Uint16Array {
  const b = bytes(b64);
  const out = new Uint16Array(b.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = b[2 * i] | (b[2 * i + 1] << 8);
  return out;
}

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

const bf16Buf = new DataView(new ArrayBuffer(4));
export function bf16ToFloat(h: number): number {
  bf16Buf.setUint32(0, h << 16);
  return bf16Buf.getFloat32(0);
}

const decode = (b64: string, f: (h: number) => number) => Float64Array.from(u16(b64), f);

export function loadLayer(d: LayerData): Layer {
  const X = decode(d.x_f16, halfToFloat);
  const W = decode(d.w_bf16, bf16ToFloat);
  const N = d.n_in;
  const T = X.length / N;
  const C = W.length / N;
  return {
    name: d.linear,
    tokens: d.tokens,
    T,
    N,
    C,
    X,
    W,
    wRowMax: decode(d.w_rowmax_bf16, bf16ToFloat),
    calMax: decode(d.cal_absmax_f16, halfToFloat),
    Y: matmul(X, W, T, N, C),
  };
}

export function matmul(X: Float64Array, W: Float64Array, T: number, N: number, C: number): Float64Array {
  const Y = new Float64Array(T * C);
  for (let t = 0; t < T; t++) {
    for (let j = 0; j < N; j++) {
      const x = X[t * N + j];
      if (x === 0) continue;
      const row = j * C;
      for (let c = 0; c < C; c++) Y[t * C + c] += x * W[row + c];
    }
  }
  return Y;
}

// ---- grids ---------------------------------------------------------------------
/** Symmetric round-to-nearest: scale = amax / (2^(b-1) - 1). Ties go to even, as numpy's rint. */
export function rint(v: number): number {
  const r = Math.round(v);
  return Math.abs(v - Math.trunc(v)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function qsym(v: number, scale: number, bits: number): number {
  const qmax = 2 ** (bits - 1) - 1;
  if (scale <= 0) return v;
  return Math.min(qmax, Math.max(-qmax - 1, rint(v / scale))) * scale;
}

/** Nearest FP8 E4M3 value (max 448, subnormal step 2^-9). */
export function roundE4M3(v: number): number {
  const a = Math.abs(v);
  const e = Math.max(Math.floor(Math.log2(Math.max(a, 2 ** -9))), -6);
  const step = 2 ** (e - 3);
  return Math.sign(v) * Math.min(rint(a / step) * step, 448);
}

// ---- the schemes ---------------------------------------------------------------
/** Weights: one scale per output column, as every scheme here uses. */
function quantW(L: Layer, s: Float64Array | null, bits: number | "fp8", keep: Uint8Array | null): Float64Array {
  const { N, C, W } = L;
  const out = new Float64Array(N * C);
  for (let c = 0; c < C; c++) {
    let amax = 0;
    for (let j = 0; j < N; j++) {
      if (keep && !keep[j]) continue;
      const w = W[j * C + c] * (s ? s[j] : 1);
      amax = Math.max(amax, Math.abs(w));
    }
    for (let j = 0; j < N; j++) {
      if (keep && !keep[j]) continue;
      const w = W[j * C + c] * (s ? s[j] : 1);
      out[j * C + c] = bits === "fp8" ? (amax > 0 ? roundE4M3(w / (amax / 448)) * (amax / 448) : w) : qsym(w, amax / (2 ** (bits - 1) - 1), bits);
    }
  }
  return out;
}

export function smoothScales(L: Layer, alpha: number): Float64Array {
  const s = new Float64Array(L.N);
  for (let j = 0; j < L.N; j++) {
    const x = Math.max(L.calMax[j], 1e-5);
    const w = Math.max(L.wRowMax[j], 1e-5);
    s[j] = x ** alpha / w ** (1 - alpha);
  }
  return s;
}

export function quantize(L: Layer, set: Settings): Result {
  const { T, N, C, X, Y } = L;
  const bits = set.bits;
  const s = set.method === "smooth" ? smoothScales(L, set.alpha) : null;
  let keep: Uint8Array | null = null;
  let floatCols = 0;
  if (set.method === "int8") {
    keep = new Uint8Array(N).fill(1);
    for (let j = 0; j < N; j++) {
      for (let t = 0; t < T; t++) {
        if (Math.abs(X[t * N + j]) >= set.threshold) {
          keep[j] = 0;
          floatCols++;
          break;
        }
      }
    }
  }
  // activations: the quantized input, after smoothing
  const Xq = new Float64Array(T * N);
  let zeros = 0;
  let nonzero = 0;
  let step = NaN;
  const xs = (t: number, j: number) => X[t * N + j] / (s ? s[j] : 1);
  if (set.method === "tensor" || set.method === "smooth" || set.method === "fp8") {
    let amax = 0;
    for (let t = 0; t < T; t++) for (let j = 0; j < N; j++) amax = Math.max(amax, Math.abs(xs(t, j)));
    step = set.method === "fp8" ? amax / 448 : amax / (2 ** (bits - 1) - 1);
    for (let t = 0; t < T; t++)
      for (let j = 0; j < N; j++) {
        const v = xs(t, j);
        Xq[t * N + j] = set.method === "fp8" ? roundE4M3(v / step) * step : qsym(v, step, bits);
      }
  } else {
    // per token (also the INT8 part of LLM.int8())
    for (let t = 0; t < T; t++) {
      let amax = 0;
      for (let j = 0; j < N; j++) if (!keep || keep[j]) amax = Math.max(amax, Math.abs(X[t * N + j]));
      const sc = amax / (2 ** (bits - 1) - 1);
      for (let j = 0; j < N; j++) {
        const v = X[t * N + j];
        Xq[t * N + j] = keep && !keep[j] ? v : qsym(v, sc, bits);
      }
    }
  }
  for (let i = 0; i < T * N; i++) {
    if (keep && !keep[i % N]) continue;
    if (X[i] !== 0) {
      nonzero++;
      if (Xq[i] === 0) zeros++;
    }
  }
  const Wq = quantW(L, s, set.method === "fp8" ? "fp8" : bits, keep);
  if (keep) for (let j = 0; j < N; j++) if (!keep[j]) for (let c = 0; c < C; c++) Wq[j * C + c] = L.W[j * C + c];
  const Yq = matmul(Xq, Wq, T, N, C);
  let num = 0;
  let den = 0;
  const tokenErr = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    let n = 0;
    let d = 0;
    for (let c = 0; c < C; c++) {
      const e = Yq[t * C + c] - Y[t * C + c];
      n += e * e;
      d += Y[t * C + c] ** 2;
    }
    tokenErr[t] = Math.sqrt(n / d);
    num += n;
    den += d;
  }
  const relErr = Math.sqrt(num / den);
  const xChan = new Float64Array(N);
  const wChan = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    let m = 0;
    for (let t = 0; t < T; t++) m = Math.max(m, Math.abs(xs(t, j)));
    xChan[j] = m;
    wChan[j] = L.wRowMax[j] * (s ? s[j] : 1);
  }
  return { Yq, relErr, sqnr: -20 * Math.log10(relErr), zeroFrac: nonzero ? zeros / nonzero : 0, tokenErr, xChan, wChan, step, floatCols };
}

export const DEFAULTS: Settings = { method: "tensor", bits: 8, alpha: 0.5, threshold: 6 };
