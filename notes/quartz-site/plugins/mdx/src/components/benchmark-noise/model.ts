// A simulated A/B benchmark. Version A takes BASE_NS per operation and
// version B is `speedup` faster. Each timed run picks up the noise sources a
// measurement record is meant to rule out, unless the matching control is on.
// The sizes are illustrative, not measurements.

export const BASE_NS = 100;

export interface State {
  /** True fractional speedup of B over A, 0 to 0.15. */
  speedup: number;
  /** Timed runs per version. */
  runs: number;
  warmup: boolean;
  pin: boolean;
  freq: boolean;
  quiet: boolean;
  /** Seed for the experiment shown in the chart. */
  seed: number;
}

export const defaultState = (seed = 7): State => ({
  speedup: 0.02,
  runs: 5,
  warmup: false,
  pin: false,
  freq: false,
  quiet: false,
  seed,
});

export interface Sample {
  version: "A" | "B";
  /** Position in the session: all A runs come first, then all B runs. */
  order: number;
  ns: number;
}

// mulberry32: small, fast and identical in Node and every browser.
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix = (seed: number, version: number, run: number): number =>
  (Math.imul(seed, 0x9e3779b1) ^ Math.imul(version + 1, 0x85ebca77) ^ Math.imul(run + 1, 0xc2b2ae3d)) | 0;

/**
 * One timed run. Every random number is drawn whether or not its noise source
 * is switched on, so toggling a control changes only that effect and the same
 * run keeps the same luck.
 */
function run(state: State, version: 0 | 1, index: number): Sample {
  const random = rng(mix(state.seed, version, index));
  const gauss = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const migrated = random() < 0.1;
  const migrationCost = 1.04 + 0.1 * random();
  const interrupted = random() < 0.06;
  const interruptionCost = -0.25 * Math.log(1 - random());

  const order = version === 0 ? index : state.runs + index;
  let ns = BASE_NS * (version === 0 ? 1 : 1 - state.speedup) * (1 + 0.01 * gauss);
  if (!state.warmup && index === 0) ns *= 1.3; // cold caches, page faults, branch predictors
  if (!state.warmup && index === 1) ns *= 1.06;
  if (!state.freq) ns *= 1 + 0.12 * (1 - Math.exp(-order / 8)); // turbo fades as the chip heats
  if (!state.pin && migrated) ns *= migrationCost; // the scheduler moved the thread
  if (!state.quiet && interrupted) ns *= 1 + interruptionCost; // another process took the core
  return { version: version === 0 ? "A" : "B", order, ns };
}

export function simulate(state: State): Sample[] {
  const samples: Sample[] = [];
  for (const version of [0, 1] as const) {
    for (let i = 0; i < state.runs; i++) samples.push(run(state, version, i));
  }
  return samples;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const quantile = (sorted: number[], q: number): number => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export interface Analysis {
  samples: Sample[];
  medianA: number;
  medianB: number;
  /** Measured speedup of B, from the medians. */
  measured: number;
  /** Bootstrap 95% interval for the speedup, or null with one run each. */
  interval: [number, number] | null;
}

export function analyze(state: State): Analysis {
  const samples = simulate(state);
  const a = samples.filter((s) => s.version === "A").map((s) => s.ns);
  const b = samples.filter((s) => s.version === "B").map((s) => s.ns);
  const medianA = median(a);
  const medianB = median(b);
  let interval: [number, number] | null = null;
  if (state.runs > 1) {
    const random = rng(state.seed ^ 0x5bd1e995);
    const pick = (values: number[]) => values.map(() => values[Math.floor(random() * values.length)]);
    const boots: number[] = [];
    for (let i = 0; i < 400; i++) boots.push(1 - median(pick(b)) / median(pick(a)));
    boots.sort((x, y) => x - y);
    interval = [quantile(boots, 0.025), quantile(boots, 0.975)];
  }
  return { samples, medianA, medianB, measured: 1 - medianB / medianA, interval };
}

export type Verdict = "faster" | "slower" | "unclear" | "single";

export function verdict(analysis: Analysis): Verdict {
  if (!analysis.interval) return "single";
  if (analysis.interval[0] > 0) return "faster";
  if (analysis.interval[1] < 0) return "slower";
  return "unclear";
}

export interface Repeats {
  experiments: number;
  /** Share whose medians put B ahead (true speedup above zero). */
  rightWinner: number;
  /** Share that measured a gap over 1% either way (true speedup zero). */
  falseAlarm: number;
  p5: number;
  p95: number;
}

/** Run the same experiment many times with fresh luck. */
export function repeat(state: State, experiments = 1000): Repeats {
  const measured: number[] = [];
  let right = 0;
  let alarms = 0;
  for (let e = 0; e < experiments; e++) {
    const samples = simulate({ ...state, seed: mix(state.seed, 7, e + 1000) });
    const a = median(samples.filter((s) => s.version === "A").map((s) => s.ns));
    const b = median(samples.filter((s) => s.version === "B").map((s) => s.ns));
    const speedup = 1 - b / a;
    measured.push(speedup);
    if (speedup > 0) right++;
    if (Math.abs(speedup) > 0.01) alarms++;
  }
  measured.sort((x, y) => x - y);
  return {
    experiments,
    rightWinner: right / experiments,
    falseAlarm: alarms / experiments,
    p5: quantile(measured, 0.05),
    p95: quantile(measured, 0.95),
  };
}
