// The diffusion figure's arithmetic, free of the DOM: the noise schedules, the
// noise-prediction network, and the sampler. It mirrors diffusion2d.py, the
// NumPy harness that trained the weights, line for line, and the tests check
// it against that harness's outputs.

import { mulberry32 } from "../../shared/random";

export const T = 1000;

/** alpha-bar for paper timesteps 1..T, stored at index t - 1 (DDPM's linear schedule). */
export function linearAlphaBars(betaStart = 1e-4, betaEnd = 0.02, steps = T): Float64Array {
  const ab = new Float64Array(steps);
  let prod = 1;
  for (let i = 0; i < steps; i++) {
    const beta = betaStart + ((betaEnd - betaStart) * i) / (steps - 1);
    prod *= 1 - beta;
    ab[i] = prod;
  }
  return ab;
}

/** Nichol and Dhariwal (2021), eq. 17, s = 0.008, betas clipped at 0.999. */
export function cosineAlphaBars(steps = T, s = 0.008): Float64Array {
  const f = (t: number) => Math.cos(((t / steps + s) / (1 + s)) * (Math.PI / 2)) ** 2;
  const ab = new Float64Array(steps);
  let prod = 1;
  for (let t = 1; t <= steps; t++) {
    const beta = Math.min(Math.max(1 - f(t) / f(t - 1), 0), 0.999);
    prod *= 1 - beta;
    ab[t - 1] = prod;
  }
  return ab;
}

export type ScheduleName = "linear" | "cosine";
export const schedule = (name: ScheduleName): Float64Array => (name === "cosine" ? cosineAlphaBars() : linearAlphaBars());

/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** k timestep indices (0-based, T - 1 down to 0), evenly spaced, as numpy.linspace does it. */
export function timesteps(k: number): number[] {
  if (k <= 1) return [T - 1];
  const step = (0 - (T - 1)) / (k - 1);
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(roundHalfEven(i === k - 1 ? 0 : T - 1 + i * step));
  return out;
}

// ---------------------------------------------------------------------------
// The network: eps_theta(x_t, t) = MLP([x_t, sin/cos embedding of t]), SiLU.

export interface Weights {
  T: number;
  freqs: number;
  shapes: number[][];
  /** Little-endian float16, base64. */
  weights: string[];
}

export interface Net {
  freqs: number;
  /** Weight matrices, row-major [in][out], and biases. */
  W: Float64Array[];
  b: Float64Array[];
  sizes: number[];
}

function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

function base64Bytes(text: string): Uint8Array {
  if (typeof atob === "function") {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array((globalThis as any).Buffer.from(text, "base64"));
}

export function decodeHalf(text: string): Float64Array {
  const bytes = base64Bytes(text);
  const out = new Float64Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = halfToFloat(bytes[2 * i] | (bytes[2 * i + 1] << 8));
  return out;
}

export function loadNet(w: Weights): Net {
  const W: Float64Array[] = [];
  const b: Float64Array[] = [];
  const sizes = [w.shapes[0][0]];
  for (let i = 0; i < w.weights.length; i += 2) {
    W.push(decodeHalf(w.weights[i]));
    b.push(decodeHalf(w.weights[i + 1]));
    sizes.push(w.shapes[i][1]);
  }
  return { freqs: w.freqs, W, b, sizes };
}

/** Predicted noise for n points at one timestep index. x and the result are [x0, y0, x1, y1, ...]. */
export function predictNoise(net: Net, x: Float64Array, t: number, n = x.length / 2): Float64Array {
  const width = Math.max(...net.sizes);
  const bufA = new Float64Array(width);
  const bufB = new Float64Array(width);
  const emb = new Float64Array(2 * net.freqs);
  for (let j = 0; j < net.freqs; j++) {
    const arg = t * Math.exp((-Math.log(10000) * j) / net.freqs);
    emb[j] = Math.sin(arg);
    emb[net.freqs + j] = Math.cos(arg);
  }
  // The embedding is the same for every point at this step, so its share of
  // the first layer is computed once: first[o] = b[o] + sum_j emb[j] W[2 + j][o].
  const n1 = net.sizes[1];
  const W0 = net.W[0];
  const first = Float64Array.from(net.b[0]);
  for (let j = 0; j < emb.length; j++) {
    const row = (2 + j) * n1;
    for (let o = 0; o < n1; o++) first[o] += emb[j] * W0[row + o];
  }
  const out = new Float64Array(2 * n);
  const layers = net.W.length;
  for (let p = 0; p < n; p++) {
    let src = bufA;
    let dst = bufB;
    const px = x[2 * p];
    const py = x[2 * p + 1];
    for (let o = 0; o < n1; o++) src[o] = first[o] + px * W0[o] + py * W0[n1 + o];
    for (let l = 0; l < layers; l++) {
      if (l > 0) {
        const nin = net.sizes[l];
        const nout = net.sizes[l + 1];
        const Wl = net.W[l];
        const bl = net.b[l];
        for (let o = 0; o < nout; o++) dst[o] = bl[o];
        for (let i = 0; i < nin; i++) {
          const v = src[i];
          const row = i * nout;
          for (let o = 0; o < nout; o++) dst[o] += v * Wl[row + o];
        }
        const tmp = src;
        src = dst;
        dst = tmp;
      }
      // src now holds layer l's pre-activations
      if (l < layers - 1) {
        const nout = net.sizes[l + 1];
        for (let o = 0; o < nout; o++) src[o] = src[o] * (0.5 * (1 + Math.tanh(0.5 * src[o]))); // SiLU
      } else {
        out[2 * p] = src[0];
        out[2 * p + 1] = src[1];
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Forward process: x_t = sqrt(ab_t) x0 + sqrt(1 - ab_t) eps, in closed form.

/** Paper timestep t in 0..T; t = 0 is the clean data. */
export function noised(points: number[][], eps: Float64Array, ab: Float64Array, t: number): Float64Array {
  const a = t === 0 ? 1 : ab[t - 1];
  const s = Math.sqrt(a);
  const r = Math.sqrt(1 - a);
  const out = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[2 * i] = s * points[i][0] + r * eps[2 * i];
    out[2 * i + 1] = s * points[i][1] + r * eps[2 * i + 1];
  }
  return out;
}

/** n * 2 standard normal draws from a seeded generator (Box-Muller). */
export function gaussians(count: number, seed: number): Float64Array {
  const random = mulberry32(seed);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 2) {
    const u = 1 - random();
    const v = random();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < count) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reverse process: Song et al. (2020), eq. 12. eta = 1 is ancestral DDPM on the
// respaced schedule; eta = 0 is deterministic DDIM. "beta" keeps the DDPM mean
// but adds noise with the larger variance sigma^2 = beta (DDIM's sigma-hat).

export type Eta = number | "beta";

export interface Trajectory {
  /** Timestep index of each step, T - 1 down to 0. */
  ts: number[];
  /** states[0] = x_T, states[i + 1] = after step i. */
  states: Float64Array[];
  /** The network's x0 prediction at step i. */
  x0: Float64Array[];
}

export interface Sampler {
  trajectory: Trajectory;
  /** Runs the next step; returns false once finished. */
  step(): boolean;
  done(): boolean;
}

export function sampler(
  net: Net,
  start: Float64Array,
  k: number,
  eta: Eta,
  ab: Float64Array,
  noise: (step: number, count: number) => Float64Array,
): Sampler {
  const ts = timesteps(k);
  const n = start.length / 2;
  const trajectory: Trajectory = { ts, states: [Float64Array.from(start)], x0: [] };
  let i = 0;
  return {
    trajectory,
    done: () => i >= ts.length,
    step() {
      if (i >= ts.length) return false;
      const t = ts[i];
      const abT = ab[t];
      const abPrev = i + 1 < ts.length ? ab[ts[i + 1]] : 1;
      const x = trajectory.states[i];
      const eps = predictNoise(net, x, t, n);
      const tilde = Math.sqrt(((1 - abPrev) / (1 - abT)) * (1 - abT / abPrev));
      const last = i + 1 >= ts.length;
      const sigma = eta === "beta" ? (last ? 0 : Math.sqrt(1 - abT / abPrev)) : eta * tilde;
      const meanSigma = eta === "beta" ? tilde : sigma;
      const dir = Math.sqrt(Math.max(1 - abPrev - meanSigma * meanSigma, 0));
      const z = sigma > 0 ? noise(i, 2 * n) : null;
      const x0 = new Float64Array(2 * n);
      const nextX = new Float64Array(2 * n);
      const sa = Math.sqrt(abT);
      const sr = Math.sqrt(1 - abT);
      const sp = Math.sqrt(abPrev);
      for (let j = 0; j < 2 * n; j++) {
        x0[j] = (x[j] - sr * eps[j]) / sa;
        nextX[j] = sp * x0[j] + dir * eps[j] + (z ? sigma * z[j] : 0);
      }
      trajectory.x0.push(x0);
      trajectory.states.push(nextX);
      i += 1;
      return i < ts.length;
    },
  };
}
