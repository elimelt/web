// A simulation of k independent pointer chases sharing C miss buffers (the
// L1D fill buffers on Intel cores). Each chain issues its next load the
// moment its previous load returns; a load that finds every buffer busy waits
// in a FIFO queue until one frees. Every miss takes the same latency L unless
// a latency function is passed (the tests use one).
//
// This is a closed queueing network with zero think time, so the steady-state
// time per access is L / min(k, C), and by Little's law the time-average number
// of misses in flight is min(k, C). The tests check the simulation against
// that closed form and against an independent Python simulator.

export interface Miss {
  chain: number;
  /** Issue order across all chains, from 0. */
  index: number;
  /** When the chain wanted to issue the load (its previous load returned). */
  ready: number;
  /** When the load got a buffer and left for memory. */
  start: number;
  /** When the data returned. */
  end: number;
}

export interface Result {
  misses: Miss[];
  /** Steady-state ns per completed access, measured over the second half. */
  timePerAccess: number;
  /** Time-average number of misses holding a buffer, over the same span. */
  inFlight: number;
  /** Mean of (start - ready) over the second half: time spent waiting for a buffer. */
  meanWait: number;
}

export type Latency = number | ((index: number) => number);

export function simulate(chains: number, buffers: number, latency: Latency, accesses = 2400): Result {
  const k = Math.max(1, Math.floor(chains));
  const c = Math.max(1, Math.floor(buffers));
  const lat = typeof latency === "number" ? () => latency : latency;
  const misses: Miss[] = [];
  const ready = new Array<number>(k).fill(0);
  const queue: number[] = Array.from({ length: k }, (_, i) => i);
  const active: Miss[] = [];
  let free = c;
  let t = 0;
  let completed = 0;
  const ends: number[] = [];
  while (completed < accesses) {
    while (free > 0 && queue.length > 0 && misses.length < accesses) {
      const chain = queue.shift()!;
      const m: Miss = { chain, index: misses.length, ready: ready[chain], start: t, end: t + lat(misses.length) };
      misses.push(m);
      active.push(m);
      free--;
    }
    if (active.length === 0) break;
    // The earliest completion; ties go to the earlier-issued load.
    let best = 0;
    for (let i = 1; i < active.length; i++) {
      const a = active[i];
      const b = active[best];
      if (a.end < b.end || (a.end === b.end && a.index < b.index)) best = i;
    }
    const done = active.splice(best, 1)[0];
    t = done.end;
    free++;
    completed++;
    ends.push(t);
    ready[done.chain] = t;
    queue.push(done.chain);
  }
  const half = Math.floor(ends.length / 2);
  const t0 = ends[half - 1] ?? 0;
  const t1 = ends[ends.length - 1];
  const span = t1 - t0;
  const timePerAccess = span / (ends.length - half);
  // Buffer-time integral over [t0, t1]: each miss contributes its overlap.
  let busy = 0;
  let wait = 0;
  let waited = 0;
  for (const m of misses) {
    busy += Math.max(0, Math.min(m.end, t1) - Math.max(m.start, t0));
    if (m.index >= half) {
      wait += m.start - m.ready;
      waited++;
    }
  }
  return { misses, timePerAccess, inFlight: busy / span, meanWait: waited ? wait / waited : 0 };
}

/** The closed form for a fixed latency: L / min(k, C). */
export const closedForm = (chains: number, buffers: number, latency: number): number =>
  latency / Math.min(chains, buffers);

export interface Measured {
  chains: number;
  median: number;
  min: number;
  max: number;
}

// Medians and ranges of 12 runs per chain count on a 4 GiB array with 2 MB
// pages: a KVM guest on an Intel Xeon reporting family 6, model 207 (Emerald
// Rapids). Copied from mlp_bench-summary.json beside the note; the tests check
// that they still match it.
export const MEASURED: Measured[] = [
  { chains: 1, median: 151.6, min: 142.4, max: 168.6 },
  { chains: 2, median: 73.0, min: 67.2, max: 89.3 },
  { chains: 3, median: 48.2, min: 44.3, max: 50.2 },
  { chains: 4, median: 36.3, min: 34.1, max: 38.0 },
  { chains: 5, median: 28.8, min: 28.0, max: 31.9 },
  { chains: 6, median: 24.7, min: 23.6, max: 25.5 },
  { chains: 7, median: 20.7, min: 20.2, max: 22.8 },
  { chains: 8, median: 18.6, min: 17.8, max: 20.5 },
  { chains: 9, median: 16.9, min: 16.1, max: 17.8 },
  { chains: 10, median: 15.2, min: 14.4, max: 23.1 },
  { chains: 11, median: 14.0, min: 13.3, max: 14.9 },
  { chains: 12, median: 13.1, min: 12.6, max: 14.2 },
  { chains: 13, median: 12.1, min: 11.6, max: 12.7 },
  { chains: 14, median: 11.6, min: 10.9, max: 12.8 },
  { chains: 15, median: 11.3, min: 10.6, max: 17.0 },
  { chains: 16, median: 10.7, min: 10.1, max: 15.6 },
  { chains: 18, median: 10.1, min: 9.4, max: 10.5 },
  { chains: 20, median: 9.8, min: 8.9, max: 11.0 },
  { chains: 24, median: 9.8, min: 8.6, max: 11.0 },
  { chains: 28, median: 9.8, min: 8.6, max: 11.4 },
  { chains: 32, median: 10.1, min: 8.7, max: 11.3 },
];

// The default latency is the measured single-chain median.
export const DEFAULTS = { chains: 8, latency: 152, buffers: 16 };
export const LIMITS = {
  chains: [1, 32],
  latency: [50, 300],
  buffers: [4, 24],
} as const;

export const clamp = (v: number, [lo, hi]: readonly [number, number]): number =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));
