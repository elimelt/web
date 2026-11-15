// Power iteration on a symmetric matrix whose spectrum the reader sets through
// one number, the ratio r = |lambda_2 / lambda_1|. The figure runs the real
// algorithm, x <- A x / |A x|, on a dense N x N matrix A = Q diag(lambda) Q^T,
// and measures the angle between x and the true top eigenvector q_1 at every
// step. Nothing here touches the DOM, so the tests and the build share it.

import { mulberry32 } from "../../shared/random";

export const N = 40;
export const TOL = 1e-8;
/** Seeds the eigenvectors and the starting vector; fixed so only r changes. */
export const SEED = 2;
/** Errors are drawn down to this floor; double precision stops near 1e-16. */
export const FLOOR = 1e-16;

export interface Preset {
  id: string;
  ratio: number;
  steps: number;
  /** Also plot the eigenvalue error of the Rayleigh quotient. */
  rayleigh: boolean;
}

export const PRESETS: Preset[] = [
  { id: "gap", ratio: 0.5, steps: 60, rayleigh: false },
  { id: "narrow", ratio: 0.95, steps: 500, rayleigh: false },
  { id: "rayleigh", ratio: 0.8, steps: 120, rayleigh: true },
];

export const presetById = (id: string | undefined): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** A random orthogonal matrix (row-major, n x n) from Gram-Schmidt on a seeded Gaussian-ish matrix. */
export function orthogonal(n: number, seed: number): Float64Array {
  const rand = mulberry32(seed);
  // Box-Muller normals, so the columns are uniformly oriented.
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const q = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) q[i] = normal();
  // Modified Gram-Schmidt on the columns, twice for orthogonality to rounding.
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < j; k++) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += q[i * n + j] * q[i * n + k];
        for (let i = 0; i < n; i++) q[i * n + j] -= dot * q[i * n + k];
      }
      let norm = 0;
      for (let i = 0; i < n; i++) norm += q[i * n + j] ** 2;
      norm = Math.sqrt(norm);
      for (let i = 0; i < n; i++) q[i * n + j] /= norm;
    }
  }
  return q;
}

/**
 * The eigenvalues: lambda_1 = 1, lambda_2 = r, and the other N - 2 spread
 * evenly over [-0.8 r, 0.8 r], so r alone sets the gap.
 */
export function spectrum(ratio: number, n = N): Float64Array {
  const lam = new Float64Array(n);
  lam[0] = 1;
  lam[1] = ratio;
  for (let i = 2; i < n; i++) lam[i] = 0.8 * ratio * (1 - (2 * (i - 2)) / (n - 3));
  return lam;
}

/** A = Q diag(lam) Q^T, row-major. */
export function compose(q: Float64Array, lam: Float64Array): Float64Array {
  const n = lam.length;
  const a = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += q[i * n + k] * lam[k] * q[j * n + k];
      a[i * n + j] = s;
      a[j * n + i] = s;
    }
  }
  return a;
}

/** A fixed starting vector, the same for every ratio so only r changes. */
export function startVector(n: number, seed: number): Float64Array {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = rand() * 2 - 1;
  return x;
}

export interface Run {
  ratio: number;
  /** sin of the angle between x_k and q_1, for k = 0..steps. */
  vector: number[];
  /** |rho_k - lambda_1| / |lambda_1| with rho_k = x_k^T A x_k. */
  value: number[];
  /** tan(theta_0) r^k, the textbook bound on tan(theta_k). */
  bound: number[];
  /** First k with vector[k] <= TOL, or null. */
  stepsVector: number | null;
  stepsValue: number | null;
  /** Smallest k with tan(theta_0) r^k <= TOL, or null when r = 1. */
  stepsBound: number | null;
  /** Measured per-step factor, geometric mean over the steps where the error sits between 1e-12 and 1e-3. */
  rate: number | null;
}

const sinToLine = (x: Float64Array, q: Float64Array, col: number, n: number): number => {
  // |x - (x . q1) q1| for unit x and unit q1, accurate for tiny angles.
  let dot = 0;
  for (let i = 0; i < n; i++) dot += x[i] * q[i * n + col];
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - dot * q[i * n + col]) ** 2;
  return Math.sqrt(s);
};

export function measuredRate(errors: number[], lo = 1e-12, hi = 1e-3): number | null {
  let a = -1;
  let b = -1;
  for (let k = 0; k < errors.length; k++) {
    if (errors[k] <= hi && errors[k] >= lo) {
      if (a < 0) a = k;
      b = k;
    }
  }
  if (a < 0 || b - a < 2) return null;
  return (errors[b] / errors[a]) ** (1 / (b - a));
}

/** Runs power iteration for `steps` steps on the matrix with the given ratio. */
export function run(ratio: number, steps: number, seed = SEED, n = N, q: Float64Array = orthogonal(n, seed)): Run {
  const lam = spectrum(ratio, n);
  const a = compose(q, lam);
  let x = startVector(n, seed);
  let norm = Math.hypot(...x);
  x = x.map((v) => v / norm);
  const vector: number[] = [];
  const value: number[] = [];
  const y = new Float64Array(n);
  for (let k = 0; k <= steps; k++) {
    vector.push(Math.max(FLOOR, sinToLine(x, q, 0, n)));
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += a[i * n + j] * x[j];
      y[i] = s;
    }
    let rho = 0;
    for (let i = 0; i < n; i++) rho += x[i] * y[i];
    value.push(Math.max(FLOOR, Math.abs(rho - lam[0]) / Math.abs(lam[0])));
    norm = 0;
    for (let i = 0; i < n; i++) norm += y[i] * y[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < n; i++) x[i] = y[i] / norm;
  }
  const s0 = vector[0];
  const tan0 = s0 / Math.sqrt(Math.max(1e-300, 1 - s0 * s0));
  const bound = vector.map((_, k) => Math.max(FLOOR, tan0 * ratio ** k));
  const first = (xs: number[]) => {
    const k = xs.findIndex((e) => e <= TOL);
    return k < 0 ? null : k;
  };
  const stepsBound = ratio < 1 ? Math.max(0, Math.ceil(Math.log(TOL / tan0) / Math.log(ratio))) : null;
  return {
    ratio,
    vector,
    value,
    bound,
    stepsVector: first(vector),
    stepsValue: first(value),
    stepsBound,
    rate: measuredRate(vector),
  };
}
