// Least-squares solvers run in double precision on matrices of prescribed
// condition number, measured against a reference solution computed in
// double-double arithmetic (about 32 significant digits).
//
// Each problem is A = U diag(sigma) V^T (M x N, singular values log-spaced
// from 1 to 1/kappa) and b = A x + r with r orthogonal to col(A) and
// ||r|| = tan(theta) ||A x||. The three solvers are the ones the note compares:
//   normal  Cholesky on A^T A x = A^T b
//   qr      Householder QR, then back substitution on R x = (Q^T b)[0:N]
//   svd     one-sided Jacobi SVD, x = V diag(1/sigma) U^T b, with the
//           numpy.linalg.lstsq default cutoff sigma_i > eps max(M, N) sigma_1
// Nothing here touches the DOM, so the tests and the build share it.

import { mulberry32 } from "../../shared/random";

export const M = 60;
export const N = 8;
/** numpy.finfo(float).eps, used for the lstsq cutoff. */
export const EPS = 2 ** -52;
/** Unit roundoff (Trefethen and Bau's epsilon_machine), used for the guide lines. */
export const UNIT = 2 ** -53;
/** log10 kappa from 0 to 16 in half-decade steps. */
export const LOG_KAPPAS = Array.from({ length: 33 }, (_, k) => k / 2);
/** Random problems per condition number. */
export const SEEDS = 3;
/** Slider position that stands for tan(theta) = 0 (b in col(A)). */
export const TAN_ZERO = -13;

export interface Preset {
  id: string;
  /** log10 tan(theta), or TAN_ZERO for a consistent system. */
  logTan: number;
}

export const PRESETS: Preset[] = [
  { id: "small-residual", logTan: TAN_ZERO },
  { id: "large-residual", logTan: 0 },
];

export const presetById = (id: string | undefined): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];
export const tanOf = (logTan: number): number => (logTan <= TAN_ZERO ? 0 : 10 ** logTan);

// ---------------------------------------------------------------------------
// Double-double arithmetic: a value is hi + lo with |lo| <= ulp(hi) / 2.
// Error-free transformations from Dekker (1971) and Knuth; the operations
// follow the QD library of Hida, Li and Bailey.

export type DD = [number, number];
const SPLITTER = 134217729; // 2^27 + 1

function twoSum(a: number, b: number): DD {
  const s = a + b;
  const bb = s - a;
  return [s, a - (s - bb) + (b - bb)];
}

function quickTwoSum(a: number, b: number): DD {
  const s = a + b;
  return [s, b - (s - a)];
}

function split(a: number): DD {
  const t = SPLITTER * a;
  const hi = t - (t - a);
  return [hi, a - hi];
}

export function twoProd(a: number, b: number): DD {
  const p = a * b;
  const [ah, al] = split(a);
  const [bh, bl] = split(b);
  return [p, ah * bh - p + ah * bl + al * bh + al * bl];
}

export function ddAdd(a: DD, b: DD): DD {
  let [s, e] = twoSum(a[0], b[0]);
  const [t, f] = twoSum(a[1], b[1]);
  e += t;
  [s, e] = quickTwoSum(s, e);
  e += f;
  return quickTwoSum(s, e);
}

export const ddNeg = (a: DD): DD => [-a[0], -a[1]];
export const ddSub = (a: DD, b: DD): DD => ddAdd(a, ddNeg(b));

export function ddMul(a: DD, b: DD): DD {
  const [p, e] = twoProd(a[0], b[0]);
  return quickTwoSum(p, e + (a[0] * b[1] + a[1] * b[0]));
}

export function ddDiv(a: DD, b: DD): DD {
  const q1 = a[0] / b[0];
  let r = ddSub(a, ddMul(b, [q1, 0]));
  const q2 = r[0] / b[0];
  r = ddSub(r, ddMul(b, [q2, 0]));
  const q3 = r[0] / b[0];
  return ddAdd(quickTwoSum(q1, q2), [q3, 0]);
}

export function ddSqrt(a: DD): DD {
  if (a[0] <= 0) return [0, 0];
  const x = 1 / Math.sqrt(a[0]);
  const ax = a[0] * x;
  const diff = ddSub(a, twoProd(ax, ax))[0];
  return twoSum(ax, diff * x * 0.5);
}

// ---------------------------------------------------------------------------
// Problems. Matrices are row-major Float64Arrays.

function normals(rand: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** Orthonormal columns from modified Gram-Schmidt on a Gaussian matrix, run twice. */
function orthonormal(rows: number, cols: number, normal: () => number): Float64Array {
  const q = new Float64Array(rows * cols);
  for (let i = 0; i < q.length; i++) q[i] = normal();
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < cols; j++) {
      for (let k = 0; k < j; k++) {
        let dot = 0;
        for (let i = 0; i < rows; i++) dot += q[i * cols + j] * q[i * cols + k];
        for (let i = 0; i < rows; i++) q[i * cols + j] -= dot * q[i * cols + k];
      }
      let norm = 0;
      for (let i = 0; i < rows; i++) norm += q[i * cols + j] ** 2;
      norm = Math.sqrt(norm);
      for (let i = 0; i < rows; i++) q[i * cols + j] /= norm;
    }
  }
  return q;
}

export interface Problem {
  m: number;
  n: number;
  a: Float64Array;
  b: Float64Array;
}

export function singularValues(kappa: number, n = N): Float64Array {
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = n === 1 ? 1 : 10 ** (-(Math.log10(kappa) * i) / (n - 1));
  return s;
}

export function makeProblem(kappa: number, tan: number, seed: number, m = M, n = N): Problem {
  const normal = normals(mulberry32(seed));
  const u = orthonormal(m, n, normal);
  const v = orthonormal(n, n, normal);
  const sigma = singularValues(kappa, n);
  const a = new Float64Array(m * n);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += u[i * n + k] * sigma[k] * v[j * n + k];
      a[i * n + j] = s;
    }
  const c = Float64Array.from({ length: n }, normal);
  const cn = Math.hypot(...c);
  const x = new Float64Array(n);
  for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) x[j] += (v[j * n + k] * c[k]) / cn;
  const ax = matVec(a, x, m, n);
  const r = Float64Array.from({ length: m }, normal);
  for (let pass = 0; pass < 2; pass++)
    for (let k = 0; k < n; k++) {
      let dot = 0;
      for (let i = 0; i < m; i++) dot += u[i * n + k] * r[i];
      for (let i = 0; i < m; i++) r[i] -= dot * u[i * n + k];
    }
  const rn = Math.hypot(...r);
  const scale = (tan * Math.hypot(...ax)) / rn;
  const b = new Float64Array(m);
  for (let i = 0; i < m; i++) b[i] = ax[i] + scale * r[i];
  return { m, n, a, b };
}

export function matVec(a: Float64Array, x: ArrayLike<number>, m: number, n: number): Float64Array {
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += a[i * n + j] * x[j];
    y[i] = s;
  }
  return y;
}

// ---------------------------------------------------------------------------
// Solvers in double precision.

/** Normal equations by Cholesky; null when A^T A is not numerically positive definite. */
export function solveNormal({ a, b, m, n }: Problem): Float64Array | null {
  const g = new Float64Array(n * n);
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += a[k * n + i] * a[k * n + j];
      g[i * n + j] = s;
    }
    let s = 0;
    for (let k = 0; k < m; k++) s += a[k * n + i] * b[k];
    d[i] = s;
  }
  // G = L L^T, lower triangle in place.
  for (let j = 0; j < n; j++) {
    let s = g[j * n + j];
    for (let k = 0; k < j; k++) s -= g[j * n + k] ** 2;
    if (!(s > 0)) return null;
    const ljj = Math.sqrt(s);
    g[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let t = g[i * n + j];
      for (let k = 0; k < j; k++) t -= g[i * n + k] * g[j * n + k];
      g[i * n + j] = t / ljj;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = d[i];
    for (let k = 0; k < i; k++) s -= g[i * n + k] * y[k];
    y[i] = s / g[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= g[k * n + i] * x[k];
    x[i] = s / g[i * n + i];
  }
  return x;
}

/** Householder QR applied to [A b], then back substitution. */
export function solveQR({ a: a0, b: b0, m, n }: Problem): Float64Array {
  const a = Float64Array.from(a0);
  const b = Float64Array.from(b0);
  const v = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += a[i * n + k] ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = a[k * n + k] >= 0 ? -norm : norm;
    let vv = 0;
    for (let i = k; i < m; i++) {
      v[i] = a[i * n + k] - (i === k ? alpha : 0);
      vv += v[i] * v[i];
    }
    for (let j = k; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += v[i] * a[i * n + j];
      const f = (2 * s) / vv;
      for (let i = k; i < m; i++) a[i * n + j] -= f * v[i];
    }
    let s = 0;
    for (let i = k; i < m; i++) s += v[i] * b[i];
    const f = (2 * s) / vv;
    for (let i = k; i < m; i++) b[i] -= f * v[i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= a[i * n + k] * x[k];
    x[i] = s / a[i * n + i];
  }
  return x;
}

/** One-sided Jacobi SVD of A (Hestenes); returns sigma, U (m x n) and V (n x n). */
export function jacobiSVD(a0: Float64Array, m: number, n: number) {
  const w = Float64Array.from(a0);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          const wp = w[i * n + p];
          const wq = w[i * n + q];
          alpha += wp * wp;
          beta += wq * wq;
          gamma += wp * wq;
        }
        if (Math.abs(gamma) <= EPS * Math.sqrt(alpha * beta) || gamma === 0) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const wp = w[i * n + p];
          const wq = w[i * n + q];
          w[i * n + p] = c * wp - s * wq;
          w[i * n + q] = s * wp + c * wq;
        }
        for (let i = 0; i < n; i++) {
          const vp = v[i * n + p];
          const vq = v[i * n + q];
          v[i * n + p] = c * vp - s * vq;
          v[i * n + q] = s * vp + c * vq;
        }
      }
    if (!rotated) break;
  }
  const sigma = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += w[i * n + j] ** 2;
    sigma[j] = Math.sqrt(s);
    if (sigma[j] > 0) for (let i = 0; i < m; i++) w[i * n + j] /= sigma[j];
  }
  return { sigma, u: w, v };
}

/** Minimum-norm solution from the SVD, dropping sigma_i <= eps max(m, n) sigma_max like numpy.linalg.lstsq. */
export function solveSVD({ a, b, m, n }: Problem): Float64Array {
  const { sigma, u, v } = jacobiSVD(a, m, n);
  const cutoff = EPS * Math.max(m, n) * Math.max(...sigma);
  const x = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (!(sigma[k] > cutoff)) continue;
    let s = 0;
    for (let i = 0; i < m; i++) s += u[i * n + k] * b[i];
    s /= sigma[k];
    for (let j = 0; j < n; j++) x[j] += s * v[j * n + k];
  }
  return x;
}

// ---------------------------------------------------------------------------
// Reference: Householder QR in double-double on the stored A and b.

export function solveReference({ a: a0, b: b0, m, n }: Problem): DD[] {
  const a: DD[] = Array.from(a0, (t) => [t, 0] as DD);
  const b: DD[] = Array.from(b0, (t) => [t, 0] as DD);
  const v: DD[] = new Array(m).fill(null).map(() => [0, 0] as DD);
  for (let k = 0; k < n; k++) {
    let norm2: DD = [0, 0];
    for (let i = k; i < m; i++) norm2 = ddAdd(norm2, ddMul(a[i * n + k], a[i * n + k]));
    if (norm2[0] === 0) continue;
    const norm = ddSqrt(norm2);
    const alpha = a[k * n + k][0] >= 0 ? ddNeg(norm) : norm;
    let vv: DD = [0, 0];
    for (let i = k; i < m; i++) {
      v[i] = i === k ? ddSub(a[i * n + k], alpha) : a[i * n + k];
      vv = ddAdd(vv, ddMul(v[i], v[i]));
    }
    const reflect = (get: (i: number) => DD, set: (i: number, t: DD) => void) => {
      let s: DD = [0, 0];
      for (let i = k; i < m; i++) s = ddAdd(s, ddMul(v[i], get(i)));
      const f = ddDiv(ddMul([2, 0], s), vv);
      for (let i = k; i < m; i++) set(i, ddSub(get(i), ddMul(f, v[i])));
    };
    for (let j = k; j < n; j++)
      reflect(
        (i) => a[i * n + j],
        (i, t) => (a[i * n + j] = t),
      );
    reflect(
      (i) => b[i],
      (i, t) => (b[i] = t),
    );
  }
  const x: DD[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s = ddSub(s, ddMul(a[i * n + k], x[k]));
    x[i] = ddDiv(s, a[i * n + i]);
  }
  return x;
}

/** ||xhat - xref|| / ||xref||, with the difference taken in double-double. Null for a failed solve. */
export function relativeError(xhat: Float64Array | null, xref: DD[]): number | null {
  if (!xhat || !xhat.every(Number.isFinite)) return null;
  let num = 0;
  let den = 0;
  for (let j = 0; j < xref.length; j++) {
    const d = ddSub([xhat[j], 0], xref[j]);
    num += (d[0] + d[1]) ** 2;
    den += (xref[j][0] + xref[j][1]) ** 2;
  }
  return Math.sqrt(num / den);
}

// ---------------------------------------------------------------------------
// The sweep the figure plots.

export type Method = "normal" | "qr" | "svd";
export const METHODS: Method[] = ["normal", "qr", "svd"];

export interface Point {
  logKappa: number;
  seed: number;
  err: Record<Method, number | null>;
}

export const problemSeed = (base: number, k: number, s: number): number => base * 1009 + k * SEEDS + s + 1;

export function sweep(logTan: number, base = 0): Point[] {
  const tan = tanOf(logTan);
  const out: Point[] = [];
  LOG_KAPPAS.forEach((lk, k) => {
    for (let s = 0; s < SEEDS; s++) {
      const p = makeProblem(10 ** lk, tan, problemSeed(base, k, s));
      const ref = solveReference(p);
      out.push({
        logKappa: lk,
        seed: s,
        err: {
          normal: relativeError(solveNormal(p), ref),
          qr: relativeError(solveQR(p), ref),
          svd: relativeError(solveSVD(p), ref),
        },
      });
    }
  });
  return out;
}

/** Median over seeds at each condition number; a failed solve counts as an error of +infinity. */
export function medians(points: Point[], method: Method): { logKappa: number; err: number }[] {
  return LOG_KAPPAS.map((lk) => {
    const errs = points
      .filter((p) => p.logKappa === lk)
      .map((p) => p.err[method] ?? Infinity)
      .sort((x, y) => x - y);
    return { logKappa: lk, err: errs[Math.floor(errs.length / 2)] };
  });
}
