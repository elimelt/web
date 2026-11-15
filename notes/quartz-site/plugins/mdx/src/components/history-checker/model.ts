// Consistency checkers for histories of one read/write register, free of the
// DOM. The same definitions as consistency-experiments/checkers.py beside the
// consistency note, written again here; the test runs both on the same
// histories and on brute force.
//
// An operation has a process, a kind, a value (written, or returned by the
// read) and a closed interval [call, ret]. Written values are unique and
// differ from the initial value 0. Interval endpoints are numbers; a process
// runs one operation at a time, so its operations never overlap.

export type Kind = "w" | "r";

export interface Op {
  id: string;
  p: number;
  kind: Kind;
  v: number;
  call: number;
  ret: number;
}

export type Model = "linearizable" | "sequential" | "causal";
export const MODELS: Model[] = ["linearizable", "sequential", "causal"];
export const INIT = 0;

function legalValues(ops: Op[]): boolean {
  const written = new Set(ops.filter((o) => o.kind === "w").map((o) => o.v));
  return ops.every((o) => o.kind === "w" || o.v === INIT || written.has(o.v));
}

/**
 * Herlihy and Wing's linearizability, decided by Wing and Gong's search with
 * Lowe's cache of explored (linearized set, register value) configurations.
 * Returns a linearization (indices into ops) or null.
 */
export function linearize(ops: Op[]): number[] | null {
  const n = ops.length;
  if (!legalValues(ops)) return null;
  const seen = new Set<string>();
  const done = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const search = (count: number, value: number): boolean => {
    if (count === n) return true;
    const key = `${done.map((d) => (d ? 1 : 0)).join("")}:${value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    let earliest = Infinity;
    for (let i = 0; i < n; i++) if (!done[i]) earliest = Math.min(earliest, ops[i].ret);
    for (let i = 0; i < n; i++) {
      // Only an operation called no later than every pending return can go next.
      if (done[i] || ops[i].call > earliest) continue;
      const op = ops[i];
      if (op.kind === "r" && op.v !== value) continue;
      done[i] = true;
      order.push(i);
      if (search(count + 1, op.kind === "w" ? op.v : value)) return true;
      order.pop();
      done[i] = false;
    }
    return false;
  };
  return search(0, INIT) ? order : null;
}

/** Each process's operation indices in invocation order. */
export function programOrder(ops: Op[]): number[][] {
  const by = new Map<number, number[]>();
  ops.forEach((o, i) => {
    if (!by.has(o.p)) by.set(o.p, []);
    by.get(o.p)!.push(i);
  });
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, ix]) => ix.sort((a, b) => ops[a].call - ops[b].call));
}

/**
 * Lamport's sequential consistency. For one register a configuration is the
 * position reached in each process's program and the register's value, so a
 * memoized search over configurations decides it. Returns a sequential order
 * or null.
 */
export function serialize(ops: Op[]): number[] | null {
  if (!legalValues(ops)) return null;
  const seqs = programOrder(ops);
  const pos = seqs.map(() => 0);
  const seen = new Set<string>();
  const order: number[] = [];
  const search = (left: number, value: number): boolean => {
    if (left === 0) return true;
    const key = `${pos.join(",")}:${value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    for (let q = 0; q < seqs.length; q++) {
      if (pos[q] === seqs[q].length) continue;
      const i = seqs[q][pos[q]];
      const op = ops[i];
      if (op.kind === "r" && op.v !== value) continue;
      pos[q]++;
      order.push(i);
      if (search(left - 1, op.kind === "w" ? op.v : value)) return true;
      order.pop();
      pos[q]--;
    }
    return false;
  };
  return search(ops.length, INIT) ? order : null;
}

/**
 * Causal order: the transitive closure of program order and writes-into.
 * before[i][j] is true when operation j is causally before operation i.
 * Null if the relation has a cycle.
 */
export function causalOrder(ops: Op[]): boolean[][] | null {
  const n = ops.length;
  const before = ops.map(() => new Array<boolean>(n).fill(false));
  for (const seq of programOrder(ops)) for (let k = 1; k < seq.length; k++) before[seq[k]][seq[k - 1]] = true;
  const writer = new Map<number, number>();
  ops.forEach((o, i) => o.kind === "w" && writer.set(o.v, i));
  ops.forEach((o, i) => {
    if (o.kind === "r" && o.v !== INIT && writer.has(o.v)) before[i][writer.get(o.v)!] = true;
  });
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++) if (before[i][k]) for (let j = 0; j < n; j++) if (before[k][j]) before[i][j] = true;
  for (let i = 0; i < n; i++) if (before[i][i]) return null;
  return before;
}

/**
 * Causal memory (Ahamad et al. 1995): for every process p, p's operations and
 * all writes have a legal order that respects causal order. Returns each
 * process's order, keyed by process, or null.
 */
export function causalViews(ops: Op[]): Map<number, number[]> | null {
  if (!legalValues(ops)) return null;
  const before = causalOrder(ops);
  if (!before) return null;
  const views = new Map<number, number[]>();
  const procs = [...new Set(ops.map((o) => o.p))].sort((a, b) => a - b);
  for (const p of procs) {
    const members = ops.map((_, i) => i).filter((i) => ops[i].kind === "w" || ops[i].p === p);
    const inView = new Set(members);
    const placed = new Array<boolean>(ops.length).fill(false);
    const seen = new Set<string>();
    const order: number[] = [];
    const search = (count: number, value: number): boolean => {
      if (count === members.length) return true;
      const key = `${members.map((i) => (placed[i] ? 1 : 0)).join("")}:${value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      for (const i of members) {
        if (placed[i]) continue;
        if (members.some((j) => inView.has(j) && before[i][j] && !placed[j])) continue;
        const op = ops[i];
        if (op.kind === "r" && op.v !== value) continue;
        placed[i] = true;
        order.push(i);
        if (search(count + 1, op.kind === "w" ? op.v : value)) return true;
        order.pop();
        placed[i] = false;
      }
      return false;
    };
    if (!search(0, INIT)) return null;
    views.set(p, order);
  }
  return views;
}

export function admits(model: Model, ops: Op[]): boolean {
  if (model === "linearizable") return linearize(ops) !== null;
  if (model === "sequential") return serialize(ops) !== null;
  return causalViews(ops) !== null;
}

/**
 * A smallest-by-deletion sub-history that the model still rejects. Deleting a
 * write deletes the reads of its value too, so the sub-history stays closed
 * under writes-into; restricting a witness order of the whole history to such
 * a sub-history gives a witness for the sub-history, so its rejection
 * explains the whole history's. Returns operation ids in invocation order.
 */
export function minimalRejected(model: Model, ops: Op[]): string[] {
  let cur = ops;
  if (admits(model, cur)) return [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const op of cur) {
      const rest = cur.filter((o) => o !== op && !(op.kind === "w" && o.kind === "r" && o.v === op.v));
      if (!admits(model, rest)) {
        cur = rest;
        changed = true;
        break;
      }
    }
  }
  return [...cur].sort((a, b) => a.call - b.call).map((o) => o.id);
}

/**
 * Points in each operation's interval at which a linearization takes effect:
 * the k-th operation of the order takes effect at the latest invocation among
 * the first k. That point lies within the operation's interval, because an
 * operation invoked after another returned comes later in the order.
 */
export function linearizationPoints(ops: Op[], order: number[]): Map<string, number> {
  const points = new Map<string, number>();
  let t = -Infinity;
  for (const i of order) {
    t = Math.max(t, ops[i].call);
    points.set(ops[i].id, t);
  }
  return points;
}

export interface Verdict {
  model: Model;
  ok: boolean;
  /** A witness order of operation ids when ok (for causal, process 1's view). */
  order: string[];
  /** The minimal rejected sub-history when not ok. */
  core: string[];
}

export function verdicts(ops: Op[]): Verdict[] {
  const ids = (ix: number[]) => ix.map((i) => ops[i].id);
  const lin = linearize(ops);
  const sc = serialize(ops);
  const cc = causalViews(ops);
  const firstView = cc ? (cc.values().next().value as number[] | undefined) ?? [] : [];
  return [
    { model: "linearizable", ok: !!lin, order: lin ? ids(lin) : [], core: lin ? [] : minimalRejected("linearizable", ops) },
    { model: "sequential", ok: !!sc, order: sc ? ids(sc) : [], core: sc ? [] : minimalRejected("sequential", ops) },
    { model: "causal", ok: !!cc, order: ids(firstView), core: cc ? [] : minimalRejected("causal", ops) },
  ];
}

// ---- Editing, with each process's operations kept in order and apart.

export interface Axis {
  max: number;
  step: number;
  unit: string;
}

export interface Preset {
  label: string;
  procs: number;
  axis: Axis;
  ops: Op[];
}

const op = (id: string, p: number, kind: Kind, v: number, call: number, ret: number): Op => ({ id, p, kind, v, call, ret });

export const presets: Record<string, Preset> = {
  stale: {
    label: "Stale read",
    procs: 2,
    axis: { max: 20, step: 1, unit: "" },
    ops: [op("a", 0, "w", 1, 1, 7), op("b", 1, "r", 0, 9, 15)],
  },
  inversion: {
    label: "New, then old",
    procs: 3,
    axis: { max: 20, step: 1, unit: "" },
    ops: [op("a", 0, "w", 1, 1, 17), op("b", 1, "r", 1, 3, 7), op("c", 2, "r", 0, 9, 13)],
  },
  orders: {
    label: "Two orders of concurrent writes",
    procs: 2,
    axis: { max: 20, step: 1, unit: "" },
    ops: [op("a", 0, "w", 1, 1, 5), op("b", 0, "r", 2, 9, 13), op("c", 1, "w", 2, 2, 6), op("d", 1, "r", 1, 10, 14)],
  },
  causal: {
    label: "Effect before cause",
    procs: 3,
    axis: { max: 20, step: 1, unit: "" },
    ops: [
      op("a", 0, "w", 1, 1, 4),
      op("b", 1, "r", 1, 6, 9),
      op("c", 1, "w", 2, 10, 13),
      op("d", 2, "r", 2, 14, 16),
      op("e", 2, "r", 1, 17, 19),
    ],
  },
  // A minimal non-linearizable sub-history of history 8 of ser-sticky-d10-s1,
  // recorded from etcd 3.7.3 with serializable reads, each client on its own
  // member, and 10 ms between members (consistency-experiments); times in ms
  // from the start of the history, as recorded.
  etcd: {
    label: "Recorded from etcd",
    procs: 3,
    axis: { max: 56, step: 0.5, unit: " ms" },
    ops: [
      op("a", 0, "w", 101, 0.342, 43.976),
      op("b", 1, "w", 202, 3.527, 48.272),
      op("c", 2, "r", 202, 36.889, 37.124),
      op("d", 0, "r", 101, 45.765, 45.947),
      op("e", 1, "r", 202, 53.351, 53.579),
    ],
  },
};

export function cloneOps(ops: Op[]): Op[] {
  return ops.map((o) => ({ ...o }));
}

/** Values a read may be set to: the initial value and every written value. */
export function readChoices(ops: Op[]): number[] {
  return [INIT, ...ops.filter((o) => o.kind === "w").map((o) => o.v).sort((a, b) => a - b)];
}

/** The room an operation can move in without touching its process's neighbours. */
export function room(ops: Op[], id: string, axis: Axis): { lo: number; hi: number } {
  const me = ops.find((o) => o.id === id)!;
  let lo = 0;
  let hi = axis.max;
  for (const o of ops) {
    if (o.p !== me.p || o.id === id) continue;
    if (o.call < me.call) lo = Math.max(lo, o.ret + axis.step);
    else hi = Math.min(hi, o.call - axis.step);
  }
  return { lo, hi };
}

const snap = (t: number, step: number) => Math.round(t / step) * step;

/** Moves an operation by dt, kept inside the room its neighbours leave. */
export function move(ops: Op[], id: string, dt: number, axis: Axis): Op[] {
  const me = ops.find((o) => o.id === id);
  if (!me) return ops;
  const { lo, hi } = room(ops, id, axis);
  const len = me.ret - me.call;
  const call = Math.min(Math.max(snap(me.call + dt, axis.step), lo), hi - len);
  if (call < lo) return ops;
  return ops.map((o) => (o.id === id ? { ...o, call, ret: call + len } : o));
}

/** Moves one end of an operation; an interval keeps at least one step of length. */
export function stretch(ops: Op[], id: string, end: "call" | "ret", t: number, axis: Axis): Op[] {
  const me = ops.find((o) => o.id === id);
  if (!me) return ops;
  const { lo, hi } = room(ops, id, axis);
  const s = snap(t, axis.step);
  if (end === "call") {
    const call = Math.min(Math.max(s, lo), me.ret - axis.step);
    return ops.map((o) => (o.id === id ? { ...o, call } : o));
  }
  const ret = Math.max(Math.min(s, hi), me.call + axis.step);
  return ops.map((o) => (o.id === id ? { ...o, ret } : o));
}

/** Sets a read's value to the next of readChoices, cyclically. */
export function cycleRead(ops: Op[], id: string): Op[] {
  const choices = readChoices(ops);
  return ops.map((o) => {
    if (o.id !== id || o.kind !== "r") return o;
    const k = choices.indexOf(o.v);
    return { ...o, v: choices[(k + 1) % choices.length] };
  });
}

let fresh = 0;

/**
 * Adds an operation at the end of process p's line, or in the widest gap if
 * the end is full. A write gets the next unused value; a read returns the
 * latest written value. Returns null when the line has no room.
 */
export function add(ops: Op[], p: number, kind: Kind, axis: Axis): Op[] | null {
  const len = Math.max(axis.step, snap(axis.max / 6, axis.step));
  const mine = ops.filter((o) => o.p === p).sort((a, b) => a.call - b.call);
  const gaps: Array<[number, number]> = [];
  let start = 0;
  for (const o of mine) {
    gaps.push([start, o.call - axis.step]);
    start = o.ret + axis.step;
  }
  gaps.push([start, axis.max]);
  const gap = gaps.reverse().find(([a, b]) => b - a >= len) ?? gaps.sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
  if (!gap || gap[1] - gap[0] < axis.step) return null;
  const call = gap[0];
  const ret = Math.min(gap[1], call + len);
  const values = ops.filter((o) => o.kind === "w").map((o) => o.v);
  const v = kind === "w" ? Math.max(0, ...values) + 1 : values.length ? Math.max(...values) : INIT;
  let id: string;
  do id = `n${++fresh}`;
  while (ops.some((o) => o.id === id));
  return [...ops, { id, p, kind, v, call, ret }];
}

/** Removes an operation; reads of a removed write's value fall back to the initial value. */
export function remove(ops: Op[], id: string): Op[] {
  const me = ops.find((o) => o.id === id);
  if (!me) return ops;
  return ops
    .filter((o) => o.id !== id)
    .map((o) => (me.kind === "w" && o.kind === "r" && o.v === me.v ? { ...o, v: INIT } : o));
}

export function label(o: Op): string {
  return o.kind === "w" ? `w(${o.v})` : `r→${o.v}`;
}
