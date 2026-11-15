// Event-driven simulation of three pipeline-parallel schedules: GPipe, 1F1B
// (PipeDream-Flush, as in Megatron-LM) and Megatron-LM's interleaved 1F1B.
//
// Each of p devices runs its operations in a fixed order. An operation starts
// when its device is idle and its one dependency has finished: the forward of
// microbatch k on model stage s needs the forward of k on stage s - 1, and
// the backward of k on stage s needs the backward on stage s + 1 (on the last
// stage, its own forward). Communication takes no time. Durations are in
// chunk units: a forward on one model chunk takes 1 and a backward 2, so with
// v chunks per device one microbatch costs a device 3v units. Divide by v for
// time in units of one whole-device forward pass.

export type Kind = "gpipe" | "1f1b" | "interleaved";
export const KINDS: readonly Kind[] = ["gpipe", "1f1b", "interleaved"];

export const TF = 1;
export const TB = 2;

export interface Op {
  device: number;
  phase: "F" | "B";
  /** Microbatch, from 0. */
  mb: number;
  /** Model chunk on this device, from 0; chunk c on device i is model stage c p + i. */
  chunk: number;
  start: number;
  end: number;
}

export interface Result {
  kind: Kind;
  p: number;
  m: number;
  v: number;
  ops: Op[];
  makespan: number;
  /** Busy time of one device: m v (TF + TB). */
  ideal: number;
  /** Idle time over busy time on each device (they are equal). */
  bubble: number;
  /** Peak microbatches whose activations a device holds, in whole-device units (chunk count / v). */
  peak: number[];
  /** For each device, the in-flight count (in chunk units) after each change: [time, count]. */
  inflight: [number, number][][];
}

/** The order in which each device runs its operations. */
export function orders(kind: Kind, p: number, m: number, v: number): Omit<Op, "device" | "start" | "end">[][] {
  const out: Omit<Op, "device" | "start" | "end">[][] = [];
  for (let i = 0; i < p; i++) {
    const seq: Omit<Op, "device" | "start" | "end">[] = [];
    const F = (mb: number, chunk = 0) => seq.push({ phase: "F", mb, chunk });
    const B = (mb: number, chunk = 0) => seq.push({ phase: "B", mb, chunk });
    if (kind === "gpipe") {
      for (let k = 0; k < m; k++) F(k);
      for (let k = 0; k < m; k++) B(k);
    } else if (kind === "1f1b") {
      // Warm-up: p - i - 1 forwards; then one forward, one backward; then drain.
      const warm = Math.min(p - i - 1, m);
      for (let k = 0; k < warm; k++) F(k);
      for (let k = 0; k < m - warm; k++) {
        F(warm + k);
        B(k);
      }
      for (let k = m - warm; k < m; k++) B(k);
    } else {
      if (m % p !== 0) throw new Error("interleaving needs m to be a multiple of p");
      // Megatron-LM's order: microbatches in groups of p, each group run
      // through chunk 0, then chunk 1, ...; backwards visit chunks in reverse.
      const total = m * v;
      const mbOf = (k: number) => Math.floor(k / (p * v)) * p + (k % p);
      const fChunk = (k: number) => Math.floor(k / p) % v;
      const warm = m === p ? total : Math.min(2 * (p - i - 1) + (v - 1) * p, total);
      for (let k = 0; k < warm; k++) F(mbOf(k), fChunk(k));
      for (let k = 0; k < total - warm; k++) {
        F(mbOf(warm + k), fChunk(warm + k));
        B(mbOf(k), v - 1 - fChunk(k));
      }
      for (let k = total - warm; k < total; k++) B(mbOf(k), v - 1 - fChunk(k));
    }
    out.push(seq);
  }
  return out;
}

/** Whether a schedule can run with these sizes. */
export function valid(kind: Kind, p: number, m: number): boolean {
  return p >= 1 && m >= 1 && (kind !== "interleaved" || m % p === 0);
}

export function simulate(kind: Kind, p: number, m: number, vIn = 1): Result {
  const v = kind === "interleaved" ? vIn : 1;
  const seqs = orders(kind, p, m, v);
  const stages = p * v;
  const key = (phase: string, mb: number, stage: number) => `${phase}${mb}:${stage}`;
  const finished = new Map<string, number>();
  const next = new Array<number>(p).fill(0);
  const running = new Array<Op | null>(p).fill(null);
  const ops: Op[] = [];
  // Pending completions; at most p at once, so a sorted array is enough.
  const events: Op[] = [];

  const dependency = (i: number, phase: "F" | "B", mb: number, chunk: number): string | null => {
    const s = chunk * p + i;
    if (phase === "F") return s === 0 ? null : key("F", mb, s - 1);
    return s === stages - 1 ? key("F", mb, s) : key("B", mb, s + 1);
  };

  const tryStart = (i: number, now: number) => {
    if (running[i] || next[i] >= seqs[i].length) return;
    const { phase, mb, chunk } = seqs[i][next[i]];
    const dep = dependency(i, phase, mb, chunk);
    if (dep !== null && !finished.has(dep)) return;
    const op: Op = { device: i, phase, mb, chunk, start: now, end: now + (phase === "F" ? TF : TB) };
    next[i]++;
    running[i] = op;
    ops.push(op);
    let at = events.length;
    while (at > 0 && (events[at - 1].end > op.end || (events[at - 1].end === op.end && events[at - 1].device > op.device))) at--;
    events.splice(at, 0, op);
  };

  for (let i = 0; i < p; i++) tryStart(i, 0);
  while (events.length) {
    const now = events[0].end;
    // Retire every operation that finishes now, then start whatever is ready.
    while (events.length && events[0].end === now) {
      const op = events.shift()!;
      running[op.device] = null;
      finished.set(key(op.phase, op.mb, op.chunk * p + op.device), now);
    }
    for (let i = 0; i < p; i++) tryStart(i, now);
  }
  for (let i = 0; i < p; i++) if (next[i] < seqs[i].length) throw new Error(`deadlock on device ${i}`);

  const makespan = Math.max(...ops.map((o) => o.end));
  const ideal = m * v * (TF + TB);
  const inflight: [number, number][][] = [];
  const peak: number[] = [];
  for (let i = 0; i < p; i++) {
    // Activations of (microbatch, chunk) are held from the start of its
    // forward to the end of its backward.
    const changes: [number, number][] = [];
    for (const o of ops) if (o.device === i) changes.push(o.phase === "F" ? [o.start, 1] : [o.end, -1]);
    changes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let best = 0;
    const steps: [number, number][] = [[0, 0]];
    for (const [t, d] of changes) {
      cur += d;
      best = Math.max(best, cur);
      if (steps[steps.length - 1][0] === t) steps[steps.length - 1][1] = cur;
      else steps.push([t, cur]);
    }
    inflight.push(steps);
    peak.push(best / v);
  }
  return { kind, p, m, v, ops, makespan, ideal, bubble: makespan / ideal - 1, peak, inflight };
}

/** Bubble time over ideal time from the papers: (p - 1) / m, divided by v when interleaved. */
export function closedBubble(kind: Kind, p: number, m: number, v: number): number {
  return (p - 1) / (m * (kind === "interleaved" ? v : 1));
}

/** Peak in-flight microbatches on device i (whole-device units). */
export function closedPeak(kind: Kind, p: number, m: number, v: number, i: number): number {
  if (kind === "gpipe") return m;
  if (kind === "1f1b") return Math.min(p - i, m);
  if (m === p) return m;
  return Math.min(2 * (p - i - 1) + (v - 1) * p + 1, m * v) / v;
}
