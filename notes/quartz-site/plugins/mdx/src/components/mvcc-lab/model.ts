// A small multiversion store that follows PostgreSQL's rules closely enough to
// replay short interleavings of transactions and get the same answers
// PostgreSQL 16 gives: the same values read, the same writes blocked and
// released, and the same transactions failing with the same error.
//
// What it models:
// - Append-only versions, oldest to newest, each stamped with the creating
//   transaction's id (xmin) and the id of the transaction that replaced it
//   (xmax), as PostgreSQL's heap tuples are.
// - Snapshots as PostgreSQL takes them: xmin (oldest running xid), xmax (next
//   xid to be assigned) and the list of xids in progress. A transaction gets
//   an xid only when it first writes. READ COMMITTED takes a new snapshot for
//   every statement; REPEATABLE READ and SERIALIZABLE keep the first one.
// - Writes as UPDATE does them: find the version this statement can see,
//   wait if another transaction is replacing it, and then either update it,
//   follow it to the newest version (READ COMMITTED), or fail with "could not
//   serialize access due to concurrent update" (the two higher levels).
// - Deadlock detection on those waits.
// - Serializable snapshot isolation as src/backend/storage/lmgr/predicate.c
//   implements it: SIREAD locks on the versions a transaction read, rw-
//   conflicts flagged on read (conflict out) and on write (conflict in), the
//   dangerous-structure checks with PostgreSQL's commit-order rules, dooming
//   the pivot at commit, and the conflict clean-up when a transaction
//   commits.
//
// It leaves out what the figure's schedules never reach: inserts, deletes,
// predicate (range) locks, lock promotion to pages, subtransactions, and
// declared READ ONLY transactions.

export type Level = "rc" | "rr" | "ser";
export type Op = "r" | "w" | "c" | "a";

/** One step of a schedule. A write sets a value, or adds to what the transaction last read. */
export interface Step {
  op: Op;
  t: number;
  key?: string;
  set?: number;
  add?: number;
}

export interface Version {
  id: number;
  key: string;
  value: number;
  xmin: number;
  xmax: number | null;
}

export interface Snapshot {
  xmin: number;
  xmax: number;
  xip: number[];
  /** PostgreSQL's LastSxactCommitSeqNo when the snapshot was taken. */
  lastCommitBeforeSnapshot: number;
}

export type TxnStatus = "idle" | "active" | "blocked" | "committed" | "aborted";

export interface Failure {
  code: "40001" | "40P01";
  message: string;
  step: number;
}

export interface Txn {
  t: number;
  status: TxnStatus;
  xid: number | null;
  snap: Snapshot | null;
  reads: { key: string; value: number; version: number; step: number }[];
  last: Record<string, number>;
  wrote: boolean;
  failure: Failure | null;
  /** The transaction whose row lock this one waits for. */
  waitsFor: number | null;
  /** The step that is waiting, and the steps queued behind it. */
  queue: number[];
  /** The version a waiting UPDATE found and will retry. */
  target: number | null;
  // Serializable snapshot isolation state (predicate.c's SERIALIZABLEXACT).
  inC: number[];
  outC: number[];
  doomed: boolean;
  readOnly: boolean;
  conflictOut: boolean;
  earliestOutConflictCommit: number;
  prepareSeq: number;
  commitSeq: number;
  finishedBefore: number;
  sireads: number[];
}

export interface StepResult {
  /** Index into the schedule. */
  step: number;
  kind: "ok" | "blocked" | "error" | "skipped";
  value?: number;
  /** The step at which a blocked step finished, and how. */
  releasedAt?: number;
  releasedKind?: "ok" | "error";
  error?: Failure;
}

export interface State {
  level: Level;
  steps: Step[];
  /** How many steps have been issued. */
  done: number;
  versions: Version[];
  txns: Record<number, Txn>;
  clog: Record<number, "running" | "committed" | "aborted">;
  nextXid: number;
  seq: number;
  results: StepResult[];
  /** Short log lines for the step just issued, for the figure's caption. */
  notes: string[];
}

export const SETUP_XID = 100;
const FIRST_XID = 101;

export const MSG = {
  concurrent: "could not serialize access due to concurrent update",
  rw: "could not serialize access due to read/write dependencies among transactions",
  deadlock: "deadlock detected",
};

export function initial(init: Record<string, number>, steps: Step[], level: Level): State {
  const versions: Version[] = Object.keys(init).map((key, i) => ({ id: i, key, value: init[key], xmin: SETUP_XID, xmax: null }));
  const txns: Record<number, Txn> = {};
  for (const s of steps) {
    if (!txns[s.t]) txns[s.t] = newTxn(s.t);
  }
  return {
    level,
    steps,
    done: 0,
    versions,
    txns,
    clog: { [SETUP_XID]: "committed" },
    nextXid: FIRST_XID,
    seq: 0,
    results: [],
    notes: [],
  };
}

function newTxn(t: number): Txn {
  return {
    t,
    status: "idle",
    xid: null,
    snap: null,
    reads: [],
    last: {},
    wrote: false,
    failure: null,
    waitsFor: null,
    queue: [],
    target: null,
    inC: [],
    outC: [],
    doomed: false,
    readOnly: false,
    conflictOut: false,
    earliestOutConflictCommit: 0,
    prepareSeq: 0,
    commitSeq: 0,
    finishedBefore: 0,
    sireads: [],
  };
}

const clone = (s: State): State => structuredCloneState(s);

function structuredCloneState(s: State): State {
  const txns: Record<number, Txn> = {};
  for (const k of Object.keys(s.txns)) {
    const t = s.txns[+k];
    txns[+k] = {
      ...t,
      snap: t.snap ? { ...t.snap, xip: [...t.snap.xip] } : null,
      reads: t.reads.map((r) => ({ ...r })),
      last: { ...t.last },
      failure: t.failure ? { ...t.failure } : null,
      queue: [...t.queue],
      inC: [...t.inC],
      outC: [...t.outC],
      sireads: [...t.sireads],
    };
  }
  return {
    ...s,
    versions: s.versions.map((v) => ({ ...v })),
    txns,
    clog: { ...s.clog },
    results: s.results.map((r) => ({ ...r })),
    notes: [],
  };
}

// --- Snapshots and visibility -------------------------------------------

function running(s: State): number[] {
  return Object.keys(s.clog)
    .map(Number)
    .filter((x) => s.clog[x] === "running")
    .sort((a, b) => a - b);
}

function takeSnapshot(s: State): Snapshot {
  const xip = running(s);
  return { xmin: xip.length ? xip[0] : s.nextXid, xmax: s.nextXid, xip, lastCommitBeforeSnapshot: s.seq };
}

/** Whether a transaction id counts as committed for this snapshot. */
export function committedFor(s: State, xid: number, snap: Snapshot): boolean {
  if (xid >= snap.xmax || snap.xip.includes(xid)) return false;
  return s.clog[xid] === "committed";
}

export type Verdict =
  | { visible: true; why: "own" | "committed" | "deleter-running" | "deleter-aborted" | "deleter-later" }
  | { visible: false; why: "creator-running" | "creator-later" | "creator-aborted" | "deleted" | "own-replaced" };

/** PostgreSQL's MVCC visibility test for one version, with the reason. */
export function verdict(s: State, v: Version, me: Txn, snap: Snapshot): Verdict {
  if (me.xid !== null && v.xmin === me.xid) {
    return v.xmax === me.xid ? { visible: false, why: "own-replaced" } : { visible: true, why: "own" };
  }
  if (s.clog[v.xmin] === "aborted") return { visible: false, why: "creator-aborted" };
  if (!committedFor(s, v.xmin, snap)) {
    return { visible: false, why: v.xmin >= snap.xmax ? "creator-later" : "creator-running" };
  }
  if (v.xmax === null) return { visible: true, why: "committed" };
  if (me.xid !== null && v.xmax === me.xid) return { visible: false, why: "own-replaced" };
  if (s.clog[v.xmax] === "aborted") return { visible: true, why: "deleter-aborted" };
  if (committedFor(s, v.xmax, snap)) return { visible: false, why: "deleted" };
  return { visible: true, why: v.xmax >= snap.xmax ? "deleter-later" : "deleter-running" };
}

export const chain = (s: State, key: string): Version[] => s.versions.filter((v) => v.key === key);
export const keys = (s: State): string[] => [...new Set(s.versions.map((v) => v.key))];

function visibleVersion(s: State, me: Txn, snap: Snapshot, key: string): Version {
  // Oldest to newest, as PostgreSQL walks a HOT chain from its root.
  for (const v of chain(s, key)) {
    if (verdict(s, v, me, snap).visible) return v;
  }
  throw new Error(`no visible version of ${key}`);
}

const byXid = (s: State, xid: number | null): Txn | undefined =>
  xid === null ? undefined : Object.values(s.txns).find((t) => t.xid === xid);

function assignXid(s: State, me: Txn): number {
  if (me.xid === null) {
    me.xid = s.nextXid++;
    s.clog[me.xid] = "running";
  }
  return me.xid;
}

/** The snapshot a statement uses, taking a new one where the level calls for it. */
function statementSnapshot(s: State, me: Txn): Snapshot {
  if (s.level === "rc" || !me.snap) me.snap = takeSnapshot(s);
  return me.snap;
}

// --- Serializable snapshot isolation (predicate.c) ------------------------

class SerializationError extends Error {
  constructor(public code: "40001" | "40P01", message: string) {
    super(message);
  }
}

const committed = (t: Txn) => t.status === "committed";
const prepared = (t: Txn) => t.prepareSeq > 0;
const conflictExists = (r: Txn, w: Txn) => r.outC.includes(w.t);

function checkFailure(s: State, me: Txn, reader: Txn, writer: Txn): void {
  let failure = false;
  // R -> W -> T2, writer already committed with a conflict out to an earlier committer.
  if (committed(writer) && writer.conflictOut) failure = true;
  if (!failure) {
    for (const t2n of writer.outC) {
      const t2 = s.txns[t2n];
      if (
        prepared(t2) &&
        (!committed(reader) || t2.prepareSeq <= reader.commitSeq) &&
        (!committed(writer) || t2.prepareSeq <= writer.commitSeq) &&
        (!reader.readOnly || t2.prepareSeq <= (reader.snap?.lastCommitBeforeSnapshot ?? 0))
      ) {
        failure = true;
        break;
      }
    }
  }
  // T0 -> R -> W, the writer committed (or is committing) first.
  if (!failure && prepared(writer) && !reader.readOnly) {
    for (const t0n of reader.inC) {
      const t0 = s.txns[t0n];
      if (
        !t0.doomed &&
        (!committed(t0) || t0.commitSeq >= writer.prepareSeq) &&
        (!t0.readOnly || (t0.snap?.lastCommitBeforeSnapshot ?? 0) >= writer.prepareSeq)
      ) {
        failure = true;
        break;
      }
    }
  }
  if (!failure) return;
  if (me === writer) throw new SerializationError("40001", MSG.rw);
  if (prepared(writer)) throw new SerializationError("40001", MSG.rw);
  writer.doomed = true;
  s.notes.push(`T${writer.t} is marked to fail: it is the pivot of a dangerous structure.`);
}

function flagConflict(s: State, me: Txn, reader: Txn, writer: Txn): void {
  checkFailure(s, me, reader, writer);
  reader.outC.push(writer.t);
  writer.inC.push(reader.t);
  s.notes.push(`SSI records an rw-conflict T${reader.t} → T${writer.t}.`);
}

/** Reading version v: a concurrent transaction replaced it, so we come before that one. */
function conflictOut(s: State, me: Txn, snap: Snapshot, v: Version): void {
  if (v.xmax === null || v.xmax === me.xid || s.clog[v.xmax] === "aborted") return;
  const w = byXid(s, v.xmax);
  if (!w || w === me || w.doomed) return;
  // The write is in our snapshot: no conflict.
  if (!(v.xmax >= snap.xmax || snap.xip.includes(v.xmax))) return;
  if (conflictExists(me, w)) return;
  flagConflict(s, me, me, w);
}

/** Writing a new version over v: everyone who read v and overlaps us comes before us. */
function conflictIn(s: State, me: Txn, snap: Snapshot, v: Version): void {
  for (const r of Object.values(s.txns)) {
    if (r === me || !r.sireads.includes(v.id)) continue;
    if (r.doomed) continue;
    if (committed(r) && !(snap.xmin < r.finishedBefore)) continue;
    if (conflictExists(r, me)) continue;
    flagConflict(s, me, r, me);
  }
  // Our write lock on the version makes our own SIREAD lock on it redundant.
  me.sireads = me.sireads.filter((id) => id !== v.id);
}

function preCommit(s: State, me: Txn): void {
  if (me.doomed) throw new SerializationError("40001", MSG.rw);
  for (const nearN of me.inC) {
    const near = s.txns[nearN];
    if (committed(near) || near.doomed) continue;
    for (const farN of near.inC) {
      const far = s.txns[farN];
      if (far === me || (!committed(far) && !far.readOnly && !far.doomed)) {
        near.doomed = true;
        s.notes.push(`T${me.t} commits first, so T${near.t}, the pivot between T${far.t} and T${me.t}, is marked to fail.`);
        break;
      }
    }
  }
  me.prepareSeq = ++s.seq;
}

/** predicate.c's ReleasePredicateLocks on commit: summarize and drop finished conflicts. */
function releaseOnCommit(s: State, me: Txn): void {
  for (const xn of [...me.outC]) {
    const x = s.txns[xn];
    if (committed(x) && !me.readOnly) {
      if (!me.conflictOut || x.prepareSeq < me.earliestOutConflictCommit) me.earliestOutConflictCommit = x.prepareSeq;
      me.conflictOut = true;
    }
    if (committed(x) || (x.snap?.lastCommitBeforeSnapshot ?? -1) >= s.seq) dropConflict(s, me, x);
  }
  for (const yn of [...me.inC]) {
    const y = s.txns[yn];
    if (committed(y) || y.readOnly) dropConflict(s, y, me);
  }
}

function dropConflict(s: State, reader: Txn, writer: Txn): void {
  reader.outC = reader.outC.filter((n) => n !== writer.t);
  writer.inC = writer.inC.filter((n) => n !== reader.t);
}

function releaseOnAbort(s: State, me: Txn): void {
  for (const xn of me.outC) dropConflict(s, me, s.txns[xn]);
  for (const yn of me.inC) dropConflict(s, s.txns[yn], me);
  me.sireads = [];
  me.doomed = true;
}

// --- Operations -------------------------------------------------------------

type Outcome = { kind: "ok"; value?: number } | { kind: "blocked"; on: number };

function doRead(s: State, me: Txn, key: string, i: number): Outcome {
  const snap = statementSnapshot(s, me);
  const v = visibleVersion(s, me, snap, key);
  if (s.level === "ser") {
    if (me.doomed) throw new SerializationError("40001", MSG.rw);
    conflictOut(s, me, snap, v);
    if (v.xmin !== me.xid && !me.sireads.includes(v.id)) me.sireads.push(v.id);
  }
  me.reads.push({ key, value: v.value, version: v.id, step: i });
  me.last[key] = v.value;
  return { kind: "ok", value: v.value };
}

/** UPDATE kv SET v = ... WHERE k = key, from the top or resuming after a wait. */
function doWrite(s: State, me: Txn, step: Step, i: number, resumed: boolean): Outcome {
  // heap_update assigns the transaction id before it looks at the row.
  assignXid(s, me);
  let snap: Snapshot;
  let target: Version;
  if (!resumed) {
    snap = statementSnapshot(s, me);
    if (s.level === "ser" && me.doomed) throw new SerializationError("40001", MSG.rw);
    target = visibleVersion(s, me, snap, step.key!);
    if (s.level === "ser") {
      conflictOut(s, me, snap, target);
      if (target.xmin !== me.xid && !me.sireads.includes(target.id)) me.sireads.push(target.id);
    }
  } else {
    snap = me.snap!;
    // After the wait, READ COMMITTED re-finds the row's newest version
    // (EvalPlanQual); the others look at the version they found before.
    const c = chain(s, step.key!);
    target = s.level === "rc" ? c.filter((v) => s.clog[v.xmin] === "committed" || v.xmin === me.xid).pop()! : c.find((v) => v.id === me.target)!;
  }
  for (;;) {
    const x = target.xmax;
    if (x === null || s.clog[x] === "aborted") break;
    if (s.clog[x] === "running") {
      const holder = byXid(s, x)!;
      me.waitsFor = holder.t;
      me.target = target.id;
      if (waitCycle(s, me)) {
        me.waitsFor = null;
        throw new SerializationError("40P01", MSG.deadlock);
      }
      return { kind: "blocked", on: holder.t };
    }
    // The row was replaced by a transaction that committed after our snapshot.
    if (s.level !== "rc") throw new SerializationError("40001", MSG.concurrent);
    target = chain(s, step.key!).find((v) => v.xmin === x)!;
  }
  const value = step.set !== undefined ? step.set : (me.last[step.key!] ?? target.value) + (step.add ?? 0);
  if (s.level === "ser") conflictIn(s, me, snap, target);
  target.xmax = me.xid;
  s.versions.push({ id: s.versions.length, key: step.key!, value, xmin: me.xid!, xmax: null });
  me.wrote = true;
  me.last[step.key!] = value;
  return { kind: "ok", value };
}

function waitCycle(s: State, me: Txn): boolean {
  let cur: number | null = me.waitsFor;
  const seen = new Set<number>();
  while (cur !== null && !seen.has(cur)) {
    if (cur === me.t) return true;
    seen.add(cur);
    cur = s.txns[cur].waitsFor;
  }
  return false;
}

function doCommit(s: State, me: Txn): Outcome {
  if (s.level === "ser") preCommit(s, me);
  if (me.xid !== null) s.clog[me.xid] = "committed";
  me.status = "committed";
  if (s.level === "ser") {
    me.commitSeq = ++s.seq;
    me.finishedBefore = s.nextXid;
    if (!me.wrote) me.readOnly = true;
    releaseOnCommit(s, me);
  } else {
    me.commitSeq = ++s.seq;
  }
  return { kind: "ok" };
}

function finish(s: State, me: Txn, how: "aborted"): void {
  if (me.xid !== null) s.clog[me.xid] = how;
  me.status = how;
  me.waitsFor = null;
  if (s.level === "ser") releaseOnAbort(s, me);
}

/** Runs one step for a transaction that isn't blocked. */
function execute(s: State, i: number, resumed: boolean): StepResult {
  const step = s.steps[i];
  const me = s.txns[step.t];
  if (me.status === "aborted" || me.status === "committed") return { step: i, kind: "skipped" };
  if (me.status === "idle") me.status = "active";
  try {
    let out: Outcome;
    if (step.op === "r") out = doRead(s, me, step.key!, i);
    else if (step.op === "w") out = doWrite(s, me, step, i, resumed);
    else if (step.op === "c") out = doCommit(s, me);
    else {
      finish(s, me, "aborted");
      out = { kind: "ok" };
    }
    if (out.kind === "blocked") {
      me.status = "blocked";
      return { step: i, kind: "blocked" };
    }
    if (me.status === "blocked") me.status = "active";
    return { step: i, kind: "ok", value: out.value };
  } catch (e) {
    if (!(e instanceof SerializationError)) throw e;
    const failure: Failure = { code: e.code, message: e.message, step: i };
    me.failure = failure;
    finish(s, me, "aborted");
    return { step: i, kind: "error", error: failure };
  }
}

/** Wakes the transactions waiting on one that just finished, and runs what they had queued. */
function wake(s: State, finished: number, at: number): void {
  for (const w of Object.values(s.txns)) {
    if (w.status !== "blocked" || w.waitsFor !== finished) continue;
    w.waitsFor = null;
    w.status = "active";
    const [first, ...rest] = w.queue;
    w.queue = [];
    const r = execute(s, first, true);
    const rec = s.results.find((x) => x.step === first)!;
    if (r.kind === "blocked") {
      w.queue = [first, ...rest];
      continue;
    }
    rec.releasedAt = at;
    rec.releasedKind = r.kind === "error" ? "error" : "ok";
    if (r.kind === "error") rec.error = r.error;
    if (r.kind === "ok") rec.value = r.value;
    if (r.kind === "error") s.notes.push(`T${w.t} wakes up and fails: ${r.error!.message}.`);
    else s.notes.push(`T${w.t} wakes up and its ${describe(s.steps[first])} goes through.`);
    runQueued(s, w, rest, at);
    if (w.status === "committed" || w.status === "aborted") wake(s, w.t, at);
  }
}

function runQueued(s: State, w: Txn, rest: number[], at: number): void {
  for (let k = 0; k < rest.length; k++) {
    const r = execute(s, rest[k], false);
    const rec = s.results.find((x) => x.step === rest[k])!;
    if (r.kind === "blocked") {
      w.queue = rest.slice(k);
      return;
    }
    if (r.kind === "skipped") {
      Object.assign(rec, r);
      continue;
    }
    // It was queued behind the waiting statement, so it stays a blocked step
    // that finished when the wait ended.
    rec.releasedAt = at;
    rec.releasedKind = r.kind === "error" ? "error" : "ok";
    if (r.kind === "error") rec.error = r.error;
    if (r.kind === "ok") rec.value = r.value;
  }
}

/** Issues the next step of the schedule. */
export function advance(state: State): State {
  if (state.done >= state.steps.length) return state;
  const s = clone(state);
  const i = s.done;
  s.done += 1;
  const step = s.steps[i];
  const me = s.txns[step.t];
  if (me.status === "blocked") {
    // The client is still waiting for its earlier statement; this one queues behind it.
    me.queue.push(i);
    s.results.push({ step: i, kind: "blocked" });
    s.notes.push(`T${me.t} is still waiting, so this step waits too.`);
    return s;
  }
  const r = execute(s, i, false);
  s.results.push(r);
  if (r.kind === "blocked") {
    me.queue = [i];
    s.notes.push(`T${me.t} waits for T${me.waitsFor} to finish: it is updating the same row.`);
  } else if (r.kind === "error") {
    s.notes.push(`T${me.t} fails: ${r.error!.message}.`);
  }
  if (me.status === "committed" || me.status === "aborted") wake(s, me.t, i);
  return s;
}

export function run(init: Record<string, number>, steps: Step[], level: Level, upto = steps.length): State {
  let s = initial(init, steps, level);
  while (s.done < upto) s = advance(s);
  return s;
}

// --- Reading the state ------------------------------------------------------

export function describe(step: Step): string {
  if (step.op === "r") return `read ${step.key}`;
  if (step.op === "c") return "commit";
  if (step.op === "a") return "rollback";
  if (step.set !== undefined) return `set ${step.key} = ${step.set}`;
  const n = step.add ?? 0;
  return `set ${step.key} = ${step.key} ${n < 0 ? "−" : "+"} ${Math.abs(n)}`;
}

/** The newest committed value of every key. */
export function finalState(s: State): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of s.versions) {
    if (s.clog[v.xmin] === "committed") out[v.key] = v.value;
  }
  return out;
}

/**
 * The oldest xid any running transaction can still need, PostgreSQL's
 * removal horizon: below it, a version replaced by a committed transaction
 * is invisible to everyone and can be pruned.
 */
export function horizon(s: State): number {
  let h = s.nextXid;
  for (const t of Object.values(s.txns)) {
    if (t.status !== "active" && t.status !== "blocked") continue;
    if (t.xid !== null) h = Math.min(h, t.xid);
    // A READ COMMITTED transaction holds no snapshot between statements.
    if (t.snap && s.level !== "rc") h = Math.min(h, t.snap.xmin);
  }
  return h;
}

export type Life = "live" | "uncommitted" | "aborted" | "kept" | "removable" | "replacing";

/** What a version is to the system as a whole. */
export function life(s: State, v: Version): Life {
  if (s.clog[v.xmin] === "aborted") return "aborted";
  if (s.clog[v.xmin] === "running") return "uncommitted";
  if (v.xmax === null || s.clog[v.xmax] === "aborted") return "live";
  if (s.clog[v.xmax] === "running") return "replacing";
  return v.xmax < horizon(s) ? "removable" : "kept";
}

export interface Edge {
  from: number;
  to: number;
  kind: "ww" | "wr" | "rw";
  key: string;
}

/**
 * The dependency graph of the transactions that haven't aborted, from the
 * version order and what each one read (Adya's direct serialization graph).
 */
export function dependencies(s: State): Edge[] {
  const alive = (xid: number) => s.clog[xid] !== "aborted";
  const owner = (xid: number) => (xid === SETUP_XID ? null : byXid(s, xid)?.t ?? null);
  const edges: Edge[] = [];
  const add = (e: Edge) => {
    if (e.from !== e.to && !edges.some((x) => x.from === e.from && x.to === e.to && x.kind === e.kind)) edges.push(e);
  };
  for (const key of keys(s)) {
    const c = chain(s, key).filter((v) => alive(v.xmin));
    for (let k = 1; k < c.length; k++) {
      const a = owner(c[k - 1].xmin);
      const b = owner(c[k].xmin);
      if (a !== null && b !== null) add({ from: a, to: b, kind: "ww", key });
    }
    for (const t of Object.values(s.txns)) {
      if (t.status === "aborted") continue;
      for (const r of t.reads.filter((x) => x.key === key)) {
        const idx = c.findIndex((v) => v.id === r.version);
        const w = owner(c[idx].xmin);
        if (w !== null) add({ from: w, to: t.t, kind: "wr", key });
        const next = c[idx + 1];
        const n = next ? owner(next.xmin) : null;
        if (n !== null) add({ from: t.t, to: n, kind: "rw", key });
      }
    }
  }
  return edges;
}

/**
 * Brute force: is there a serial order of the committed transactions that
 * reads the same values and leaves the same final state? Returns that order,
 * or null. Independent of the MVCC rules above; it only replays the schedule's
 * own steps one transaction at a time.
 */
export function serialOrder(init: Record<string, number>, s: State): number[] | null {
  const done = Object.values(s.txns).filter((t) => t.status === "committed").map((t) => t.t);
  const finalNow = finalState(s);
  for (const order of permutations(done)) {
    const db = { ...init };
    let ok = true;
    for (const t of order) {
      const last: Record<string, number> = {};
      const reads = s.txns[t].reads.map((r) => r.value);
      let ri = 0;
      for (const step of s.steps.filter((x) => x.t === t)) {
        if (step.op === "r") {
          if (db[step.key!] !== reads[ri++]) ok = false;
          last[step.key!] = db[step.key!];
        } else if (step.op === "w") {
          db[step.key!] = step.set !== undefined ? step.set : (last[step.key!] ?? db[step.key!]) + (step.add ?? 0);
          last[step.key!] = db[step.key!];
        }
      }
      if (!ok) break;
    }
    if (ok && Object.keys(db).every((k) => db[k] === finalNow[k])) return order;
  }
  return null;
}

function* permutations(xs: number[]): Generator<number[]> {
  if (xs.length <= 1) {
    yield [...xs];
    return;
  }
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) yield [xs[i], ...p];
  }
}

/** Swaps step i with its neighbour (dir -1 or +1) if they belong to different transactions. */
export function canMove(steps: Step[], i: number, dir: -1 | 1): boolean {
  const j = i + dir;
  return j >= 0 && j < steps.length && steps[i].t !== steps[j].t;
}

export function move(steps: Step[], i: number, dir: -1 | 1): Step[] {
  if (!canMove(steps, i, dir)) return steps;
  const out = [...steps];
  [out[i], out[i + dir]] = [out[i + dir], out[i]];
  return out;
}
