// A simulated hard disk serving 4 KiB random reads from a closed queue.
//
// The drive has one arm and a platter spinning at a fixed rate. Each request
// names a radial position r in [0, 1) (0 = outer edge, 1 = inner edge) and an
// angular position a in [0, 1) (fraction of a revolution). Serving a request
// costs a seek to its track, a rotational wait until its sector reaches the
// head, and a transfer. The queue is closed: Q requests are always
// outstanding, and each completion is replaced at once by a new request at a
// uniformly random position, which is what fio does at iodepth=Q with
// rw=randread. The scheduling policy picks which queued request to serve next.
//
// Drive parameters follow the Seagate Barracuda in OSTEP chapter 37 (7,200
// RPM, 9 ms average seek, 105 MB/s). The seek curve is the square-root form
// Ruemmler and Wilkes fit to short seeks, settle + (full - settle) * sqrt(d),
// with the full-stroke time chosen so the mean over uniform random pairs of
// tracks equals the 9 ms average (E[sqrt|x - y|] = 8/15 for x, y uniform).

import { mulberry32 } from "../../shared/random";

export type Policy = "fcfs" | "sstf" | "clook" | "sptf";
export const POLICIES: Policy[] = ["fcfs", "sstf", "clook", "sptf"];
export const POLICY_NAME: Record<Policy, string> = {
  fcfs: "FCFS",
  sstf: "SSTF",
  clook: "C-LOOK",
  sptf: "SPTF",
};

export interface Drive {
  rpm: number;
  avgSeekMs: number;
  settleMs: number;
  mbps: number; // sustained media rate, MB/s (10^6 bytes)
  blockBytes: number;
}

export const BARRACUDA: Drive = { rpm: 7200, avgSeekMs: 9, settleMs: 1, mbps: 105, blockBytes: 4096 };

export const revMs = (d: Drive) => 60000 / d.rpm;
export const fullSeekMs = (d: Drive) => d.settleMs + ((d.avgSeekMs - d.settleMs) * 15) / 8;
export const transferMs = (d: Drive) => (d.blockBytes / (d.mbps * 1e6)) * 1000;

export function seekMs(d: Drive, from: number, to: number): number {
  const dist = Math.abs(to - from);
  if (dist === 0) return 0;
  return d.settleMs + (fullSeekMs(d) - d.settleMs) * Math.sqrt(dist);
}

/** Rotational wait from time t (head angle t / rev mod 1) until angle a passes under the head. */
export function rotWaitMs(d: Drive, t: number, a: number): number {
  const rev = revMs(d);
  const head = (t / rev) % 1;
  let frac = a - head;
  frac -= Math.floor(frac);
  return frac * rev;
}

/** Closed-form expectation for one random request served alone (queue depth 1, any policy). */
export function expectedQd1Ms(d: Drive): { seek: number; rot: number; xfer: number; total: number } {
  const seek = d.avgSeekMs;
  const rot = revMs(d) / 2;
  const xfer = transferMs(d);
  return { seek, rot, xfer, total: seek + rot + xfer };
}

interface Req {
  id: number;
  r: number;
  a: number;
  arrive: number;
}

export interface Served {
  id: number;
  r: number;
  start: number; // the arm starts moving
  seekEnd: number;
  rotEnd: number;
  end: number; // transfer done
  arrive: number;
}

export interface Result {
  policy: Policy;
  qd: number;
  served: Served[]; // every request after warm-up, in service order
  startTrack: number; // the arm's track when the first measured request starts
  iops: number;
  meanSeek: number;
  meanRot: number;
  meanXfer: number;
  meanService: number;
  meanResponse: number;
  p99Response: number;
  maxResponse: number;
}

export interface SimOptions {
  policy: Policy;
  qd: number;
  n?: number; // requests measured after warm-up
  warmup?: number;
  seed?: number;
  drive?: Drive;
}

function pick(policy: Policy, d: Drive, queue: Req[], head: number, t: number): number {
  if (policy === "fcfs") {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].arrive < queue[best].arrive) best = i;
    return best;
  }
  if (policy === "sstf") {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < queue.length; i++) {
      const dist = Math.abs(queue[i].r - head);
      if (dist < bd) {
        bd = dist;
        best = i;
      }
    }
    return best;
  }
  if (policy === "clook") {
    // Sweep inward (increasing r); when nothing lies ahead, jump back to the outermost request.
    let ahead = -1;
    let lowest = 0;
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].r >= head && (ahead < 0 || queue[i].r < queue[ahead].r)) ahead = i;
      if (queue[i].r < queue[lowest].r) lowest = i;
    }
    return ahead >= 0 ? ahead : lowest;
  }
  // sptf: smallest seek + rotational wait, computed from the arm's position and the platter's angle now
  let best = 0;
  let bp = Infinity;
  for (let i = 0; i < queue.length; i++) {
    const s = seekMs(d, head, queue[i].r);
    const p = s + rotWaitMs(d, t + s, queue[i].a);
    if (p < bp) {
      bp = p;
      best = i;
    }
  }
  return best;
}

export function simulate(o: SimOptions): Result {
  const d = o.drive ?? BARRACUDA;
  const qd = Math.max(1, Math.round(o.qd));
  const n = o.n ?? 4000;
  const warmup = o.warmup ?? 400;
  const rnd = mulberry32(o.seed ?? 1);
  const xfer = transferMs(d);
  let nextId = 0;
  const fresh = (t: number): Req => ({ id: nextId++, r: rnd(), a: rnd(), arrive: t });
  let t = 0;
  let head = rnd();
  const queue: Req[] = [];
  for (let i = 0; i < qd; i++) queue.push(fresh(0));
  const served: Served[] = [];
  let startTrack = head;
  for (let k = 0; k < warmup + n; k++) {
    const i = pick(o.policy, d, queue, head, t);
    const q = queue[i];
    queue.splice(i, 1);
    const start = t;
    const seekEnd = start + seekMs(d, head, q.r);
    const rotEnd = seekEnd + rotWaitMs(d, seekEnd, q.a);
    const end = rotEnd + xfer;
    if (k === warmup) startTrack = head;
    if (k >= warmup) served.push({ id: q.id, r: q.r, start, seekEnd, rotEnd, end, arrive: q.arrive });
    head = q.r;
    t = end;
    queue.push(fresh(t));
  }
  const elapsed = served[served.length - 1].end - served[0].start;
  const resp = served.map((s) => s.end - s.arrive).sort((x, y) => x - y);
  const mean = (f: (s: Served) => number) => served.reduce((acc, s) => acc + f(s), 0) / served.length;
  return {
    policy: o.policy,
    qd,
    served,
    startTrack,
    iops: (served.length / elapsed) * 1000,
    meanSeek: mean((s) => s.seekEnd - s.start),
    meanRot: mean((s) => s.rotEnd - s.seekEnd),
    meanXfer: mean((s) => s.end - s.rotEnd),
    meanService: mean((s) => s.end - s.start),
    meanResponse: resp.reduce((a, b) => a + b, 0) / resp.length,
    p99Response: resp[Math.min(resp.length - 1, Math.floor(0.99 * resp.length))],
    maxResponse: resp[resp.length - 1],
  };
}

/** Queue depths the slider steps through. */
export const QDS = [1, 2, 4, 8, 16, 32, 64];
