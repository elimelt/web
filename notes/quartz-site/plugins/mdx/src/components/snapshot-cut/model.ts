// The snapshot cut figure's model: a recorded window of a distributed
// computation, and everything about a cut of it that the consistent global
// state note defines. Pure functions of the trace, so the build, the browser
// and the tests compute the same answers.
//
// A cut is one number per process: how many of that process's events in the
// window it includes. Every event before the window is in every cut, and the
// window starts and ends at consistent cuts (figure_trace.py checks this), so
// a message with an endpoint outside the window never decides consistency on
// its own.

export type Kind = "send" | "recv";

/** [process, k]: the k-th event of that process in the window, from 1. */
export type Endpoint = [number, number];

export interface TraceEvent {
  kind: Kind;
  /** Microseconds from the window's first event, host CLOCK_MONOTONIC. */
  t: number;
  /** Index into messages. */
  msg: number;
}

export interface TraceMessage {
  amount: number;
  src: number;
  dst: number;
  /** null: sent before the window, so inside every cut. */
  from: Endpoint | null;
  /** null: received after the window, so outside every cut. */
  to: Endpoint | null;
}

export interface Marker {
  /** Sent after `from[1]` events of process `from[0]`. */
  from: Endpoint;
  tFrom: number;
  /** Received after `to[1]` events of process `to[0]`. */
  to: Endpoint;
  tTo: number;
}

export interface RecordedCut {
  cut: number[];
  /** When each process recorded, same clock as the events. */
  t: number[];
  balances: number[];
  /** Chandy-Lamport only: what each process recorded on each incoming channel. */
  channels?: { from: number; to: number; msg: number }[];
}

export interface Trace {
  source: { seed: number; snapshot: number; procs: number; rate: number; window_start_events: number[] };
  total: number;
  /** Each process's balance at the start of the window. */
  base: number[];
  /** Messages in flight at the start of the window. */
  inflightAtStart: number[];
  events: TraceEvent[][];
  messages: TraceMessage[];
  markers: Marker[];
  cuts: { cl: RecordedCut; naive: RecordedCut };
  /** Computed by figure_trace.py against the whole run. */
  consistentCuts: number;
  allCuts: number;
}

export type Cut = number[];

export const inCut = (e: Endpoint | null, cut: Cut, outsideIsIn: boolean): boolean =>
  e === null ? outsideIsIn : e[1] <= cut[e[0]];

export interface CutState {
  cut: Cut;
  /** Received inside the cut, sent outside it. */
  orphans: number[];
  /** Sent inside the cut, received outside it: the channel state. */
  inflight: number[];
  balances: number[];
  balanceSum: number;
  inflightSum: number;
  orphanSum: number;
  consistent: boolean;
}

export function balanceAt(trace: Trace, p: number, k: number): number {
  let b = trace.base[p];
  for (let i = 0; i < k; i++) {
    const e = trace.events[p][i];
    const a = trace.messages[e.msg].amount;
    b += e.kind === "recv" ? a : -a;
  }
  return b;
}

export function analyzeCut(trace: Trace, cut: Cut): CutState {
  const orphans: number[] = [];
  const inflight: number[] = [];
  trace.messages.forEach((m, i) => {
    const sent = inCut(m.from, cut, true);
    const recvd = inCut(m.to, cut, false);
    if (recvd && !sent) orphans.push(i);
    if (sent && !recvd) inflight.push(i);
  });
  const balances = cut.map((k, p) => balanceAt(trace, p, k));
  const sum = (ids: number[]) => ids.reduce((s, i) => s + trace.messages[i].amount, 0);
  return {
    cut: [...cut],
    orphans,
    inflight,
    balances,
    balanceSum: balances.reduce((a, b) => a + b, 0),
    inflightSum: sum(inflight),
    orphanSum: sum(orphans),
    consistent: orphans.length === 0,
  };
}

/**
 * Vector clocks of the window's events, counting only events inside the
 * window: vc[p][k] is process p's clock after its k-th event (vc[p][0] is
 * all zeros). Messages sent before the window carry no entries, which is
 * sound because they are inside every cut.
 */
export function vectorClocks(trace: Trace): number[][][] {
  const n = trace.events.length;
  const vc = trace.events.map(() => [new Array(n).fill(0)]);
  const done = trace.events.map(() => 0);
  const sendClock = new Map<number, number[]>();
  // Replay in time order. A receive waits until its send has been replayed.
  const order = trace.events.flatMap((es, p) => es.map((e, k) => ({ p, k, t: e.t, e }))).sort((a, b) => a.t - b.t || a.p - b.p);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const { p, k, e } of order) {
      if (done[p] !== k) continue;
      const m = trace.messages[e.msg];
      if (e.kind === "recv" && m.from !== null && !sendClock.has(e.msg)) continue;
      const clock = [...vc[p][k]];
      if (e.kind === "recv" && m.from !== null) {
        const s = sendClock.get(e.msg)!;
        for (let i = 0; i < n; i++) clock[i] = Math.max(clock[i], s[i]);
      }
      clock[p] += 1;
      if (e.kind === "send") sendClock.set(e.msg, clock);
      vc[p].push(clock);
      done[p] += 1;
      progressed = true;
    }
  }
  if (done.some((d, p) => d !== trace.events[p].length)) throw new Error("trace has a receive before its send");
  return vc;
}

/** Babaoglu and Marzullo's test: c is consistent iff VC(frontier_j)[i] <= c_i for all i, j. */
export function vcConsistent(vc: number[][][], cut: Cut): boolean {
  for (let j = 0; j < cut.length; j++) {
    const f = vc[j][cut[j]];
    for (let i = 0; i < cut.length; i++) if (f[i] > cut[i]) return false;
  }
  return true;
}

/**
 * The largest consistent cut contained in `cut`. Consistent cuts are closed
 * under union and intersection, so it is unique: repeatedly move each
 * orphan's receiver back to just before the receive.
 */
export function largestConsistentWithin(trace: Trace, cut: Cut): Cut {
  const c = [...cut];
  for (;;) {
    const { orphans } = analyzeCut(trace, c);
    if (!orphans.length) return c;
    for (const i of orphans) {
      const to = trace.messages[i].to!;
      c[to[0]] = Math.min(c[to[0]], to[1] - 1);
    }
  }
}

/** Every cut of the window, as arrays, in lexicographic order. */
export function allCuts(trace: Trace): Cut[] {
  const out: Cut[] = [[]];
  for (const es of trace.events) {
    const next: Cut[] = [];
    for (const prefix of out) for (let k = 0; k <= es.length; k++) next.push([...prefix, k]);
    out.splice(0, out.length, ...next);
  }
  return out;
}

export const countConsistent = (trace: Trace): number => allCuts(trace).filter((c) => analyzeCut(trace, c).consistent).length;
