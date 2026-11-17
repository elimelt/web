// Heartbeat failure detectors replayed over a recorded trace of heartbeat
// arrival times. No DOM access, so the tests, the build and the browser all
// run this file.
//
// Three detectors, each reduced to the timeout it sets after every heartbeat:
//   timeout    a fixed timeout, the same after every heartbeat;
//   phiNormal  the phi accrual detector of Hayashibara et al. (2004), with
//              inter-arrival times modelled as normal (mean and standard
//              deviation of the last `window` intervals), as in Akka;
//   phiExp     the phi accrual detector with inter-arrival times modelled as
//              exponential (only the mean is used), as in Cassandra.
// phi(t) = -log10 P(next interval > t), where t is the time since the last
// heartbeat arrived. The detector suspects when phi exceeds the threshold, so
// a threshold is equivalent to a timeout tau: the t at which phi reaches it.

export type Kind = "timeout" | "phiNormal" | "phiExp";

export const KINDS: Kind[] = ["phiNormal", "phiExp", "timeout"];

export interface Options {
  /** Number of past inter-arrival intervals the phi detectors keep. */
  window: number;
  /** Lower bound on the normal model's standard deviation, in ms (Akka's min-std-deviation). */
  minStd: number;
}

export const DEFAULTS: Options = { window: 1000, minStd: 0 };

const LN10 = Math.LN10;

/**
 * ln Q(x), where Q(x) = P(Z > x) for a standard normal Z, computed in log
 * space so that it stays finite far into the tail. erfc follows the Chebyshev
 * fit of Numerical Recipes (erfcc, fractional error below 1.2e-7 everywhere).
 */
export function lnQ(x: number): number {
  const z = x / Math.SQRT2;
  const a = Math.abs(z);
  const t = 1 / (1 + 0.5 * a);
  const poly =
    -1.26551223 +
    t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const lnErfcAbs = Math.log(t) - a * a + poly; // ln erfc(|z|)
  if (z >= 0) return lnErfcAbs - Math.LN2;
  // erfc(-a) = 2 - erfc(a)
  return Math.log(1 - 0.5 * Math.exp(lnErfcAbs));
}

/** phi for a normal model: -log10 P(X > t), X ~ N(mean, sd^2). */
export function phiNormal(t: number, mean: number, sd: number): number {
  return -lnQ((t - mean) / sd) / LN10;
}

/** phi for an exponential model with the given mean: t / (mean ln 10). */
export function phiExp(t: number, mean: number): number {
  return t / (mean * LN10);
}

/** z such that -log10 Q(z) = phi, by bisection on the monotone phiNormal. */
export function zForPhi(phi: number): number {
  let lo = -10;
  let hi = 60;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (-lnQ(mid) / LN10 < phi) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Trace {
  /** Heartbeat arrival times in ms, increasing. */
  arrivals: Float64Array;
}

/**
 * Sliding-window statistics of the inter-arrival intervals. Entry k (for
 * heartbeat k, k >= 1) holds the mean and standard deviation of the intervals
 * ending at heartbeats max(1, k - window + 1) .. k, i.e. what the detector
 * knows right after heartbeat k arrives.
 */
export interface WindowStats {
  mean: Float64Array;
  sd: Float64Array;
}

export function windowStats(arrivals: Float64Array, window: number): WindowStats {
  const n = arrivals.length;
  const mean = new Float64Array(n);
  const sd = new Float64Array(n);
  // Accumulate deviations from a fixed offset for numerical stability.
  const off = n > 1 ? arrivals[1] - arrivals[0] : 0;
  let s = 0;
  let s2 = 0;
  let count = 0;
  for (let k = 1; k < n; k++) {
    const d = arrivals[k] - arrivals[k - 1] - off;
    s += d;
    s2 += d * d;
    count++;
    if (count > window) {
      const old = arrivals[k - window] - arrivals[k - window - 1] - off;
      s -= old;
      s2 -= old * old;
      count--;
    }
    const m = s / count;
    mean[k] = m + off;
    sd[k] = Math.sqrt(Math.max(0, s2 / count - m * m));
  }
  return { mean, sd };
}

/** Index of the first heartbeat after which the detectors are judged (the window must be full). */
export function warmup(n: number, window: number): number {
  return Math.min(window, Math.max(1, n - 2));
}

/**
 * The timeout tau_k (ms after heartbeat k arrives) each detector sets after
 * heartbeat k, for k = start .. n - 2, at the given threshold. For "timeout"
 * the threshold is itself the timeout in ms.
 */
export function timeouts(kind: Kind, threshold: number, stats: WindowStats, start: number, minStd = 0): Float64Array {
  const n = stats.mean.length;
  const out = new Float64Array(Math.max(0, n - 1 - start));
  if (kind === "timeout") {
    out.fill(threshold);
  } else if (kind === "phiExp") {
    const f = threshold * LN10;
    for (let k = start; k < n - 1; k++) out[k - start] = stats.mean[k] * f;
  } else {
    const z = zForPhi(threshold);
    for (let k = start; k < n - 1; k++) out[k - start] = stats.mean[k] + Math.max(stats.sd[k], minStd) * z;
  }
  return out;
}

export interface Quality {
  /** Mean timeout after a heartbeat, ms: the detection time for a crash just after that heartbeat was sent, less its one-way delay. */
  detection: number;
  /** Number of wrong suspicions in the replayed trace. */
  mistakes: number;
  /** Wrong suspicions per hour of trace. */
  mistakesPerHour: number;
  /** Fraction of time the monitored process, which never crashed, was trusted (Chen et al.'s query accuracy probability). */
  accuracy: number;
  /** Mean length of a wrong suspicion, ms (0 if none). */
  mistakeDuration: number;
}

/**
 * Chen, Toueg and Aguilera's QoS metrics for one detector over a trace in
 * which the monitored process never crashed: every suspicion is a mistake.
 * A mistake happens after heartbeat k when the next heartbeat arrives later
 * than tau_k; it lasts until that heartbeat arrives.
 */
export function quality(arrivals: Float64Array, tau: Float64Array, start: number): Quality {
  const n = arrivals.length;
  let mistakes = 0;
  let wrong = 0;
  let sumTau = 0;
  for (let k = start; k < n - 1; k++) {
    const d = arrivals[k + 1] - arrivals[k];
    const t = tau[k - start];
    sumTau += t;
    if (d > t) {
      mistakes++;
      wrong += d - t;
    }
  }
  const m = Math.max(1, n - 1 - start);
  const span = arrivals[n - 1] - arrivals[start];
  return {
    detection: sumTau / m,
    mistakes,
    mistakesPerHour: span > 0 ? (mistakes / span) * 3.6e6 : 0,
    accuracy: span > 0 ? 1 - wrong / span : 1,
    mistakeDuration: mistakes ? wrong / mistakes : 0,
  };
}

/** Threshold grids for the trade-off curves. */
export function grid(kind: Kind, period: number): number[] {
  const out: number[] = [];
  if (kind === "timeout") {
    for (let e = 0; e <= 60; e++) out.push(period * 10 ** (e / 30) * 1.0); // 1x to 100x the period
  } else if (kind === "phiExp") {
    for (let e = 0; e <= 60; e++) out.push(0.5 * 10 ** (e / 30)); // 0.5 to 50
  } else {
    for (let e = 0; e <= 60; e++) out.push(0.5 * 10 ** (e / 30));
  }
  return out;
}

export interface CurvePoint {
  threshold: number;
  q: Quality;
}

export function curve(kind: Kind, arrivals: Float64Array, stats: WindowStats, start: number, thresholds: number[], minStd = 0): CurvePoint[] {
  return thresholds.map((threshold) => ({ threshold, q: quality(arrivals, timeouts(kind, threshold, stats, start, minStd), start) }));
}

/** phi (or, for "timeout", elapsed/timeout scaled to the threshold) at time t ms after heartbeat k. */
export function level(kind: Kind, t: number, stats: WindowStats, k: number, minStd = 0): number {
  if (kind === "phiExp") return phiExp(t, stats.mean[k]);
  if (kind === "phiNormal") return phiNormal(t, stats.mean[k], Math.max(stats.sd[k], minStd));
  return t;
}

/** Decodes the figure's trace: base64 of little-endian uint16 inter-arrival times in units of `unit` ms. */
export function decodeIntervals(b64: string, unit: number, t0 = 0): Float64Array {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const m = bin.length >> 1;
  const out = new Float64Array(m + 1);
  out[0] = t0;
  for (let i = 0; i < m; i++) out[i + 1] = out[i] + (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) * unit;
  return out;
}
