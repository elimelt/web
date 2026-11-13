// Discrete-event model of c FCFS servers fed by Poisson arrivals. The same
// Simulator produces the statistics in the charts and the jobs drawn in the
// animation, so the picture and the numbers come from one run of one model.
// Time is measured in mean service times (E[S] = 1).

export type Dist = "exp" | "det" | "bimodal";
export type Policy = "shared" | "random" | "rr" | "jsq2" | "jsq" | "lwl";

export const DISTS: Record<Dist, { label: string; short: string }> = {
  exp: { label: "Exponential", short: "exponential" },
  det: { label: "Constant", short: "constant" },
  bimodal: { label: "Bimodal: 1 in 200 jobs is 50× longer", short: "bimodal" },
};

export const POLICIES: Record<Policy, { label: string; short: string }> = {
  shared: { label: "One shared queue", short: "shared queue" },
  random: { label: "Random server", short: "random" },
  rr: { label: "Round robin", short: "round robin" },
  jsq2: { label: "Shorter of two random queues", short: "two choices" },
  jsq: { label: "Shortest queue", short: "shortest queue" },
  lwl: { label: "Least work left", short: "least work left" },
};

export const SERVER_COUNTS = [1, 2, 4, 8, 16, 32];

// The bimodal workload matches queue_experiments.py: one job in 200 is long,
// long jobs take 50 times as long as short ones, and the mean is 1.
export const BIMODAL_P = 0.005;
export const BIMODAL_RATIO = 50;
export const BIMODAL_SHORT = 1 / (1 - BIMODAL_P + BIMODAL_P * BIMODAL_RATIO);
export const BIMODAL_LONG = BIMODAL_SHORT * BIMODAL_RATIO;

/** E[S^2] for each workload; E[S] is 1 for all three. */
export function secondMoment(dist: Dist): number {
  if (dist === "exp") return 2;
  if (dist === "det") return 1;
  return (1 - BIMODAL_P) * BIMODAL_SHORT ** 2 + BIMODAL_P * BIMODAL_LONG ** 2;
}

/** sfc32: small, fast, and good enough for simulation; seeded deterministically. */
export function rng(seed: number): () => number {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 16; i++) next();
  return next;
}

export interface Config {
  servers: number;
  rho: number;
  dist: Dist;
  policy: Policy;
}

export interface Job {
  arrival: number;
  start: number;
  finish: number;
  size: number;
  server: number;
}

/**
 * Generates jobs one at a time. Each job's start and finish are fixed when it
 * arrives: under FCFS a job never waits for anything that arrives after it, so
 * nothing later can change them. That makes every policy here a few lines.
 */
export class Simulator {
  private readonly rand: () => number;
  private readonly lambda: number;
  private readonly free: Float64Array; // when each server finishes its assigned work
  private readonly departures: number[][]; // finish times of jobs still at each server
  private readonly heads: Int32Array; // first live entry of each departures list
  private now = 0;
  private count = 0;

  constructor(readonly config: Config, seed: number) {
    this.rand = rng(seed);
    this.lambda = config.rho * config.servers;
    this.free = new Float64Array(config.servers);
    this.departures = Array.from({ length: config.servers }, () => []);
    this.heads = new Int32Array(config.servers);
  }

  private exp(rate: number): number {
    return -Math.log(1 - this.rand()) / rate;
  }

  private size(): number {
    const dist = this.config.dist;
    if (dist === "exp") return this.exp(1);
    if (dist === "det") return 1;
    return this.rand() < BIMODAL_P ? BIMODAL_LONG : BIMODAL_SHORT;
  }

  /** Jobs present at server i (waiting or in service) at the current time. */
  private present(i: number): number {
    const list = this.departures[i];
    let h = this.heads[i];
    while (h < list.length && list[h] <= this.now) h++;
    if (h > 1024 && h * 2 > list.length) {
      list.splice(0, h);
      h = 0;
    }
    this.heads[i] = h;
    return list.length - h;
  }

  private pickAmong(best: number[]): number {
    return best.length === 1 ? best[0] : best[Math.floor(this.rand() * best.length)];
  }

  private choose(): number {
    const c = this.config.servers;
    if (c === 1) return 0;
    switch (this.config.policy) {
      case "random":
        return Math.floor(this.rand() * c);
      case "rr":
        return this.count % c;
      case "jsq2": {
        const a = Math.floor(this.rand() * c);
        const b = (a + 1 + Math.floor(this.rand() * (c - 1))) % c;
        const na = this.present(a);
        const nb = this.present(b);
        return na < nb ? a : nb < na ? b : this.rand() < 0.5 ? a : b;
      }
      case "jsq": {
        let min = Infinity;
        let best: number[] = [];
        for (let i = 0; i < c; i++) {
          const n = this.present(i);
          if (n < min) {
            min = n;
            best = [i];
          } else if (n === min) best.push(i);
        }
        return this.pickAmong(best);
      }
      case "shared":
      case "lwl": {
        // A shared FCFS queue hands each job to the first server to come
        // free, which is the server with the least work assigned. With job
        // sizes known, least-work-left dispatch is the same schedule.
        let min = Infinity;
        let best: number[] = [];
        for (let i = 0; i < c; i++) {
          const left = Math.max(this.free[i] - this.now, 0);
          if (left < min) {
            min = left;
            best = [i];
          } else if (left === min) best.push(i);
        }
        return this.pickAmong(best);
      }
    }
  }

  next(): Job {
    this.now += this.exp(this.lambda);
    const server = this.choose();
    const size = this.size();
    const start = Math.max(this.now, this.free[server]);
    const finish = start + size;
    this.free[server] = finish;
    if (this.config.policy === "jsq" || this.config.policy === "jsq2") this.departures[server].push(finish);
    this.count++;
    return { arrival: this.now, start, finish, size, server };
  }
}

export const WARMUP = 0.1;

/** Response times of `jobs` jobs, dropping the first 10% as warm-up. */
export function responses(config: Config, jobs: number, seed: number): Float64Array {
  const sim = new Simulator(config, seed);
  const skip = Math.floor(jobs * WARMUP);
  const out = new Float64Array(jobs - skip);
  for (let k = 0; k < jobs; k++) {
    const job = sim.next();
    if (k >= skip) out[k - skip] = job.finish - job.arrival;
  }
  return out;
}

/** Linear-interpolated quantile of sorted data, as NumPy's default. */
export function quantile(sorted: Float64Array, q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Stats {
  mean: number;
  p50: number;
  p99: number;
  p999: number;
}

export function stats(data: Float64Array): { stats: Stats; sorted: Float64Array } {
  const sorted = Float64Array.from(data).sort();
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) sum += sorted[i];
  return {
    sorted,
    stats: {
      mean: sum / sorted.length,
      p50: quantile(sorted, 0.5),
      p99: quantile(sorted, 0.99),
      p999: quantile(sorted, 0.999),
    },
  };
}

// ---- closed forms ------------------------------------------------------------

/** Probability an arrival waits in M/M/c with offered load a = lambda / mu. */
export function erlangC(c: number, a: number): number {
  let b = 1;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  const rho = a / c;
  return b / (1 - rho + rho * b);
}

/** P(R > t) in M/M/c FCFS with mu = 1: R = W + S, W = 0 w.p. 1 - C, else Exp(c - lambda). */
export function mmcCcdf(t: number, c: number, rho: number): number {
  const lambda = rho * c;
  const pc = erlangC(c, lambda);
  const theta = c - lambda;
  const both = Math.abs(theta - 1) < 1e-9 ? (1 + t) * Math.exp(-t) : (theta * Math.exp(-t) - Math.exp(-theta * t)) / (theta - 1);
  return (1 - pc) * Math.exp(-t) + pc * both;
}

export function mmcQuantile(q: number, c: number, rho: number): number {
  let lo = 0;
  let hi = 1;
  while (mmcCcdf(hi, c, rho) > 1 - q) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (mmcCcdf(mid, c, rho) > 1 - q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function mmcMean(c: number, rho: number): number {
  const lambda = rho * c;
  return 1 + erlangC(c, lambda) / (c - lambda);
}

/** Pollaczek-Khinchine mean response time for M/G/1 with E[S] = 1. */
export function pkMean(rho: number, dist: Dist): number {
  return 1 + (rho * secondMoment(dist)) / (2 * (1 - rho));
}

export interface Theory {
  /** Which model the curves come from, for the legend. */
  model: string;
  mean: number;
  /** Present only when the whole response-time distribution is known. */
  p99?: number;
  ccdf?: (t: number) => number;
}

/**
 * Exact results where the configuration has one: a single server, or c
 * servers that each behave as a single server (random dispatch splits a
 * Poisson stream into independent Poisson streams), or a shared queue with
 * exponential service (M/M/c). Least-work-left is the shared queue.
 */
export function theory(config: Config, rho = config.rho): Theory | undefined {
  const { servers, dist, policy } = config;
  const single = servers === 1 || policy === "random";
  const pooled = servers > 1 && (policy === "shared" || policy === "lwl");
  if (single && dist === "exp") {
    return { model: "M/M/1", mean: 1 / (1 - rho), p99: Math.log(100) / (1 - rho), ccdf: (t) => Math.exp(-(1 - rho) * t) };
  }
  if (single) return { model: dist === "det" ? "M/D/1" : "M/G/1", mean: pkMean(rho, dist) };
  if (pooled && dist === "exp") {
    return { model: `M/M/${servers}`, mean: mmcMean(servers, rho), p99: mmcQuantile(0.99, servers, rho), ccdf: (t) => mmcCcdf(t, servers, rho) };
  }
  return undefined;
}

// ---- the experiments the figure runs ----------------------------------------

export const SWEEP_RHOS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
export const SEEDS = 3;

/**
 * Jobs per run. Queues near saturation forget their starting state slowly
 * (the relaxation time grows like 1/(1 - rho)^2), so heavier loads get longer
 * runs; the seed-to-seed spread in the chart shows what is left.
 */
export function jobsFor(rho: number, budget = 1): number {
  const base = 20_000 / Math.max((1 - rho) * 2.5, 0.25);
  return Math.round(Math.min(Math.max(base, 20_000), 250_000) * budget);
}

export interface Point {
  rho: number;
  /** One Stats per seed. */
  runs: Stats[];
}

export function spread(runs: Stats[], key: keyof Stats): { mid: number; lo: number; hi: number } {
  const vals = runs.map((r) => r[key]);
  const mid = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { mid, lo: Math.min(...vals), hi: Math.max(...vals) };
}

export function point(config: Config, rho: number, seedBase: number, budget = 1): Point {
  const runs: Stats[] = [];
  for (let s = 0; s < SEEDS; s++) runs.push(stats(responses({ ...config, rho }, jobsFor(rho, budget), seedBase + s * 7919)).stats);
  return { rho, runs };
}

export interface Detail {
  point: Point;
  /** Pooled response times across seeds, sorted, for the distribution plot. */
  sorted: Float64Array;
}

export function detail(config: Config, seedBase: number, budget = 1): Detail {
  const runs: Stats[] = [];
  const all: Float64Array[] = [];
  for (let s = 0; s < SEEDS; s++) {
    const r = stats(responses(config, jobsFor(config.rho, budget), seedBase + s * 7919));
    runs.push(r.stats);
    all.push(r.sorted);
  }
  const total = all.reduce((n, a) => n + a.length, 0);
  const merged = new Float64Array(total);
  let off = 0;
  for (const a of all) {
    merged.set(a, off);
    off += a.length;
  }
  merged.sort();
  return { point: { rho: config.rho, runs }, sorted: merged };
}
