// Model for the fan-out tail figure. It holds no simulation: it replays the
// latency histograms recorded by content/systems/performance/
// tail-latency-fanout/ (64 redis-server processes, a Go client fanning GETs
// out to k of them) and computes, from the recorded per-leaf distribution,
// what the independence assumption predicts for the root: P(root <= t) =
// F(t)^k.

import data from "../../../../../../content/systems/performance/tail-latency-fanout/fanout-figure.json";

export interface Hist {
  counts: number[];
  n: number;
}

export interface Fanout {
  leaf: Hist;
  root: Hist;
}

export const MEASURED: number[] = Object.keys(data.fanouts)
  .map(Number)
  .sort((a, b) => a - b);

export const FANOUTS: Record<number, Fanout> = Object.fromEntries(
  MEASURED.map((k) => {
    const f = (data.fanouts as Record<string, { leaf: number[]; root: number[]; leafN: number; rootN: number }>)[String(k)];
    return [k, { leaf: { counts: f.leaf, n: f.leafN }, root: { counts: f.root, n: f.rootN } }];
  }),
);

export const BINS: number = data.bins;

/** Lower edge of bin i in microseconds (bin i spans edge(i) to edge(i + 1)). */
export function edge(i: number): number {
  return data.lo * 10 ** (i / data.perDecade);
}

/** Empirical CDF at t microseconds, log-linear within a bin. */
export function cdf(h: Hist, t: number): number {
  if (t <= edge(0)) return 0;
  if (t >= edge(BINS)) return 1;
  const pos = Math.log10(t / data.lo) * data.perDecade;
  const i = Math.min(BINS - 1, Math.floor(pos));
  let below = 0;
  for (let j = 0; j < i; j++) below += h.counts[j];
  return (below + h.counts[i] * (pos - i)) / h.n;
}

/** Quantile p (0..1) in microseconds, the inverse of cdf. */
export function quantile(h: Hist, p: number): number {
  const target = Math.min(1, Math.max(0, p)) * h.n;
  let cum = 0;
  for (let i = 0; i < BINS; i++) {
    const c = h.counts[i];
    if (c > 0 && cum + c >= target) {
      const f = (target - cum) / c;
      return data.lo * 10 ** ((i + f) / data.perDecade);
    }
    cum += c;
  }
  return edge(BINS);
}

/** Root CDF at t if the root waits for k independent leaves drawn from leaf. */
export function predictedCdf(leaf: Hist, k: number, t: number): number {
  return cdf(leaf, t) ** k;
}

/** Quantile p of the max of k independent leaf draws: leaf quantile p^(1/k). */
export function predictedQuantile(leaf: Hist, k: number, p: number): number {
  return quantile(leaf, p ** (1 / k));
}

export type Basis = "alone" | "loaded";

/** The leaf distribution a prediction uses: measured alone (k = 1), or measured at this fan-out. */
export function leafFor(k: number, basis: Basis): Hist {
  return basis === "loaded" && FANOUTS[k] ? FANOUTS[k].leaf : FANOUTS[1].leaf;
}

export interface Summary {
  k: number;
  basis: Basis;
  leafP99: number; // one leaf alone, p99 (us)
  pred: { p50: number; p99: number; slow: number };
  meas: { p50: number; p99: number; slow: number } | null;
}

/**
 * Median, p99, and share of root requests slower than one leaf's p99
 * (measured alone), predicted from the chosen leaf distribution and, where
 * fan-out k was measured, measured.
 */
export function summarize(k: number, basis: Basis): Summary {
  const b = FANOUTS[k] ? basis : "alone";
  const leaf = leafFor(k, b);
  const leafP99 = quantile(FANOUTS[1].leaf, 0.99);
  const f = FANOUTS[k];
  return {
    k,
    basis: b,
    leafP99,
    pred: {
      p50: predictedQuantile(leaf, k, 0.5),
      p99: predictedQuantile(leaf, k, 0.99),
      slow: 1 - predictedCdf(leaf, k, leafP99),
    },
    meas: f ? { p50: quantile(f.root, 0.5), p99: quantile(f.root, 0.99), slow: 1 - cdf(f.root, leafP99) } : null,
  };
}
