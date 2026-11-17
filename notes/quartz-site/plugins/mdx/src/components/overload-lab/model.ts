// A discrete-event simulation of the server measured for the admission-control
// note: `cores` processors shared equally by the requests in service
// (processor sharing, which is what goroutines on GOMAXPROCS=2 that yield
// every ~90 us approximate), Poisson arrivals, exponentially distributed work,
// a client deadline per attempt, and optional immediate retries. Each
// admission policy is the same rule the Go server applies. Nothing here
// touches the DOM, so the tests and the build run it in Node.

import { mulberry32 } from "../../shared/random";

export type PolicyKey = "none" | "fixed" | "queue" | "codel" | "gradient";

export const POLICIES: Record<PolicyKey, { label: string; short: string }> = {
  none: { label: "No admission control", short: "none" },
  fixed: { label: "Fixed limit (16 in progress)", short: "fixed limit" },
  queue: { label: "Queue bounded by count (1000)", short: "count-bounded queue" },
  codel: { label: "Queue-delay shedding (CoDel-style)", short: "CoDel-style" },
  gradient: { label: "Adaptive limit (Gradient2)", short: "Gradient2" },
};

export const POLICY_KEYS = Object.keys(POLICIES) as PolicyKey[];

export interface Params {
  policy: PolicyKey;
  rate: number; // offered requests per second (callers, not attempts)
  cores: number;
  meanService: number; // seconds of one core per request, mean
  deadline: number; // seconds, per attempt
  retries: number; // extra attempts after a timeout or rejection
  duration: number; // seconds simulated
  bucket: number; // seconds per time-series bucket
  spikeAt: number; // seconds; the offered rate is spikeRate during [spikeAt, spikeAt + spikeFor)
  spikeFor: number;
  spikeRate: number;
  // policy settings, as on the server
  fixedLimit: number;
  workers: number;
  queueLimit: number;
  codelTarget: number;
  codelInterval: number;
  gradInitial: number;
  gradMin: number;
  gradMax: number;
}

// Calibrated to the measured server: 2 cores, and a mean of 11,000 SHA-256
// rounds (about 1 ms of one core) plus per-request HTTP/2 overhead, which
// together saturate at the ~1,750 requests/s the server sustained with a
// fixed limit at 3,000 offered (see measured.ts).
export const DEFAULTS: Params = {
  policy: "none",
  rate: 1400,
  cores: 2,
  meanService: 2 / 1750,
  deadline: 0.1,
  retries: 0,
  duration: 12,
  bucket: 0.25,
  spikeAt: 0,
  spikeFor: 0,
  spikeRate: 0,
  fixedLimit: 16,
  workers: 4,
  queueLimit: 1000,
  codelTarget: 0.005,
  codelInterval: 0.1,
  gradInitial: 16,
  gradMin: 2,
  gradMax: 1000,
};

export interface Result {
  params: Params;
  offered: number; // callers per second
  attempts: number; // attempts per second
  goodput: number; // callers per second answered within a deadline (after warm-up)
  shed: number; // callers per second whose last attempt was rejected
  timedOut: number; // callers per second whose last attempt timed out
  completions: number; // requests per second the server finished, useful or not
  wasted: number; // fraction of finished requests whose caller had given up
  p99: number; // seconds, of successful callers' latency
  meanLatency: number; // seconds, of successful callers
  series: { t: number; goodput: number; attempts: number; inServer: number; limit: number }[];
}

// ---- a binary heap ------------------------------------------------------------

class Heap<T> {
  private a: T[] = [];
  constructor(private key: (x: T) => number) {}
  get size() {
    return this.a.length;
  }
  peek(): T | undefined {
    return this.a[0];
  }
  push(x: T) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key(a[p]) <= this.key(a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.key(a[l]) < this.key(a[m])) m = l;
        if (r < a.length && this.key(a[r]) < this.key(a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// ---- simulation -----------------------------------------------------------------

interface Caller {
  arrival: number;
  work: number; // seconds of one core
  attemptsLeft: number;
  done: boolean;
  ok: boolean;
  lastFail: "shed" | "timeout" | "";
  latency: number;
}

interface Attempt {
  caller: Caller;
  sent: number;
  timedOut: boolean;
  finishV: number; // virtual time at which processor sharing finishes it
  admitted: number; // when service began
}

/** Runs one simulation. Deterministic for a given seed. */
export function simulate(p: Params, seed = 1): Result {
  const rand = mulberry32(seed);
  const exp = () => -Math.log(1 - rand());
  const warm = Math.min(2, p.duration / 5);

  // Processor sharing with a common virtual clock V: every request in service
  // receives service at rate min(1, cores / n), so a request that entered at
  // virtual time v with work w finishes when V reaches v + w.
  let now = 0;
  let V = 0;
  const inService = new Heap<Attempt>((a) => a.finishV);
  const advance = (t: number) => {
    const n = inService.size;
    if (n > 0) V += (t - now) * Math.min(1, p.cores / n);
    now = t;
  };
  const nextFinish = () => {
    const top = inService.peek();
    if (!top) return Infinity;
    const n = inService.size;
    return now + (top.finishV - V) / Math.min(1, p.cores / n);
  };

  // Timers: attempt deadlines and gradient windows share one event heap.
  type Timer = { at: number; kind: "deadline"; attempt: Attempt } | { at: number; kind: "arrival" };
  const timers = new Heap<Timer>((t) => t.at);

  // FIFO queue for the queue and codel policies.
  const queue: Attempt[] = [];
  let qHead = 0;
  const qLen = () => queue.length - qHead;
  let lastEmpty = 0;

  // Gradient2 state.
  let limit = p.gradInitial;
  let peakInflight = 0;
  let longRTT = 0;
  let longN = 0;
  let winSum = 0;
  let winN = 0;
  let winEnd = 0.05;

  const callers: Caller[] = [];
  const buckets = Math.ceil(p.duration / p.bucket);
  const series = Array.from({ length: buckets }, (_, i) => ({ t: i * p.bucket, goodput: 0, attempts: 0, inServer: 0, limit: 0 }));
  let completions = 0;
  let wasted = 0;
  let attemptsAfterWarm = 0;

  const startService = (a: Attempt) => {
    a.admitted = now;
    a.finishV = V + a.caller.work;
    inService.push(a);
    if (inService.size > peakInflight) peakInflight = inService.size;
  };

  const fail = (a: Attempt, why: "shed" | "timeout") => {
    const c = a.caller;
    if (c.done) return;
    c.lastFail = why;
    if (c.attemptsLeft > 0) send(c);
    else {
      c.done = true;
      c.latency = now - c.arrival;
    }
  };

  const reject = (a: Attempt) => {
    // A rejection reaches the client at once; the client retries or gives up.
    fail(a, "shed");
  };

  const codelLimit = () => (qLen() === 0 || now - lastEmpty < p.codelInterval ? p.codelInterval : p.codelTarget);

  const dispatch = () => {
    while (inService.size < p.workers && qLen() > 0) {
      const lim = p.policy === "codel" ? codelLimit() : Infinity;
      const a = queue[qHead++];
      if (now - a.sent > lim) {
        if (!a.timedOut) reject(a);
        continue;
      }
      startService(a);
    }
    if (qLen() === 0) {
      lastEmpty = now;
      queue.length = 0;
      qHead = 0;
    }
  };

  const send = (c: Caller) => {
    c.attemptsLeft--;
    const a: Attempt = { caller: c, sent: now, timedOut: false, finishV: 0, admitted: 0 };
    if (now >= warm) attemptsAfterWarm++;
    const b = Math.floor(now / p.bucket);
    if (b < buckets) series[b].attempts++;
    timers.push({ at: now + p.deadline, kind: "deadline", attempt: a });
    switch (p.policy) {
      case "none":
        startService(a);
        break;
      case "fixed":
        if (inService.size >= p.fixedLimit) reject(a);
        else startService(a);
        break;
      case "gradient":
        if (inService.size >= limit) reject(a);
        else startService(a);
        break;
      case "queue":
      case "codel":
        if (qLen() === 0) lastEmpty = now;
        if (inService.size < p.workers && qLen() === 0) startService(a);
        else if (p.policy === "queue" && qLen() >= p.queueLimit) reject(a);
        else queue.push(a);
        break;
    }
  };

  const gradientSample = (rtt: number) => {
    winSum += rtt;
    winN++;
    if (now < winEnd || winN < 10) return;
    const short = winSum / winN;
    const peak = peakInflight;
    winSum = 0;
    winN = 0;
    peakInflight = inService.size;
    winEnd = now + 0.05;
    longN++;
    if (longN <= 10) longRTT += (short - longRTT) / longN;
    else longRTT += ((short - longRTT) * 2) / 601;
    if (longRTT / short > 2) longRTT *= 0.95;
    if (peak < limit / 2) return;
    const grad = Math.max(0.5, Math.min(1, (1.5 * longRTT) / short));
    let next = limit * grad + 4;
    next = limit * 0.8 + next * 0.2;
    limit = Math.max(p.gradMin, Math.min(p.gradMax, next));
  };

  const finish = (a: Attempt) => {
    completions += now >= warm ? 1 : 0;
    const c = a.caller;
    if (p.policy === "gradient") gradientSample(now - a.admitted);
    if (a.timedOut || c.done) {
      if (now >= warm) wasted++;
    } else {
      c.done = true;
      c.ok = true;
      c.latency = now - c.arrival;
    }
    if (p.policy === "queue" || p.policy === "codel") dispatch();
  };

  // Arrivals form a Poisson process whose rate steps up during the spike. By
  // memorylessness, a gap that would cross a step is redrawn from the step.
  const spikeEnd = p.spikeAt + p.spikeFor;
  const rateAt = (t: number) => (p.spikeFor > 0 && t >= p.spikeAt && t < spikeEnd ? p.spikeRate : p.rate);
  const nextArrival = (t: number): number => {
    for (;;) {
      const next = t + exp() / rateAt(t);
      const step = p.spikeFor > 0 ? (t < p.spikeAt ? p.spikeAt : t < spikeEnd ? spikeEnd : Infinity) : Infinity;
      if (next < step) return next;
      t = step;
    }
  };
  timers.push({ at: nextArrival(0), kind: "arrival" });
  const end = p.duration;
  for (;;) {
    const tf = nextFinish();
    const tt = timers.peek()?.at ?? Infinity;
    const t = Math.min(tf, tt);
    if (t >= end) break;
    advance(t);
    if (tf <= tt) {
      finish(inService.pop()!);
    } else {
      const ev = timers.pop()!;
      if (ev.kind === "arrival") {
        const c: Caller = { arrival: now, work: exp() * p.meanService, attemptsLeft: p.retries + 1, done: false, ok: false, lastFail: "", latency: 0 };
        callers.push(c);
        send(c);
        timers.push({ at: nextArrival(now), kind: "arrival" });
      } else {
        const a = ev.attempt;
        if (!a.caller.done && !a.timedOut) {
          a.timedOut = true;
          fail(a, "timeout");
        }
      }
    }
    // Sample state into the bucket the clock is in.
    const b = Math.floor(now / p.bucket);
    if (b < buckets) {
      series[b].inServer = Math.max(series[b].inServer, inService.size + qLen());
      series[b].limit = p.policy === "gradient" ? limit : 0;
    }
  }

  // Callers in the last `tail` seconds may not have an outcome yet.
  const tail = Math.min(p.deadline * (p.retries + 1), 1);
  const span = p.duration - warm;
  let good = 0;
  let shed = 0;
  let timedOut = 0;
  let offered = 0;
  const lat: number[] = [];
  for (const c of callers) {
    if (c.ok) {
      const b = Math.floor(c.arrival / p.bucket);
      if (b < buckets) series[b].goodput++;
    }
    if (c.arrival < warm || c.arrival > end - tail) continue;
    offered++;
    if (c.ok) {
      good++;
      lat.push(c.latency);
    } else if (c.lastFail === "shed") shed++;
    else timedOut++;
  }
  const usable = span - tail;
  lat.sort((a, b) => a - b);
  for (const s of series) {
    s.goodput /= p.bucket;
    s.attempts /= p.bucket;
  }
  return {
    params: p,
    offered: offered / usable,
    attempts: attemptsAfterWarm / span,
    goodput: good / usable,
    shed: shed / usable,
    timedOut: timedOut / usable,
    completions: completions / span,
    wasted: completions > 0 ? wasted / completions : 0,
    meanLatency: lat.length ? lat.reduce((x, y) => x + y, 0) / lat.length : NaN,
    p99: lat.length ? lat[Math.min(lat.length - 1, Math.floor(0.99 * lat.length))] : NaN,
    series,
  };
}
