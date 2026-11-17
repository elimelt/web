// Least-squares fits of Amdahl's law and the Universal Scalability Law to a
// throughput curve, as in Gunther's method and the R usl package:
//
//   X(N) = gamma * N / (1 + sigma (N - 1) + kappa N (N - 1))
//
// gamma is the fitted single-unit throughput, sigma the contention (serial)
// fraction and kappa the coherency coefficient. Amdahl's law is the case
// kappa = 0, where sigma = 1 - p. For fixed (sigma, kappa) the best gamma is a
// linear least-squares solution, so the search runs over (sigma, kappa) only
// (variable projection) with a damped Gauss-Newton (Levenberg-Marquardt) step.
// No DOM access: the tests and the build run this in Node.

export interface Fit {
  gamma: number;
  sigma: number;
  kappa: number;
  sse: number;
}

export const shape = (n: number, sigma: number, kappa: number): number =>
  n / (1 + sigma * (n - 1) + kappa * n * (n - 1));

/** Best gamma for fixed sigma, kappa, and the residual sum of squares. */
export function profile(ns: number[], xs: number[], sigma: number, kappa: number): { gamma: number; sse: number } {
  let gg = 0;
  let gx = 0;
  for (let i = 0; i < ns.length; i++) {
    const g = shape(ns[i], sigma, kappa);
    gg += g * g;
    gx += g * xs[i];
  }
  const gamma = gg > 0 ? gx / gg : 0;
  let sse = 0;
  for (let i = 0; i < ns.length; i++) {
    const r = gamma * shape(ns[i], sigma, kappa) - xs[i];
    sse += r * r;
  }
  return { gamma, sse };
}

const SIGMA_MIN = -0.5;
const SIGMA_MAX = 1;

/**
 * Fits the USL (withKappa) or Amdahl's law (kappa fixed at 0). sigma is kept
 * in [-0.5, 1] (a negative value is superlinear scaling) and kappa >= 0, as in
 * the usl package except that kappa has no upper bound.
 */
export function fit(ns: number[], xs: number[], withKappa = true): Fit {
  // Residuals as a function of the free parameters q = [sigma, kappa*1e4].
  const K = 1e4; // scales kappa so both parameters are of order 1e-2..1
  const clampQ = (q: number[]) => [Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, q[0])), withKappa ? Math.max(0, q[1]) : 0];
  const resid = (q: number[]) => {
    const { gamma } = profile(ns, xs, q[0], q[1] / K);
    return ns.map((n, i) => gamma * shape(n, q[0], q[1] / K) - xs[i]);
  };
  const sseOf = (q: number[]) => profile(ns, xs, q[0], q[1] / K).sse;
  const dim = withKappa ? 2 : 1;
  // Start from the best of a coarse grid, so the local search starts in the right basin.
  let q = [0, 0];
  let best = Infinity;
  for (const s of [-0.2, -0.05, 0, 0.005, 0.02, 0.05, 0.1, 0.2, 0.4, 0.7]) {
    for (const k of withKappa ? [0, 0.01, 0.1, 1, 10, 100, 1000, 1e4, 1e5] : [0]) {
      const v = sseOf([s, k]);
      if (v < best) {
        best = v;
        q = [s, k];
      }
    }
  }
  let lambda = 1e-3;
  for (let it = 0; it < 400; it++) {
    const r = resid(q);
    // forward-difference Jacobian
    const J: number[][] = r.map(() => [0, 0]);
    for (let j = 0; j < dim; j++) {
      const h = 1e-7 * Math.max(1, Math.abs(q[j]));
      const qh = [...q];
      qh[j] += h;
      const rh = resid(qh);
      for (let i = 0; i < r.length; i++) J[i][j] = (rh[i] - r[i]) / h;
    }
    const A = [
      [0, 0],
      [0, 0],
    ];
    const g = [0, 0];
    for (let i = 0; i < r.length; i++) {
      for (let a = 0; a < dim; a++) {
        g[a] += J[i][a] * r[i];
        for (let b = 0; b < dim; b++) A[a][b] += J[i][a] * J[i][b];
      }
    }
    let improved = false;
    for (let tries = 0; tries < 30; tries++) {
      const M = A.map((row, a) => row.map((v, b) => v + (a === b ? lambda * (A[a][a] || 1) : 0)));
      let step: number[];
      if (dim === 1) step = [-g[0] / M[0][0], 0];
      else {
        const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
        step = [-(M[1][1] * g[0] - M[0][1] * g[1]) / det, -(M[0][0] * g[1] - M[1][0] * g[0]) / det];
      }
      const qn = clampQ([q[0] + step[0], q[1] + step[1]]);
      const vn = sseOf(qn);
      if (Number.isFinite(vn) && vn < best) {
        const rel = (best - vn) / Math.max(best, 1e-300);
        q = qn;
        best = vn;
        lambda = Math.max(lambda / 3, 1e-12);
        improved = true;
        if (rel < 1e-14) it = 1e9;
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
  }
  // Coordinate-wise golden-section polish: Levenberg-Marquardt with clamping
  // converges slowly when a parameter sits on its bound (sigma = 1).
  const lo = [SIGMA_MIN, 0];
  const hi = [SIGMA_MAX, Infinity];
  for (let round = 0; round < 4; round++) {
    for (let j = 0; j < dim; j++) {
      const w = 0.2 * Math.abs(q[j]) + 1e-6;
      let a = Math.max(lo[j], q[j] - w);
      let b = Math.min(hi[j], q[j] + w);
      const at = (v: number) => sseOf(j === 0 ? [v, q[1]] : [q[0], v]);
      const g = (Math.sqrt(5) - 1) / 2;
      let c = b - g * (b - a);
      let d = a + g * (b - a);
      let fc = at(c);
      let fd = at(d);
      for (let it = 0; it < 80; it++) {
        if (fc < fd) {
          b = d;
          d = c;
          fd = fc;
          c = b - g * (b - a);
          fc = at(c);
        } else {
          a = c;
          c = d;
          fc = fd;
          d = a + g * (b - a);
          fd = at(d);
        }
      }
      const v = (a + b) / 2;
      if (at(v) < best) {
        q = j === 0 ? [v, q[1]] : [q[0], v];
        best = at(v);
      }
    }
  }
  const { gamma, sse } = profile(ns, xs, q[0], q[1] / K);
  return { gamma, sigma: q[0], kappa: q[1] / K, sse };
}

/** Karp-Flatt experimentally determined serial fraction from a speedup S at N > 1. */
export const karpFlatt = (s: number, n: number): number => (1 / s - 1 / n) / (1 - 1 / n);

/** Processor count of maximum USL throughput, or Infinity when kappa is 0. */
export const nPeak = (sigma: number, kappa: number): number => (kappa > 0 ? Math.max(1, Math.sqrt((1 - sigma) / kappa)) : Infinity);

/** One recorded scaling curve: every run at every N, as throughput. */
export interface Dataset {
  key: string;
  label: string;
  unit: string; // what the throughput counts, e.g. "runs/s"
  xLabel: string; // "threads", "processors", "simulated users"
  source: string;
  n: number[]; // one entry per run
  x: number[]; // throughput of that run
  extrapolate: number; // right edge of the chart
}

/** Median throughput per distinct N, in increasing N. */
export function medians(d: Dataset): { n: number; x: number; lo: number; hi: number }[] {
  const by = new Map<number, number[]>();
  d.n.forEach((n, i) => by.set(n, [...(by.get(n) ?? []), d.x[i]]));
  return [...by.keys()]
    .sort((a, b) => a - b)
    .map((n) => {
      const v = [...(by.get(n) as number[])].sort((a, b) => a - b);
      const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      return { n, x: m, lo: v[0], hi: v[v.length - 1] };
    });
}

/** Fits both models to the runs whose N is at most nMax. */
export function fitUpTo(d: Dataset, nMax: number): { amdahl: Fit; usl: Fit; used: number } {
  const ns: number[] = [];
  const xs: number[] = [];
  d.n.forEach((n, i) => {
    if (n <= nMax) {
      ns.push(n);
      xs.push(d.x[i]);
    }
  });
  return { amdahl: fit(ns, xs, false), usl: fit(ns, xs, true), used: new Set(ns).size };
}
