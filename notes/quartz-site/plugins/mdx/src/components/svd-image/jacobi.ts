// One-sided Jacobi SVD (Hestenes, 1958). Each step rotates a pair of columns
// so they become orthogonal; when every pair is orthogonal the column norms
// are the singular values, the normalized columns are U, and the accumulated
// rotations are V. It is slower than LAPACK's bidiagonalization methods but
// short, and it computes small singular values to high relative accuracy
// (Demmel and Veselić, 1992).

export interface Svd {
  m: number;
  n: number;
  /** m x n, column-major: column j is U[j*m .. j*m + m). */
  U: Float64Array;
  /** Descending. */
  s: Float64Array;
  /** n x n, column-major. */
  V: Float64Array;
  sweeps: number;
}

/**
 * SVD of a row-major m x n matrix with m >= n. `onSweep` runs after each sweep
 * and may return a promise, which lets a caller yield to the browser.
 */
export async function jacobiSvd(
  A: ArrayLike<number>,
  m: number,
  n: number,
  onSweep?: (sweep: number, rotations: number) => void | Promise<void>,
  maxSweeps = 40,
): Promise<Svd> {
  if (m < n) throw new Error("jacobiSvd needs m >= n");
  const W = new Float64Array(m * n);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) W[j * m + i] = A[i * n + j];
  const V = new Float64Array(n * n);
  for (let j = 0; j < n; j++) V[j * n + j] = 1;
  const tol = 1e-15;
  let sweep = 0;
  for (; sweep < maxSweeps; sweep++) {
    let rotations = 0;
    for (let p = 0; p < n - 1; p++) {
      const op = p * m;
      for (let q = p + 1; q < n; q++) {
        const oq = q * m;
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          const wp = W[op + i];
          const wq = W[oq + i];
          alpha += wp * wp;
          beta += wq * wq;
          gamma += wp * wq;
        }
        if (gamma === 0 || Math.abs(gamma) <= tol * Math.sqrt(alpha * beta)) continue;
        rotations++;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const wp = W[op + i];
          const wq = W[oq + i];
          W[op + i] = c * wp - s * wq;
          W[oq + i] = s * wp + c * wq;
        }
        const vp = p * n;
        const vq = q * n;
        for (let i = 0; i < n; i++) {
          const a = V[vp + i];
          const b = V[vq + i];
          V[vp + i] = c * a - s * b;
          V[vq + i] = s * a + c * b;
        }
      }
    }
    if (onSweep) await onSweep(sweep + 1, rotations);
    if (rotations === 0) {
      sweep++;
      break;
    }
  }
  const norms = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let acc = 0;
    for (let i = 0; i < m; i++) acc += W[j * m + i] ** 2;
    norms[j] = Math.sqrt(acc);
  }
  const order = Array.from({ length: n }, (_, j) => j).sort((a, b) => norms[b] - norms[a]);
  const U = new Float64Array(m * n);
  const Vs = new Float64Array(n * n);
  const s = new Float64Array(n);
  order.forEach((j, k) => {
    s[k] = norms[j];
    const inv = norms[j] > 0 ? 1 / norms[j] : 0;
    for (let i = 0; i < m; i++) U[k * m + i] = W[j * m + i] * inv;
    for (let i = 0; i < n; i++) Vs[k * n + i] = V[j * n + i];
  });
  return { m, n, U, s, V: Vs, sweeps: sweep };
}

/** Row-major rank-k reconstruction sum over l < k of s_l u_l v_l^T. */
export function reconstruct(f: Svd, k: number, out: Float64Array = new Float64Array(f.m * f.n)): Float64Array {
  out.fill(0);
  const { m, n, U, s, V } = f;
  for (let l = 0; l < k; l++) {
    const sl = s[l];
    const ul = l * m;
    const vl = l * n;
    for (let i = 0; i < m; i++) {
      const a = sl * U[ul + i];
      if (a === 0) continue;
      const row = i * n;
      for (let j = 0; j < n; j++) out[row + j] += a * V[vl + j];
    }
  }
  return out;
}

/** A deterministic shuffle (mulberry32 driving Fisher-Yates). */
export function shuffled(pixels: ArrayLike<number>, seed = 1): Float64Array {
  const out = Float64Array.from(pixels);
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
