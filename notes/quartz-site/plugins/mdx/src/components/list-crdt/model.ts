// Three list CRDTs for replicated text, and a two-replica network to run them
// on. No DOM here: the figure, its tests and the experiment harness beside the
// note all run this same file.
//
// - "logoot": every character gets a position from a dense order, chosen at
//   random inside the gap between its neighbours (the Logoot idea, without
//   LSEQ's allocation tricks). The document is the positions in sorted order.
// - "rga": the Replicated Growable Array. Each character names the character
//   it was typed after; concurrent inserts after the same character are
//   ordered newest Lamport timestamp first.
// - "fugue": Fugue as in Weidner and Kleppmann, Algorithm 1. Characters form a
//   tree of left and right children; the document is an in-order traversal.
//
// All three keep deleted characters as tombstones, so an insert that names a
// deleted neighbour still lands in the right place.

import { mulberry32 } from "../../shared/random";

export type Algo = "logoot" | "rga" | "fugue";
export const ALGOS: Algo[] = ["fugue", "rga", "logoot"];
export const ALGO_LABEL: Record<Algo, string> = { fugue: "Fugue", rga: "RGA", logoot: "Logoot-style" };

/** A character as the figure draws it. */
export interface Elem {
  id: string;
  char: string;
  replica: string;
  deleted: boolean;
  /** The identifier the algorithm orders by, written short. */
  label: string;
}

export type Op = InsOp | DelOp;
export interface DelOp {
  kind: "del";
  id: string;
  /** rga: a deletion ticks the Lamport clock too, as in Automerge. */
  counter?: number;
}
export interface InsOp {
  kind: "ins";
  id: string;
  replica: string;
  counter: number;
  char: string;
  /** logoot: the position. */
  pos?: Digit[];
  /** rga: the id typed after, or null for the start. fugue: the parent, or null for the root. */
  ref?: string | null;
  /** fugue: which side of the parent. */
  side?: "L" | "R";
}

export interface ListDoc {
  readonly algo: Algo;
  readonly replica: string;
  /** Makes an insert of char before visible index, applies it here and returns it to broadcast. */
  insert(index: number, char: string): InsOp;
  /** Deletes the visible character at index, applies it here and returns it. */
  remove(index: number): DelOp;
  /** Applies a remote op. Returns false if it was already applied (duplicates are harmless). */
  apply(op: Op): boolean;
  text(): string;
  /** Every character in document order, tombstones included. */
  elems(): Elem[];
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- Logoot-style

/** One level of a position: a digit, with the replica and counter that made it as a tiebreak. */
export interface Digit {
  d: number;
  r: string;
  c: number;
}
export const BASE = 100;
const MIN: Digit = { d: 0, r: "", c: 0 };

function cmpDigit(a: Digit, b: Digit): number {
  return a.d - b.d || cmpStr(a.r, b.r) || a.c - b.c;
}
export function cmpPos(a: Digit[], b: Digit[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = cmpDigit(a[i], b[i]);
    if (c) return c;
  }
  return a.length - b.length;
}

/**
 * A position strictly between p and q (q null for the end of the document),
 * with a random digit at the first level where the gap has room.
 */
export function between(p: Digit[], q: Digit[] | null, replica: string, counter: number, rand: () => number): Digit[] {
  const out: Digit[] = [];
  let boundedByQ = q !== null;
  for (let i = 0; ; i++) {
    const pi = p[i] ?? MIN;
    const lo = pi.d;
    const hi = boundedByQ && q![i] ? q![i].d : BASE;
    if (hi - lo > 1) {
      out.push({ d: lo + 1 + Math.floor(rand() * (hi - lo - 1)), r: replica, c: counter });
      return out;
    }
    out.push(pi);
    if (boundedByQ) boundedByQ = q![i] !== undefined && cmpDigit(pi, q![i]) === 0;
  }
}

interface LNode {
  id: string;
  char: string;
  replica: string;
  deleted: boolean;
  pos: Digit[];
}

class LogootDoc implements ListDoc {
  readonly algo = "logoot" as const;
  private nodes: LNode[] = [];
  private byId = new Map<string, LNode>();
  private counter = 0;
  private rand: () => number;
  constructor(readonly replica: string, seed: number) {
    this.rand = mulberry32(seed);
  }
  private visible() {
    return this.nodes.filter((n) => !n.deleted);
  }
  insert(index: number, char: string): InsOp {
    const vis = this.visible();
    const p = index > 0 ? vis[index - 1].pos : [];
    // The right neighbour is the next node in the sorted list, tombstone or
    // not, so the new position fits between two adjacent stored positions.
    const leftAt = index > 0 ? this.nodes.indexOf(vis[index - 1]) : -1;
    const q = this.nodes[leftAt + 1]?.pos ?? null;
    this.counter++;
    const op: InsOp = { kind: "ins", id: `${this.replica}${this.counter}`, replica: this.replica, counter: this.counter, char, pos: between(p, q, this.replica, this.counter, this.rand) };
    this.apply(op);
    return op;
  }
  remove(index: number): DelOp {
    const op: DelOp = { kind: "del", id: this.visible()[index].id };
    this.apply(op);
    return op;
  }
  apply(op: Op): boolean {
    if (op.kind === "del") {
      const n = this.byId.get(op.id);
      if (!n || n.deleted) return false;
      n.deleted = true;
      return true;
    }
    if (this.byId.has(op.id)) return false;
    if (op.replica === this.replica) this.counter = Math.max(this.counter, op.counter);
    const n: LNode = { id: op.id, char: op.char, replica: op.replica, deleted: false, pos: op.pos! };
    let i = 0;
    while (i < this.nodes.length && cmpPos(this.nodes[i].pos, n.pos) < 0) i++;
    this.nodes.splice(i, 0, n);
    this.byId.set(n.id, n);
    return true;
  }
  text() {
    return this.visible().map((n) => n.char).join("");
  }
  elems(): Elem[] {
    return this.nodes.map((n) => ({ id: n.id, char: n.char, replica: n.replica, deleted: n.deleted, label: n.pos.map((x) => x.d).join(".") }));
  }
}

// ------------------------------------------------------------------------ RGA

interface RNode {
  id: string;
  char: string;
  replica: string;
  counter: number;
  deleted: boolean;
}

/** True if a's timestamp is newer than b's: higher counter, then higher replica id. */
const newer = (a: { counter: number; replica: string }, b: { counter: number; replica: string }) =>
  a.counter > b.counter || (a.counter === b.counter && a.replica > b.replica);

class RgaDoc implements ListDoc {
  readonly algo = "rga" as const;
  private nodes: RNode[] = [];
  private byId = new Map<string, RNode>();
  private clock = 0;
  constructor(readonly replica: string) {}
  private visible() {
    return this.nodes.filter((n) => !n.deleted);
  }
  insert(index: number, char: string): InsOp {
    const ref = index > 0 ? this.visible()[index - 1].id : null;
    const counter = this.clock + 1;
    const op: InsOp = { kind: "ins", id: `${this.replica}${counter}`, replica: this.replica, counter, char, ref };
    this.apply(op);
    return op;
  }
  remove(index: number): DelOp {
    const op: DelOp = { kind: "del", id: this.visible()[index].id, counter: this.clock + 1 };
    this.apply(op);
    return op;
  }
  apply(op: Op): boolean {
    if (op.kind === "del") {
      if (op.counter) this.clock = Math.max(this.clock, op.counter);
      const n = this.byId.get(op.id);
      if (!n || n.deleted) return false;
      n.deleted = true;
      return true;
    }
    if (this.byId.has(op.id)) return false;
    this.clock = Math.max(this.clock, op.counter);
    const n: RNode = { id: op.id, char: op.char, replica: op.replica, counter: op.counter, deleted: false };
    let i = op.ref ? this.nodes.findIndex((x) => x.id === op.ref) + 1 : 0;
    if (op.ref && i === 0) throw new Error(`rga: ${op.id} arrived before ${op.ref}`);
    // Skip everything after the reference that is newer than this insert:
    // concurrent inserts at the same place with bigger timestamps, and the
    // characters typed after them (which are newer still).
    while (i < this.nodes.length && newer(this.nodes[i], n)) i++;
    this.nodes.splice(i, 0, n);
    this.byId.set(n.id, n);
    return true;
  }
  text() {
    return this.visible().map((n) => n.char).join("");
  }
  elems(): Elem[] {
    return this.nodes.map((n) => ({ id: n.id, char: n.char, replica: n.replica, deleted: n.deleted, label: `${n.counter}${n.replica}` }));
  }
}

// ---------------------------------------------------------------------- Fugue

interface FNode {
  id: string;
  char: string;
  replica: string;
  counter: number;
  deleted: boolean;
  parent: FNode | null;
  side: "L" | "R";
  left: FNode[];
  right: FNode[];
}

/** Fugue orders siblings by id, (replica, counter), lexicographically. */
const cmpFugue = (a: FNode, b: FNode) => cmpStr(a.replica, b.replica) || a.counter - b.counter;

class FugueDoc implements ListDoc {
  readonly algo = "fugue" as const;
  private root: FNode = { id: "", char: "", replica: "", counter: 0, deleted: true, parent: null, side: "R", left: [], right: [] };
  private byId = new Map<string, FNode>();
  private counter = 0;
  constructor(readonly replica: string) {}
  /** In-order: left children, the node, right children; tombstones included. */
  private order(): FNode[] {
    const out: FNode[] = [];
    const walk = (n: FNode) => {
      for (const c of n.left) walk(c);
      if (n !== this.root) out.push(n);
      for (const c of n.right) walk(c);
    };
    walk(this.root);
    return out;
  }
  insert(index: number, char: string): InsOp {
    const all = this.order();
    const vis = all.filter((n) => !n.deleted);
    const leftOrigin = index > 0 ? vis[index - 1] : this.root;
    this.counter++;
    const id = `${this.replica}${this.counter}`;
    let ref: string | null;
    let side: "L" | "R";
    if (leftOrigin.right.length === 0) {
      ref = leftOrigin === this.root ? null : leftOrigin.id;
      side = "R";
    } else {
      // The next node after leftOrigin in the traversal that includes
      // tombstones. It exists: leftOrigin has right children.
      const rightOrigin = all[leftOrigin === this.root ? 0 : all.indexOf(leftOrigin) + 1];
      ref = rightOrigin.id;
      side = "L";
    }
    const op: InsOp = { kind: "ins", id, replica: this.replica, counter: this.counter, char, ref, side };
    this.apply(op);
    return op;
  }
  remove(index: number): DelOp {
    const op: DelOp = { kind: "del", id: this.order().filter((n) => !n.deleted)[index].id };
    this.apply(op);
    return op;
  }
  apply(op: Op): boolean {
    if (op.kind === "del") {
      const n = this.byId.get(op.id);
      if (!n || n.deleted) return false;
      n.deleted = true;
      return true;
    }
    if (this.byId.has(op.id)) return false;
    if (op.replica === this.replica) this.counter = Math.max(this.counter, op.counter);
    const parent = op.ref ? this.byId.get(op.ref) : this.root;
    if (!parent) throw new Error(`fugue: ${op.id} arrived before ${op.ref}`);
    const n: FNode = { id: op.id, char: op.char, replica: op.replica, counter: op.counter, deleted: false, parent, side: op.side!, left: [], right: [] };
    const sibs = op.side === "L" ? parent.left : parent.right;
    let i = 0;
    while (i < sibs.length && cmpFugue(sibs[i], n) < 0) i++;
    sibs.splice(i, 0, n);
    this.byId.set(n.id, n);
    return true;
  }
  text() {
    return this.order().filter((n) => !n.deleted).map((n) => n.char).join("");
  }
  elems(): Elem[] {
    return this.order().map((n) => ({
      id: n.id,
      char: n.char,
      replica: n.replica,
      deleted: n.deleted,
      label: `${n.side === "L" ? "↙" : "↘"}${n.parent && n.parent !== this.root ? this.labelOf(n.parent) : "root"}`,
    }));
  }
  private labelOf(n: FNode) {
    return `${n.replica}${n.counter}`;
  }
}

export function createDoc(algo: Algo, replica: string, seed = 1): ListDoc {
  if (algo === "logoot") return new LogootDoc(replica, seed);
  if (algo === "rga") return new RgaDoc(replica);
  return new FugueDoc(replica);
}

// ------------------------------------------------------------- local editing

/** The single splice that turns before into after: common prefix and suffix kept. */
export function diff(before: string, after: string): { at: number; del: number; ins: string } {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { at: p, del: before.length - p - s, ins: after.slice(p, after.length - s) };
}

/** Applies a splice as single-character ops, the way an editor sends keystrokes. */
export function splice(doc: ListDoc, at: number, del: number, ins: string): Op[] {
  const ops: Op[] = [];
  for (let k = 0; k < del; k++) ops.push(doc.remove(at));
  for (let k = 0; k < ins.length; k++) ops.push(doc.insert(at + k, ins[k]));
  return ops;
}

/** The keystrokes that type word at index: forwards (left to right) or backwards (each at the same index). */
export function keystrokes(word: string, at: number, backwards: boolean): Array<[number, string]> {
  return backwards ? [...word].reverse().map((c) => [at, c]) : [...word].map((c, i) => [at + i, c]);
}

// -------------------------------------------------------------- the network

export type ReplicaId = "A" | "B";

/** One step a reader can take. Positions are visible indexes at that replica, so a log replays under any algorithm. */
export type Action = { r: ReplicaId; ins: number; ch: string } | { r: ReplicaId; del: number } | { sync: true };

export interface Sim {
  algo: Algo;
  docs: Record<ReplicaId, ListDoc>;
  /** Ops waiting on each one-way link, oldest first. FIFO links between two replicas give causal delivery. */
  inFlight: Record<"AB" | "BA", Op[]>;
  online: boolean;
  /** Everything done since the start, for replaying under another algorithm. */
  log: Action[];
  /**
   * From the last sync: how many pairs of characters that sat side by side in
   * the replica that typed them were pulled apart by the other replica's
   * concurrent text. Above zero means the two edits interleaved.
   */
  splits: number;
}

export const BASE_TEXT = "Hello!";

/** Two replicas that both start from `base`, typed by a third replica "o". */
export function newSim(algo: Algo, online = false, base = BASE_TEXT, seed = 7): Sim {
  const origin = createDoc(algo, "o", seed);
  const ops = splice(origin, 0, 0, base);
  const docs = { A: createDoc(algo, "A", seed * 2 + 1), B: createDoc(algo, "B", seed * 2 + 2) };
  for (const op of ops) {
    docs.A.apply(op);
    docs.B.apply(op);
  }
  return { algo, docs, inFlight: { AB: [], BA: [] }, online, log: [], splits: 0 };
}

const other = (r: ReplicaId): ReplicaId => (r === "A" ? "B" : "A");
const link = (from: ReplicaId): "AB" | "BA" => (from === "A" ? "AB" : "BA");

/** Runs one action. A local edit queues its op on the outgoing link; when online, everything is delivered at once. */
export function act(sim: Sim, a: Action): void {
  if ("sync" in a) {
    if (pending(sim) === 0) return;
    // Pairs of adjacent characters that one replica typed since the last sync.
    const fresh = { A: new Set<string>(), B: new Set<string>() };
    const pairs: Array<[ReplicaId, string, string]> = [];
    for (const r of ["A", "B"] as ReplicaId[]) {
      for (const op of sim.inFlight[link(r)]) if (op.kind === "ins") fresh[r].add(op.id);
      const vis = sim.docs[r].elems().filter((e) => !e.deleted);
      for (let i = 1; i < vis.length; i++) {
        if (fresh[r].has(vis[i - 1].id) && fresh[r].has(vis[i].id)) pairs.push([r, vis[i - 1].id, vis[i].id]);
      }
    }
    for (const from of ["A", "B"] as ReplicaId[]) {
      const q = sim.inFlight[link(from)];
      for (const op of q) sim.docs[other(from)].apply(op);
      q.length = 0;
    }
    const merged = sim.docs.A.elems().filter((e) => !e.deleted);
    const at = new Map(merged.map((e, i) => [e.id, i]));
    sim.splits = 0;
    for (const [r, x, y] of pairs) {
      const i = at.get(x);
      const j = at.get(y);
      if (i === undefined || j === undefined) continue;
      if (merged.slice(i + 1, j).some((e) => fresh[other(r)].has(e.id))) sim.splits++;
    }
    sim.log.push(a);
    return;
  }
  const doc = sim.docs[a.r];
  sim.inFlight[link(a.r)].push("del" in a ? doc.remove(a.del) : doc.insert(a.ins, a.ch));
  sim.log.push(a);
  if (sim.online) act(sim, { sync: true });
}

export const sync = (sim: Sim) => act(sim, { sync: true });

/** A user edit: the replica's text becomes `after`, sent as single-character ops. */
export function edit(sim: Sim, at: ReplicaId, after: string): void {
  const d = diff(sim.docs[at].text(), after);
  for (let k = 0; k < d.del; k++) act(sim, { r: at, del: d.at });
  for (let k = 0; k < d.ins.length; k++) act(sim, { r: at, ins: d.at + k, ch: d.ins[k] });
}

export function type(sim: Sim, at: ReplicaId, word: string, index: number, backwards: boolean): void {
  for (const [i, ch] of keystrokes(word, index, backwards)) act(sim, { r: at, ins: i, ch });
}

/** The same actions under another algorithm (and the same online setting). */
export function replay(algo: Algo, log: Action[], online: boolean): Sim {
  const sim = newSim(algo, false);
  for (const a of log) act(sim, a);
  sim.online = online;
  return sim;
}

export function pending(sim: Sim): number {
  return sim.inFlight.AB.length + sim.inFlight.BA.length;
}

/**
 * How many pieces the text typed at A and at B falls into: the number of runs
 * of same-replica characters, ignoring the shared starting text. Two words
 * typed concurrently should give 2; more means they interleaved.
 */
export function pieces(doc: ListDoc): number {
  let runs = 0;
  let last = "";
  for (const e of doc.elems()) {
    if (e.deleted || e.replica === "o") continue;
    if (e.replica !== last) runs++;
    last = e.replica;
  }
  return runs;
}

export interface Scenario {
  label: string;
  run(sim: Sim): void;
}

/** The figure's starting points. Each leaves its edits in flight, so the reader presses Sync. */
export const scenarios: Record<string, Scenario> = {
  forwards: {
    label: "Both type at the same spot",
    run(sim) {
      type(sim, "A", " Alice", 5, false);
      type(sim, "B", " Charlie", 5, false);
    },
  },
  backwards: {
    label: "Both type a word back to front",
    run(sim) {
      type(sim, "A", " Alice", 5, true);
      type(sim, "B", " Charlie", 5, true);
    },
  },
  deleteEdit: {
    label: "One deletes a word the other extends",
    run(sim) {
      edit(sim, "A", "Hi!");
      edit(sim, "B", "Hello there!");
    },
  },
  blank: {
    label: "Start from “Hello!” and type yourself",
    run() {},
  },
};

export const DEFAULT_SCENARIO = "forwards";
export const DEFAULT_ALGO: Algo = "logoot";

export function scenarioSim(algo: Algo, key: string): Sim {
  const sim = newSim(algo, false);
  (scenarios[key] ?? scenarios[DEFAULT_SCENARIO]).run(sim);
  return sim;
}

/** What the figure says under the replicas. */
export function summary(sim: Sim): { text: string; tone: "info" | "good" | "bad" } {
  const n = pending(sim);
  const a = sim.docs.A.text();
  if (n > 0 || a !== sim.docs.B.text()) {
    return { text: `${n} operation${n === 1 ? "" : "s"} not yet delivered. The replicas disagree until they sync.`, tone: "info" };
  }
  if (sim.splits === 0) return { text: `In sync: both replicas read “${a}”.`, tone: "good" };
  return { text: `In sync: both replicas read “${a}”, but the two edits are interleaved: in ${sim.splits} place${sim.splits === 1 ? "" : "s"}, text typed in one piece was split by the other replica’s.`, tone: "bad" };
}
