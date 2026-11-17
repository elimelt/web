// Timing model of one request to a Raft or Multi-Paxos group with a stable
// leader, and the etcd measurements it is compared with.
//
// The leader appends a write to its own log (one fsync) while it sends the
// entry to every follower; each follower fsyncs and acknowledges. The entry
// commits once the leader and floor(N / 2) followers have it durably, so the
// commit time is an order statistic of the followers' acknowledgement times.
// A linearizable read confirms leadership with one heartbeat round to a
// quorum (ReadIndex) and needs no fsync. A serializable read is answered from
// the receiving member's own state. A request sent to a follower is forwarded
// to the leader, and the follower answers once it learns the commit.

import { MEASURED } from "./data";

export type Op = "put" | "get-linearizable" | "get-serializable";
export const OPS: Op[] = ["put", "get-linearizable", "get-serializable"];
export const OP_LABEL: Record<Op, string> = {
  put: "write",
  "get-linearizable": "linearizable read",
  "get-serializable": "serializable read",
};

export interface Setting {
  /** Round-trip time in ms from the leader (member 0) to each follower, members 1..N-1. */
  rtts: number[];
  /** down[i] for followers, members 1..N-1. */
  down: boolean[];
  op: Op;
  /** Member that receives the client's request; 0 is the leader. */
  via: number;
}

/**
 * Constants fitted to the etcd runs with no added delay (`sym3` at 0 ms), and
 * nothing else: the mean WAL fsync on the leader, and the remaining fixed cost
 * (gRPC, the proxy, apply) of each request type.
 */
export const CAL = MEASURED.calibration;

export type Kind = "forward" | "append" | "ack" | "heartbeat" | "hbAck" | "commit" | "index";
export interface Msg {
  from: number;
  to: number;
  t0: number;
  t1: number;
  kind: Kind;
}
export interface Disk {
  member: number;
  t0: number;
  t1: number;
}
export interface Outcome {
  msgs: Msg[];
  disks: Disk[];
  /** Time the leader starts work on the request (after any forwarding). */
  start: number;
  /** Time the leader commits the write or confirms its leadership; null without a quorum. */
  decided: number | null;
  /** Time the receiving member answers the client; null without a quorum. */
  done: number | null;
  /** Follower acknowledgements needed, floor(N / 2). */
  need: number;
  /** Followers whose acknowledgements decide, in order of arrival. */
  quorum: number[];
}

export const members = (s: Setting): number => s.rtts.length + 1;
/** Round trip between member m and the leader. */
export const rtt = (s: Setting, m: number): number => (m === 0 ? 0 : s.rtts[m - 1]);

/** The k-th smallest value (k from 1), or null if there are fewer than k. */
export function kth(values: number[], k: number): number | null {
  if (k <= 0) return -Infinity;
  if (values.length < k) return null;
  return [...values].sort((a, b) => a - b)[k - 1];
}

export function simulate(s: Setting): Outcome {
  const n = members(s);
  const need = Math.floor(n / 2);
  const live = s.rtts.map((_, i) => i + 1).filter((m) => !s.down[m - 1]);
  const msgs: Msg[] = [];
  const disks: Disk[] = [];
  const F = CAL.fsync;

  if (s.op === "get-serializable") {
    return { msgs, disks, start: 0, decided: 0, done: CAL.overhead[s.op], need, quorum: [] };
  }

  const v = s.via;
  const start = v === 0 ? 0 : rtt(s, v) / 2;
  if (v !== 0) msgs.push({ from: v, to: 0, t0: 0, t1: start, kind: "forward" });

  const arrivals: [number, number][] = [];
  if (s.op === "put") {
    disks.push({ member: 0, t0: start, t1: start + F });
    for (const m of live) {
      const at = start + rtt(s, m) / 2;
      msgs.push({ from: 0, to: m, t0: start, t1: at, kind: "append" });
      disks.push({ member: m, t0: at, t1: at + F });
      msgs.push({ from: m, to: 0, t0: at + F, t1: start + rtt(s, m) + F, kind: "ack" });
      arrivals.push([m, start + rtt(s, m) + F]);
    }
  } else {
    for (const m of live) {
      const at = start + rtt(s, m) / 2;
      msgs.push({ from: 0, to: m, t0: start, t1: at, kind: "heartbeat" });
      msgs.push({ from: m, to: 0, t0: at, t1: start + rtt(s, m), kind: "hbAck" });
      arrivals.push([m, start + rtt(s, m)]);
    }
  }
  arrivals.sort((a, b) => a[1] - b[1]);
  const k = kth(arrivals.map((a) => a[1]), need);
  if (k === null) return { msgs, disks, start, decided: null, done: null, need, quorum: [] };
  const quorum = arrivals.slice(0, need).map((a) => a[0]);
  const decided = Math.max(k, s.op === "put" ? start + F : start);
  let answer = decided;
  if (v !== 0) {
    answer = decided + rtt(s, v) / 2;
    msgs.push({ from: 0, to: v, t0: decided, t1: answer, kind: s.op === "put" ? "commit" : "index" });
  }
  return { msgs, disks, start, decided, done: answer + CAL.overhead[s.op], need, quorum };
}

/** Brute force: the earliest time at which some set of `need` live followers has all acknowledged. */
export function bruteDecided(s: Setting): number | null {
  const o = simulate({ ...s });
  const acks = o.msgs.filter((m) => m.kind === "ack" || m.kind === "hbAck").map((m) => m.t1);
  const need = o.need;
  if (need === 0) return s.op === "put" ? o.start + CAL.fsync : o.start;
  let best: number | null = null;
  const pick = (from: number, chosen: number[]) => {
    if (chosen.length === need) {
      const t = Math.max(...chosen, s.op === "put" ? o.start + CAL.fsync : o.start);
      if (best === null || t < best) best = t;
      return;
    }
    for (let i = from; i < acks.length; i++) pick(i + 1, [...chosen, acks[i]]);
  };
  pick(0, []);
  return best;
}

export interface Measured {
  /** Median, 25th and 75th percentile in ms, pooled over repetitions. */
  p50: number;
  p25: number;
  p75: number;
  p99: number;
  /** Lowest and highest per-repetition median. */
  lo: number;
  hi: number;
  n: number;
}

/** The measurement for this exact setting, if one was taken. */
export function measured(s: Setting): Measured | null {
  return measuredByKey(settingKey(s));
}

export function measuredByKey(key: string): Measured | null {
  return (MEASURED.points as Record<string, Measured>)[key] ?? null;
}

export { MEASURED };

export function settingKey(s: Setting): string {
  const downs = s.down.map((d, i) => (d ? i + 1 : 0)).filter((x) => x);
  return `${s.rtts.join(",")}|${downs.join(",")}|${s.op}|${s.via}`;
}

export interface Preset {
  setting: Setting;
  /** Which controls the figure shows. */
  controls: "fail" | "rtt-op" | "via";
  rttChoices?: number[];
}

export const RTT_CHOICES = [0, 1, 2, 5, 10, 20, 50];

export const PRESETS: Record<string, Preset> = {
  five: {
    setting: { rtts: [1, 3, 10, 30], down: [false, false, false, false], op: "put", via: 0 },
    controls: "fail",
  },
  reads: {
    setting: { rtts: [10, 10], down: [false, false], op: "put", via: 0 },
    controls: "rtt-op",
    rttChoices: RTT_CHOICES,
  },
  via: {
    setting: { rtts: [5, 20], down: [false, false], op: "put", via: 0 },
    controls: "via",
  },
};

export const presetKey = (p: unknown): string => (typeof p === "string" && p in PRESETS ? p : "five");
