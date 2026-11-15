// Monte Carlo model of stale reads in a Dynamo-style store, the browser twin of
// dynamo-experiments/dynsim.py beside the note. One trial writes a new version
// of a key, then reads the key t ms after the write commits. Message delays
// follow the WARS model with the production latency fits of Bailis et al.,
// "Probabilistically Bounded Staleness for Practical Partial Quorums" (VLDB
// 2012), Table 3. Writes and reads go to the first N reachable nodes of the
// key's preference list (a sloppy quorum); a substitute holds a hinted replica
// until it hands the version to the home node after that node recovers.

import { mulberry32 } from "../../shared/random";

/** One-way delay: a Pareto body (weight wp, scale xm, shape alpha) and an exponential tail (rate lam per ms). */
export interface Mix {
  wp: number;
  xm: number;
  alpha: number;
  lam: number;
}

export interface Profile {
  label: string;
  w: Mix;
  a: Mix;
  r: Mix;
  s: Mix;
  /** Replica j sits in datacenter j mod 3; messages to another datacenter take 75 ms more. */
  wan: boolean;
}

const LNKD: Mix = { wp: 0.9122, xm: 0.235, alpha: 10, lam: 1.66 };
const DISK_W: Mix = { wp: 0.38, xm: 1.05, alpha: 1.51, lam: 0.183 };

export const PROFILES: Record<string, Profile> = {
  "LNKD-SSD": { label: "LinkedIn, SSD", w: LNKD, a: LNKD, r: LNKD, s: LNKD, wan: false },
  "LNKD-DISK": { label: "LinkedIn, disk", w: DISK_W, a: LNKD, r: LNKD, s: LNKD, wan: false },
  YMMR: {
    label: "Yammer",
    w: { wp: 0.939, xm: 3, alpha: 3.35, lam: 0.0028 },
    a: { wp: 0.982, xm: 1.5, alpha: 3.8, lam: 0.0217 },
    r: { wp: 0.982, xm: 1.5, alpha: 3.8, lam: 0.0217 },
    s: { wp: 0.982, xm: 1.5, alpha: 3.8, lam: 0.0217 },
    wan: false,
  },
  WAN: { label: "three datacenters", w: DISK_W, a: LNKD, r: LNKD, s: LNKD, wan: true },
};
export const PROFILE_KEYS = Object.keys(PROFILES);
export const WAN_DELAY = 75;
const WAN_DCS = 3;

export function sampleMix(m: Mix, rand: () => number): number {
  if (rand() < m.wp) return m.xm * Math.pow(1 - rand(), -1 / m.alpha);
  return -Math.log(1 - rand()) / m.lam;
}

/** Times after commit (ms) at which the figure evaluates P(stale). The first is 0. */
export const TIMES = [0, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

/** Failure settings: long-run fraction of time each node is down. */
export const FAILURE_FRACTIONS = [0, 0.01, 0.05, 0.1];
/** Mean outage and mean hint delivery delay after recovery, in ms (assumed; see the note). */
export const OUTAGE_MS = 10000;
export const HINT_MS = 1000;

export interface Config {
  profile: Profile;
  N: number;
  R: number;
  W: number;
  /** Fraction of time each node is down. */
  f: number;
  outage?: number;
  hint?: number;
  trials: number;
  seed: number;
  times?: number[];
}

export interface Result {
  times: number[];
  /** Stale reads at each time, among trials whose write and read both succeeded. */
  stale: number[];
  /** Trials whose write and read both succeeded, at each time. */
  ok: number[];
  /** Trials whose write found fewer than W reachable nodes. */
  writeFailed: number;
  trials: number;
  /** 99.9th percentile of commit latency and of read latency, over successful operations. */
  writeP999: number;
  readP999: number;
}

const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** Runs the simulation; deterministic for a given config. */
export function simulate(c: Config): Result {
  const { profile: p, N, R, W, f } = c;
  const outage = c.outage ?? OUTAGE_MS;
  const hint = c.hint ?? HINT_MS;
  const times = c.times ?? TIMES;
  const rand = mulberry32(c.seed);
  // Without failures only the top N positions are ever contacted.
  const L = f > 0 ? N + 8 : N;
  const kappa = f > 0 ? 1 / (outage * (1 - f)) : 0;
  const stale = times.map(() => 0);
  const ok = times.map(() => 0);
  const wl: number[] = [];
  const rl: number[] = [];
  let writeFailed = 0;
  const w = new Float64Array(L);
  const a = new Float64Array(L);
  const r = new Float64Array(L);
  const s = new Float64Array(L);
  const rec = new Float64Array(L);
  const u = new Float64Array(L);
  const down0 = new Uint8Array(L);
  const target = new Uint8Array(L);
  const hasFrom = new Float64Array(L);
  const goneAt = new Float64Array(L);
  const readTarget = new Uint8Array(L);
  const byReply: number[] = new Array(L).fill(0);
  const acks: number[] = [];

  for (let trial = 0; trial < c.trials; trial++) {
    const wdc = p.wan ? Math.floor(rand() * WAN_DCS) : 0;
    const rdc = p.wan ? Math.floor(rand() * WAN_DCS) : 0;
    for (let i = 0; i < L; i++) {
      const dc = i % WAN_DCS;
      const wx = p.wan && dc !== wdc ? WAN_DELAY : 0;
      const rx = p.wan && dc !== rdc ? WAN_DELAY : 0;
      w[i] = sampleMix(p.w, rand) + wx;
      a[i] = sampleMix(p.a, rand) + wx;
      r[i] = sampleMix(p.r, rand) + rx;
      s[i] = sampleMix(p.s, rand) + rx;
      down0[i] = f > 0 && rand() < f ? 1 : 0;
      rec[i] = down0[i] ? -Math.log(1 - rand()) * outage : 0;
      u[i] = f > 0 ? rand() : 1;
    }
    // The write goes to the first N reachable nodes and commits at the W-th ack.
    acks.length = 0;
    let taken = 0;
    for (let i = 0; i < L; i++) {
      target[i] = !down0[i] && taken < N ? 1 : 0;
      if (target[i]) {
        taken++;
        acks.push(w[i] + a[i]);
      }
      hasFrom[i] = target[i] ? w[i] : Infinity;
      goneAt[i] = Infinity;
    }
    if (taken < W) {
      writeFailed++;
      continue;
    }
    acks.sort((x, y) => x - y);
    const wt = acks[W - 1];
    wl.push(wt);
    // Hinted handoff: the k-th down node among the top N is replaced by the
    // k-th node past the top N that took the write.
    let si = N;
    for (let h = 0; h < N; h++) {
      if (!down0[h]) continue;
      while (si < L && !target[si]) si++;
      if (si >= L) break;
      const deliver = Math.max(rec[h], w[si]) - Math.log(1 - rand()) * hint;
      hasFrom[h] = Math.min(hasFrom[h], deliver);
      goneAt[si] = deliver;
      si++;
    }
    // Positions in order of their reply time r + s, which no t changes.
    for (let i = 0; i < L; i++) byReply[i] = i;
    byReply.sort((x, y) => r[x] + s[x] - (r[y] + s[y]));
    if (f === 0) {
      // Nothing fails: the read goes to positions 0..N-1, and is stale exactly
      // when t < min over its R fastest repliers of (w_i - wt - r_i).
      let threshold = Infinity;
      let seen = 0;
      let readLat = 0;
      for (let j = 0; j < L && seen < R; j++) {
        const i = byReply[j];
        if (i >= N) continue;
        seen++;
        threshold = Math.min(threshold, w[i] - wt - r[i]);
        readLat = r[i] + s[i];
      }
      rl.push(readLat);
      for (let k = 0; k < times.length; k++) {
        ok[k]++;
        if (times[k] < threshold) stale[k]++;
      }
      continue;
    }
    // A read t ms after commit, to the first N nodes reachable then.
    let firstRead = true;
    for (let k = 0; k < times.length; k++) {
      const tau = wt + times[k];
      let got = 0;
      for (let i = 0; i < L; i++) {
        let down: boolean;
        if (down0[i] && rec[i] > tau) down = true;
        else down = u[i] < f * (1 - Math.exp(-kappa * Math.max(tau - (down0[i] ? rec[i] : 0), 0)));
        readTarget[i] = !down && got < N ? 1 : 0;
        if (readTarget[i]) got++;
      }
      if (got < R) continue;
      // The R fastest replies among the nodes read decide the read.
      let fresh = false;
      let seen = 0;
      let readLat = 0;
      for (let j = 0; j < L && seen < R; j++) {
        const i = byReply[j];
        if (!readTarget[i]) continue;
        seen++;
        readLat = r[i] + s[i];
        const at = tau + r[i];
        if (hasFrom[i] <= at && at < goneAt[i]) fresh = true;
      }
      ok[k]++;
      if (!fresh) stale[k]++;
      if (firstRead) {
        rl.push(readLat);
        firstRead = false;
      }
    }
  }
  return { times, stale, ok, writeFailed, trials: c.trials, writeP999: quantile(wl, 0.999), readP999: quantile(rl, 0.999) };
}

/** Wilson 95% interval for k successes in n trials. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const ph = k / n;
  const d = 1 + (z * z) / n;
  const c = ph + (z * z) / (2 * n);
  const h = z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

/** First evaluated time at which P(stale) falls below the target and stays there; -1 if never. */
export function timeBelow(res: Result, target = 0.001): number {
  let at = -1;
  for (let k = res.times.length - 1; k >= 0; k--) {
    const pk = res.ok[k] ? res.stale[k] / res.ok[k] : 1;
    if (pk >= target) break;
    at = res.times[k];
  }
  return at;
}

export interface Setting {
  profile: string;
  N: number;
  R: number;
  W: number;
  f: number;
}

export interface Preset {
  main: Setting;
  compare?: Setting;
  t: number;
}

export const PRESETS: Record<string, Preset> = {
  // Beside the PBS paragraph: the same weak quorum on SSD and on spinning disk.
  disk: { main: { profile: "LNKD-DISK", N: 3, R: 1, W: 1, f: 0 }, compare: { profile: "LNKD-SSD", N: 3, R: 1, W: 1, f: 0 }, t: 10 },
  // Beside the N, R, W paragraph: the paper's common (3, 2, 2) against (3, 1, 1).
  quorum: { main: { profile: "LNKD-DISK", N: 3, R: 2, W: 2, f: 0 }, compare: { profile: "LNKD-DISK", N: 3, R: 1, W: 1, f: 0 }, t: 1 },
  // Beside the sloppy quorum paragraph: (3, 2, 2) when nodes fail.
  sloppy: { main: { profile: "LNKD-DISK", N: 3, R: 2, W: 2, f: 0.05 }, compare: { profile: "LNKD-DISK", N: 3, R: 1, W: 1, f: 0.05 }, t: 10000 },
};
export const DEFAULT_PRESET = "quorum";
export const presetKey = (v: unknown): string => (typeof v === "string" && v in PRESETS ? v : DEFAULT_PRESET);

export const TRIALS = 40000;
export const SEED = 2007;

export const run = (st: Setting, trials = TRIALS, seed = SEED): Result =>
  simulate({ profile: PROFILES[st.profile], N: st.N, R: st.R, W: st.W, f: st.f, trials, seed });

/** Keeps R and W within 1..N. */
export function clampSetting(st: Setting): Setting {
  const N = Math.max(1, Math.min(7, Math.round(st.N)));
  return { ...st, N, R: Math.max(1, Math.min(N, Math.round(st.R))), W: Math.max(1, Math.min(N, Math.round(st.W))) };
}
