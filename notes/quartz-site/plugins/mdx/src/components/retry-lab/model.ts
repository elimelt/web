// Retry lab model: one call made by a client that retransmits on timeout over
// a channel that drops each request with probability q and each reply with
// probability r, independently. The server either executes every request that
// arrives (at least once) or executes the first and answers later copies from
// a table of replies (at most once).
//
// Each send has three outcomes:
//   lost     the request is dropped                      prob q
//   orphan   the request executes, the reply is dropped  prob (1 - q) r
//   success  the request executes, the reply arrives     prob (1 - q)(1 - r)
// The client stops at the first success or after `sends` sends. The model
// assumes the timeout exceeds the round-trip time, so no reply arrives late.

export type Mode = "alo" | "amo";

export interface Params {
  q: number;
  r: number;
  sends: number;
  mode: Mode;
}

/** Number of execution bins shown: 0, 1, 2, 3 and "4 or more". */
export const BINS = 5;

export interface Dist {
  /** P(the server executed the call k times and the caller received a reply), k binned. */
  ok: number[];
  /** P(the server executed the call k times and the caller gave up), k binned. */
  fail: number[];
  /** P(caller receives a reply). */
  pOk: number;
  /** P(two or more executions). */
  pDup: number;
  /** P(caller gave up although the call executed at least once). */
  pFailExecuted: number;
  /** P(caller gave up and the call never executed). */
  pFailNone: number;
  /** Expected executions per call. */
  meanExec: number;
  /** Expected sends per call. */
  meanSends: number;
}

const bin = (k: number): number => Math.min(k, BINS - 1);

export function stepProbs(q: number, r: number): { lost: number; orphan: number; success: number } {
  return { lost: q, orphan: (1 - q) * r, success: (1 - q) * (1 - r) };
}

/**
 * Exact distribution of executions by dynamic programming over sends. Under
 * at most once every k >= 1 collapses to one execution, because later copies
 * are answered from the table and the outcome of each send is unchanged.
 */
export function distribution(p: Params): Dist {
  const { lost, orphan, success } = stepProbs(p.q, p.r);
  const n = Math.max(1, Math.floor(p.sends));
  // pending[k] = P(no success yet after i sends, k executions so far)
  let pending = new Array<number>(n + 1).fill(0);
  pending[0] = 1;
  const okK = new Array<number>(n + 1).fill(0);
  let meanSends = 0;
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(n + 1).fill(0);
    for (let k = 0; k <= i; k++) {
      const m = pending[k];
      if (m === 0) continue;
      meanSends += m; // send number i + 1 happens
      okK[k + 1] += m * success;
      next[k] += m * lost;
      next[k + 1] += m * orphan;
    }
    pending = next;
  }
  const ok = new Array<number>(BINS).fill(0);
  const fail = new Array<number>(BINS).fill(0);
  const execs = (k: number): number => (p.mode === "amo" ? Math.min(k, 1) : k);
  let meanExec = 0;
  for (let k = 0; k <= n; k++) {
    ok[bin(execs(k))] += okK[k];
    fail[bin(execs(k))] += pending[k];
    meanExec += execs(k) * (okK[k] + pending[k]);
  }
  const pOk = ok.reduce((a, b) => a + b, 0);
  let pDup = 0;
  for (let b = 2; b < BINS; b++) pDup += ok[b] + fail[b];
  return {
    ok,
    fail,
    pOk,
    pDup,
    pFailExecuted: 1 - pOk - fail[0],
    pFailNone: fail[0],
    meanExec,
    meanSends,
  };
}

export type SendOutcome = "lost" | "orphan" | "success";

export interface Send {
  outcome: SendOutcome;
  /** True if this copy ran the procedure (false for a lost request or an at-most-once replay). */
  executed: boolean;
  /** True if an at-most-once server answered this copy from its table. */
  replayed: boolean;
}

export interface Trace {
  sends: Send[];
  ok: boolean;
  executions: number;
}

/** One sampled call, for the space-time diagram. `u` yields uniforms in [0, 1). */
export function sampleCall(p: Params, u: () => number): Trace {
  const { lost, orphan } = stepProbs(p.q, p.r);
  const sends: Send[] = [];
  let executions = 0;
  let delivered = 0;
  let ok = false;
  for (let i = 0; i < Math.max(1, Math.floor(p.sends)) && !ok; i++) {
    const x = u();
    const outcome: SendOutcome = x < lost ? "lost" : x < lost + orphan ? "orphan" : "success";
    let executed = false;
    let replayed = false;
    if (outcome !== "lost") {
      delivered++;
      if (p.mode === "alo" || delivered === 1) {
        executed = true;
        executions++;
      } else {
        replayed = true;
      }
    }
    sends.push({ outcome, executed, replayed });
    if (outcome === "success") ok = true;
  }
  return { sends, ok, executions };
}

/** Values the loss sliders step through: the settings that were measured. */
export const LOSS_STEPS = [0, 0.01, 0.05, 0.1, 0.2, 0.3, 0.5];
export const MEASURED_SENDS = 4;
