// Schedule analysis for the transactions note, free of the DOM.
//
// A schedule is a list of steps in the notation of Berenson et al. (1995),
// "A Critique of ANSI SQL Isolation Levels": r1[x], w1[x], c1, a1. The same
// Step type as the MVCC figure, so a schedule can also be run through that
// figure's model of PostgreSQL.
//
// - conflictGraph / findCycle: the precedence graph of the committed
//   transactions and a cycle in it if there is one (Bernstein, Hadzilacos and
//   Goodman 1987, ch. 2).
// - phenomena: which of the Critique's patterns (P0, P1, A1, P2, A2, P4, A5A,
//   A5B) occur in the schedule as written.
// - ansiPermits: the locking levels of the Critique's Table 4 that admit a
//   schedule with those phenomena.
// - strict2pl: a strict two-phase-locking scheduler run over the schedule:
//   shared locks to read, exclusive to write, all held to commit or abort,
//   blocked steps queued, and the requester that closes a waits-for cycle
//   aborted.
// - serialOrder: brute force over serial orders of the committed transactions
//   for one that reads the same values and leaves the same final state.

import type { Step } from "../mvcc-lab/model";
export type { Step };

export type Edge = { from: number; to: number; kind: "ww" | "wr" | "rw"; key: string; at: [number, number] };

const isRW = (s: Step) => s.op === "r" || s.op === "w";

export function txns(steps: Step[]): number[] {
  return [...new Set(steps.map((s) => s.t))].sort((a, b) => a - b);
}

/** Index of the step that ends transaction t (its commit or abort), or Infinity. */
export function endOf(steps: Step[], t: number): number {
  const i = steps.findIndex((s) => s.t === t && (s.op === "c" || s.op === "a"));
  return i < 0 ? Infinity : i;
}

export function committed(steps: Step[]): number[] {
  return txns(steps).filter((t) => steps.some((s) => s.t === t && s.op === "c"));
}

/** Conflict edges among the committed transactions, one per ordered pair of conflicting steps. */
export function conflictGraph(steps: Step[]): Edge[] {
  const keep = new Set(committed(steps));
  const out: Edge[] = [];
  for (let i = 0; i < steps.length; i++) {
    for (let j = i + 1; j < steps.length; j++) {
      const a = steps[i], b = steps[j];
      if (!isRW(a) || !isRW(b) || a.t === b.t || a.key !== b.key) continue;
      if (!keep.has(a.t) || !keep.has(b.t)) continue;
      if (a.op === "r" && b.op === "r") continue;
      const kind = a.op === "w" && b.op === "w" ? "ww" : a.op === "w" ? "wr" : "rw";
      out.push({ from: a.t, to: b.t, kind, key: a.key!, at: [i, j] });
    }
  }
  return out;
}

/** A cycle of transactions (first repeated at the end), or null if the graph is acyclic. */
export function findCycle(nodes: number[], edges: Edge[]): number[] | null {
  const adj = new Map<number, number[]>(nodes.map((n) => [n, []]));
  for (const e of edges) if (!adj.get(e.from)!.includes(e.to)) adj.get(e.from)!.push(e.to);
  const color = new Map<number, 0 | 1 | 2>(nodes.map((n) => [n, 0]));
  const stack: number[] = [];
  let found: number[] | null = null;
  const dfs = (u: number) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u)!) {
      if (found) return;
      if (color.get(v) === 1) {
        found = [...stack.slice(stack.indexOf(v)), v];
        return;
      }
      if (color.get(v) === 0) dfs(v);
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const n of nodes) if (!found && color.get(n) === 0) dfs(n);
  return found;
}

/** A topological order of the graph (the equivalent serial order), or null. */
export function topoOrder(nodes: number[], edges: Edge[]): number[] | null {
  const indeg = new Map(nodes.map((n) => [n, 0]));
  const seen = new Set<string>();
  const adj = new Map<number, number[]>(nodes.map((n) => [n, []]));
  for (const e of edges) {
    const k = `${e.from}>${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  const ready = nodes.filter((n) => indeg.get(n) === 0);
  const out: number[] = [];
  while (ready.length) {
    ready.sort((a, b) => a - b);
    const u = ready.shift()!;
    out.push(u);
    for (const v of adj.get(u)!) {
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) ready.push(v);
    }
  }
  return out.length === nodes.length ? out : null;
}

// --- The Critique's phenomena ------------------------------------------------

export type PhenomenonId = "P0" | "P1" | "A1" | "P2" | "A2" | "P4" | "A5A" | "A5B";

export interface Phenomenon {
  id: PhenomenonId;
  name: string;
  pattern: string;
  /** Indices of the steps of the first match, or null if the schedule has none. */
  match: number[] | null;
}

export const PHENOMENA: { id: PhenomenonId; name: string; pattern: string }[] = [
  { id: "P0", name: "dirty write", pattern: "w1[x] … w2[x] … (c1 or a1)" },
  { id: "P1", name: "dirty read", pattern: "w1[x] … r2[x] … (c1 or a1)" },
  { id: "A1", name: "dirty read, strict", pattern: "w1[x] … r2[x] … (a1 and c2)" },
  { id: "P2", name: "fuzzy read", pattern: "r1[x] … w2[x] … (c1 or a1)" },
  { id: "A2", name: "fuzzy read, strict", pattern: "r1[x] … w2[x] … c2 … r1[x] … c1" },
  { id: "P4", name: "lost update", pattern: "r1[x] … w2[x] … w1[x] … c1" },
  { id: "A5A", name: "read skew", pattern: "r1[x] … w2[x] … w2[y] … c2 … r1[y]" },
  { id: "A5B", name: "write skew", pattern: "r1[x] … r2[y] … w1[y] … w2[x] … (c1 and c2)" },
];

function opsOf(steps: Step[], op: "r" | "w") {
  return steps.map((s, i) => ({ s, i })).filter((x) => x.s.op === op);
}
const ends = (steps: Step[], t: number, op: "c" | "a") => steps.findIndex((s) => s.t === t && s.op === op);

function match(steps: Step[], id: PhenomenonId): number[] | null {
  const R = opsOf(steps, "r"), W = opsOf(steps, "w");
  const end = (t: number) => endOf(steps, t);
  const c = (t: number) => ends(steps, t, "c");
  const a = (t: number) => ends(steps, t, "a");
  switch (id) {
    case "P0":
      for (const w1 of W) for (const w2 of W)
        if (w2.i > w1.i && w2.s.t !== w1.s.t && w2.s.key === w1.s.key && w2.i < end(w1.s.t)) return [w1.i, w2.i];
      return null;
    case "P1":
    case "A1":
      for (const w1 of W) for (const r2 of R) {
        if (r2.i <= w1.i || r2.s.t === w1.s.t || r2.s.key !== w1.s.key || r2.i > end(w1.s.t)) continue;
        if (id === "P1") return [w1.i, r2.i];
        if (a(w1.s.t) > r2.i && c(r2.s.t) > r2.i) return [w1.i, r2.i, a(w1.s.t), c(r2.s.t)];
      }
      return null;
    case "P2":
    case "A2":
      for (const r1 of R) for (const w2 of W) {
        if (w2.i <= r1.i || w2.s.t === r1.s.t || w2.s.key !== r1.s.key || w2.i > end(r1.s.t)) continue;
        if (id === "P2") return [r1.i, w2.i];
        const c2 = c(w2.s.t);
        if (c2 < w2.i) continue;
        const again = R.find((x) => x.i > c2 && x.s.t === r1.s.t && x.s.key === r1.s.key);
        if (again && c(r1.s.t) > again.i) return [r1.i, w2.i, c2, again.i, c(r1.s.t)];
      }
      return null;
    case "P4":
      for (const r1 of R) for (const w2 of W) {
        if (w2.i <= r1.i || w2.s.t === r1.s.t || w2.s.key !== r1.s.key) continue;
        const w1 = W.find((x) => x.i > w2.i && x.s.t === r1.s.t && x.s.key === r1.s.key);
        if (w1 && c(r1.s.t) > w1.i) return [r1.i, w2.i, w1.i, c(r1.s.t)];
      }
      return null;
    case "A5A":
      for (const r1 of R) for (const w2 of W) {
        if (w2.i <= r1.i || w2.s.t === r1.s.t || w2.s.key !== r1.s.key) continue;
        for (const w2y of W) {
          if (w2y.s.t !== w2.s.t || w2y.s.key === r1.s.key || w2y.i <= r1.i) continue;
          const c2 = c(w2.s.t);
          if (c2 < Math.max(w2.i, w2y.i)) continue;
          const r1y = R.find((x) => x.i > c2 && x.s.t === r1.s.t && x.s.key === w2y.s.key);
          if (r1y && end(r1.s.t) > r1y.i && end(r1.s.t) < Infinity) return [r1.i, w2.i, w2y.i, c2, r1y.i];
        }
      }
      return null;
    case "A5B":
      for (const r1 of R) for (const r2 of R) {
        if (r2.i <= r1.i || r2.s.t === r1.s.t || r2.s.key === r1.s.key) continue;
        const w1 = W.find((x) => x.i > r2.i && x.s.t === r1.s.t && x.s.key === r2.s.key);
        if (!w1) continue;
        const w2 = W.find((x) => x.i > w1.i && x.s.t === r2.s.t && x.s.key === r1.s.key);
        if (w2 && c(r1.s.t) >= 0 && c(r2.s.t) >= 0) return [r1.i, r2.i, w1.i, w2.i];
      }
      return null;
  }
}

export function phenomena(steps: Step[]): Phenomenon[] {
  return PHENOMENA.map((p) => ({ ...p, match: match(steps, p.id) }));
}

/** The Critique's Table 4 locking levels and the broad phenomena each excludes. */
export const ANSI: { level: string; excludes: PhenomenonId[] }[] = [
  { level: "Read uncommitted", excludes: ["P0"] },
  { level: "Read committed", excludes: ["P0", "P1"] },
  { level: "Repeatable read", excludes: ["P0", "P1", "P2"] },
  { level: "Serializable", excludes: ["P0", "P1", "P2"] },
];

export function ansiPermits(ph: Phenomenon[]): { level: string; permits: boolean; because: PhenomenonId[] }[] {
  const present = new Set(ph.filter((p) => p.match).map((p) => p.id));
  return ANSI.map((l) => {
    const because = l.excludes.filter((id) => present.has(id));
    return { level: l.level, permits: because.length === 0, because };
  });
}

// --- Outcomes ----------------------------------------------------------------

export interface StepOutcome {
  kind: "ok" | "blocked" | "error" | "skipped";
  /** Value read, or value written. */
  value?: number;
  /** For a step that waited: the index of the issued step after which it ran. */
  releasedAt?: number;
  /** For an error: a short code and message. */
  code?: string;
  message?: string;
}

export interface Outcome {
  steps: StepOutcome[];
  final: Record<string, number>;
  committed: number[];
}

/**
 * A serial order of the outcome's committed transactions that reads the same
 * values and leaves the same final state, or null if none does.
 */
export function serialOrder(init: Record<string, number>, steps: Step[], out: Outcome): number[] | null {
  const reads = new Map<number, number[]>();
  steps.forEach((s, i) => {
    if (s.op !== "r" || out.steps[i].kind === "skipped" || out.steps[i].kind === "error") return;
    if (out.steps[i].value === undefined) return;
    if (!reads.has(s.t)) reads.set(s.t, []);
    reads.get(s.t)!.push(out.steps[i].value!);
  });
  for (const order of permutations(out.committed)) {
    const db = { ...init };
    let ok = true;
    for (const t of order) {
      const last: Record<string, number> = {};
      const rs = reads.get(t) ?? [];
      let ri = 0;
      for (const s of steps.filter((x) => x.t === t)) {
        if (s.op === "r") {
          if (db[s.key!] !== rs[ri++]) ok = false;
          last[s.key!] = db[s.key!];
        } else if (s.op === "w") {
          db[s.key!] = s.set !== undefined ? s.set : (last[s.key!] ?? db[s.key!]) + (s.add ?? 0);
          last[s.key!] = db[s.key!];
        }
      }
      if (!ok) break;
    }
    if (ok && Object.keys(out.final).every((k) => db[k] === out.final[k])) return order;
  }
  return null;
}

export function* permutations(xs: number[]): Generator<number[]> {
  if (xs.length <= 1) {
    yield [...xs];
    return;
  }
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) yield [xs[i], ...p];
  }
}

// --- Strict two-phase locking --------------------------------------------------

interface Lock { s: Set<number>; x: number | null }

export interface TwoPLRun extends Outcome {
  /** Indices of the schedule's steps in the order the scheduler executed them. */
  executed: number[];
  /** Transactions aborted as deadlock victims. */
  victims: number[];
}

/**
 * Runs the schedule through a strict 2PL scheduler. Steps are issued in
 * schedule order; a step whose transaction is waiting queues behind it. A
 * transaction that would wait on a transaction already waiting for it (a
 * cycle in the waits-for graph) is aborted, as the deadlock victim.
 */
export function strict2pl(init: Record<string, number>, steps: Step[]): TwoPLRun {
  const db: Record<string, number> = { ...init };
  const locks = new Map<string, Lock>();
  const lock = (k: string) => locks.get(k) ?? (locks.set(k, { s: new Set(), x: null }), locks.get(k)!);
  const T = txns(steps);
  const status = new Map<number, "active" | "blocked" | "committed" | "aborted">(T.map((t) => [t, "active"]));
  const waitsFor = new Map<number, number[]>();
  const queue = new Map<number, number[]>(T.map((t) => [t, []]));
  const undo = new Map<number, { key: string; old: number }[]>(T.map((t) => [t, []]));
  const last = new Map<number, Record<string, number>>(T.map((t) => [t, {}]));
  const res: StepOutcome[] = steps.map(() => ({ kind: "skipped" }));
  const executed: number[] = [];
  const victims: number[] = [];
  let issued = -1;

  const blockers = (t: number, s: Step): number[] => {
    if (s.op !== "r" && s.op !== "w") return [];
    const l = lock(s.key!);
    if (s.op === "r") return l.x !== null && l.x !== t ? [l.x] : [];
    const out = [...l.s].filter((u) => u !== t);
    if (l.x !== null && l.x !== t) out.push(l.x);
    return out;
  };
  const reaches = (from: number, target: number, seen = new Set<number>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (waitsFor.get(from) ?? []).some((u) => reaches(u, target, seen));
  };
  const release = (t: number) => {
    for (const l of locks.values()) {
      l.s.delete(t);
      if (l.x === t) l.x = null;
    }
    waitsFor.delete(t);
  };
  const abort = (t: number, at: number, code: string, message: string) => {
    for (const u of undo.get(t)!.reverse()) db[u.key] = u.old;
    res[at] = { kind: "error", code, message, ...(res[at].kind === "blocked" ? { releasedAt: issued } : {}) };
    for (const i of queue.get(t)!.slice(1)) res[i] = { kind: "skipped" };
    queue.set(t, []);
    status.set(t, "aborted");
    release(t);
  };
  /** Try to run t's queued steps; returns true if anything ran. */
  const pump = (t: number): boolean => {
    let ran = false;
    while (queue.get(t)!.length && (status.get(t) === "active" || status.get(t) === "blocked")) {
      const i = queue.get(t)![0];
      const s = steps[i];
      const wasBlocked = res[i].kind === "blocked";
      const b = blockers(t, s);
      if (b.length) {
        if (b.some((u) => reaches(u, t))) {
          victims.push(t);
          abort(t, i, "deadlock", "deadlock: aborted as the victim");
          return true;
        }
        waitsFor.set(t, b);
        status.set(t, "blocked");
        if (!wasBlocked) res[i] = { kind: "blocked" };
        return ran;
      }
      waitsFor.delete(t);
      status.set(t, "active");
      queue.get(t)!.shift();
      executed.push(i);
      ran = true;
      const extra = i < issued ? { releasedAt: issued } : {};
      if (s.op === "r") {
        lock(s.key!).s.add(t);
        last.get(t)![s.key!] = db[s.key!];
        res[i] = { kind: "ok", value: db[s.key!], ...extra };
      } else if (s.op === "w") {
        const l = lock(s.key!);
        l.x = t;
        l.s.delete(t);
        const prev = last.get(t)![s.key!] ?? db[s.key!];
        const v = s.set !== undefined ? s.set : prev + (s.add ?? 0);
        undo.get(t)!.push({ key: s.key!, old: db[s.key!] });
        db[s.key!] = v;
        last.get(t)![s.key!] = v;
        res[i] = { kind: "ok", value: v, ...extra };
      } else if (s.op === "c") {
        status.set(t, "committed");
        res[i] = { kind: "ok", ...extra };
        release(t);
      } else {
        for (const u of undo.get(t)!.reverse()) db[u.key] = u.old;
        status.set(t, "aborted");
        res[i] = { kind: "ok", ...extra };
        release(t);
      }
    }
    return ran;
  };

  for (let i = 0; i < steps.length; i++) {
    issued = i;
    const t = steps[i].t;
    if (status.get(t) === "committed" || status.get(t) === "aborted") continue;
    queue.get(t)!.push(i);
    if (status.get(t) === "blocked") continue;
    pump(t);
    // Locks released by a commit or abort may unblock others, in turn.
    let progress = true;
    while (progress) {
      progress = false;
      for (const u of T) if (status.get(u) === "blocked" && pump(u)) progress = true;
    }
  }
  // Anything still waiting at the end waits forever on a transaction that never ends.
  return {
    steps: res,
    final: db,
    committed: T.filter((t) => status.get(t) === "committed"),
    executed,
    victims,
  };
}
