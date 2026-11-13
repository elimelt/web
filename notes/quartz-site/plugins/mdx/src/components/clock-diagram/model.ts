// The clock diagram's model: a space-time diagram of three processes, and the
// timestamps that Lamport clocks, vector clocks, hybrid logical clocks and
// skewed physical clocks give each event in it. Everything here is a pure
// function of the diagram, so the build, the browser and the tests compute
// exactly the same numbers.
//
// Conventions, used by every clock below so they can be compared:
// - Every event ticks: a local event, a send and a receive are each one event.
// - Each send carries exactly one message, and each receive takes one.
// - `t` is true time in milliseconds, the omniscient view no process has. A
//   message is received strictly after it is sent, in true time.

export const PROCS = 3;
export const T_MAX = 60;
/** Two events on one process must be at least this far apart in true time. */
export const MIN_GAP = 5;
/** Physical clocks read whole milliseconds, counted from this base. */
export const PT_BASE = 100;
export const OFFSET_LIMIT = 20;
export const MAX_EVENTS = 24;

export interface Ev {
  id: string;
  proc: number;
  t: number;
}

export interface Msg {
  send: string;
  recv: string;
}

export interface Diagram {
  events: Ev[];
  msgs: Msg[];
  /** Each process's physical clock error, in ms, relative to true time. */
  offsets: number[];
}

export type Kind = "local" | "send" | "recv";

export interface Hlc {
  l: number;
  c: number;
}

export interface Stamped {
  id: string;
  proc: number;
  t: number;
  kind: Kind;
  /** a1, a2, ... on P1; b1, ... on P2; c1, ... on P3, in process order. */
  name: string;
  lamport: number;
  vector: number[];
  pt: number;
  hlc: Hlc;
  /** For a receive, the id of the matching send; for a send, its receive. */
  peer?: string;
}

export interface Computed {
  /** Events in true-time order, which is also a valid causal order. */
  events: Stamped[];
  byId: Map<string, Stamped>;
  /** past[i] holds the indices (into events) of everything that happens before events[i]. */
  past: Set<number>[];
  index: Map<string, number>;
}

const LETTERS = "abc";

/** A physical clock reading: true time plus the process's offset, truncated to whole ms. */
export const physical = (t: number, offset: number): number => Math.floor(PT_BASE + t + offset);

/** Hybrid logical clock update for a local or send event (Kulkarni et al. 2014, Fig. 5). */
export function hlcLocal(prev: Hlc, pt: number): Hlc {
  const l = Math.max(prev.l, pt);
  return { l, c: l === prev.l ? prev.c + 1 : 0 };
}

/** Hybrid logical clock update for a receive event carrying the sender's (l, c). */
export function hlcRecv(prev: Hlc, msg: Hlc, pt: number): Hlc {
  const l = Math.max(prev.l, msg.l, pt);
  let c: number;
  if (l === prev.l && l === msg.l) c = Math.max(prev.c, msg.c) + 1;
  else if (l === prev.l) c = prev.c + 1;
  else if (l === msg.l) c = msg.c + 1;
  else c = 0;
  return { l, c };
}

export function kinds(d: Diagram): Map<string, { kind: Kind; peer?: string }> {
  const out = new Map<string, { kind: Kind; peer?: string }>();
  for (const e of d.events) out.set(e.id, { kind: "local" });
  for (const m of d.msgs) {
    out.set(m.send, { kind: "send", peer: m.recv });
    out.set(m.recv, { kind: "recv", peer: m.send });
  }
  return out;
}

/** Sort key: true time, then process. Receives are strictly later than their sends. */
const byTime = (a: Ev, b: Ev): number => a.t - b.t || a.proc - b.proc;

export function compute(d: Diagram): Computed {
  const sorted = [...d.events].sort(byTime);
  const kind = kinds(d);
  const counts = new Array(PROCS).fill(0);
  const lamport = new Array(PROCS).fill(0);
  const vector = Array.from({ length: PROCS }, () => new Array(PROCS).fill(0));
  const hlc: Hlc[] = Array.from({ length: PROCS }, () => ({ l: 0, c: 0 }));
  const last: number[] = new Array(PROCS).fill(-1);
  const index = new Map<string, number>();
  const byId = new Map<string, Stamped>();
  const events: Stamped[] = [];
  const past: Set<number>[] = [];

  sorted.forEach((e, i) => {
    const { kind: k, peer } = kind.get(e.id)!;
    const p = e.proc;
    const pt = physical(e.t, d.offsets[p] ?? 0);
    const before = new Set<number>();
    if (last[p] >= 0) {
      before.add(last[p]);
      for (const j of past[last[p]]) before.add(j);
    }
    if (k === "recv") {
      const s = byId.get(peer!);
      if (!s) throw new Error(`receive ${e.id} comes before its send ${peer} in true time`);
      lamport[p] = Math.max(lamport[p], s.lamport) + 1;
      for (let j = 0; j < PROCS; j++) vector[p][j] = Math.max(vector[p][j], s.vector[j]);
      vector[p][p] += 1;
      hlc[p] = hlcRecv(hlc[p], s.hlc, pt);
      const si = index.get(peer!)!;
      before.add(si);
      for (const j of past[si]) before.add(j);
    } else {
      lamport[p] += 1;
      vector[p][p] += 1;
      hlc[p] = hlcLocal(hlc[p], pt);
    }
    counts[p] += 1;
    const stamped: Stamped = {
      id: e.id,
      proc: p,
      t: e.t,
      kind: k,
      name: `${LETTERS[p]}${counts[p]}`,
      lamport: lamport[p],
      vector: [...vector[p]],
      pt,
      hlc: { ...hlc[p] },
      peer,
    };
    events.push(stamped);
    byId.set(e.id, stamped);
    index.set(e.id, i);
    past.push(before);
    last[p] = i;
  });
  return { events, byId, past, index };
}

export type Order = "before" | "after" | "concurrent" | "same";

/** The true relation, from reachability in the diagram (Lamport's definition). */
export function happensBefore(c: Computed, a: string, b: string): Order {
  if (a === b) return "same";
  const ia = c.index.get(a)!;
  const ib = c.index.get(b)!;
  if (c.past[ib].has(ia)) return "before";
  if (c.past[ia].has(ib)) return "after";
  return "concurrent";
}

/** Vector order: a < b iff every entry is <= and the vectors differ. */
export function vectorOrder(a: number[], b: number[]): Order {
  let less = false;
  let more = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) less = true;
    if (a[i] > b[i]) more = true;
  }
  if (less && !more) return "before";
  if (more && !less) return "after";
  if (!less && !more) return "same";
  return "concurrent";
}

const sign = (x: number): Order => (x < 0 ? "before" : x > 0 ? "after" : "same");
export const lamportOrder = (a: Stamped, b: Stamped): Order => sign(a.lamport - b.lamport);
export const physicalOrder = (a: Stamped, b: Stamped): Order => sign(a.pt - b.pt);
export const hlcOrder = (a: Stamped, b: Stamped): Order => sign(a.hlc.l - b.hlc.l || a.hlc.c - b.hlc.c);

export interface MessageCheck {
  send: Stamped;
  recv: Stamped;
  /** recv.pt - send.pt: negative means the physical clocks say it arrived before it left. */
  gap: number;
}

export function messages(d: Diagram, c: Computed): MessageCheck[] {
  return d.msgs
    .map((m) => {
      const send = c.byId.get(m.send)!;
      const recv = c.byId.get(m.recv)!;
      return { send, recv, gap: recv.pt - send.pt };
    })
    .sort((x, y) => x.send.t - y.send.t);
}

/** How far each event's HLC runs ahead of its own physical clock, in ms. */
export const hlcLead = (e: Stamped): number => e.hlc.l - e.pt;

// ---- Editing. Each returns a new diagram or an error message for the reader.

export type Edit = { ok: true; diagram: Diagram; id?: string } | { ok: false; why: string };

const clampT = (t: number): number => Math.min(T_MAX, Math.max(0, Math.round(t)));

let counter = 0;
const freshId = (d: Diagram): string => {
  let id: string;
  do id = `e${++counter}`;
  while (d.events.some((e) => e.id === id));
  return id;
};

function roomAt(d: Diagram, proc: number, t: number, ignore: string[] = []): string | null {
  if (d.events.length >= MAX_EVENTS) return `The diagram holds at most ${MAX_EVENTS} events.`;
  const near = d.events.find((e) => e.proc === proc && !ignore.includes(e.id) && Math.abs(e.t - t) < MIN_GAP);
  return near ? `Too close to another event on P${proc + 1}; leave ${MIN_GAP} ms between events.` : null;
}

export function addLocal(d: Diagram, proc: number, t: number): Edit {
  const at = clampT(t);
  const why = roomAt(d, proc, at);
  if (why) return { ok: false, why };
  const id = freshId(d);
  return { ok: true, id, diagram: { ...d, events: [...d.events, { id, proc, t: at }] } };
}

export function addMessage(d: Diagram, from: { proc: number; t: number }, to: { proc: number; t: number }): Edit {
  if (from.proc === to.proc) return { ok: false, why: "A message goes to a different process." };
  const ts = clampT(from.t);
  const tr = clampT(to.t);
  if (tr <= ts) return { ok: false, why: "A message arrives after it is sent, so its receive must sit to the right of its send." };
  if (d.events.length + 2 > MAX_EVENTS) return { ok: false, why: `The diagram holds at most ${MAX_EVENTS} events.` };
  const why = roomAt(d, from.proc, ts) ?? roomAt(d, to.proc, tr);
  if (why) return { ok: false, why };
  const send = freshId(d);
  const withSend = { ...d, events: [...d.events, { id: send, proc: from.proc, t: ts }] };
  const recv = freshId(withSend);
  return {
    ok: true,
    id: recv,
    diagram: {
      ...d,
      events: [...withSend.events, { id: recv, proc: to.proc, t: tr }],
      msgs: [...d.msgs, { send, recv }],
    },
  };
}

/** Removing a send or a receive removes its whole message. */
export function remove(d: Diagram, id: string): Diagram {
  const msg = d.msgs.find((m) => m.send === id || m.recv === id);
  const gone = new Set(msg ? [msg.send, msg.recv] : [id]);
  return {
    ...d,
    events: d.events.filter((e) => !gone.has(e.id)),
    msgs: d.msgs.filter((m) => !gone.has(m.send)),
  };
}

// ---- Examples.

const ev = (id: string, proc: number, t: number): Ev => ({ id, proc, t });

/**
 * P1 writes and tells P2, P2 forwards to P3, while P3 does its own work and
 * later reports back to P1. P2's clock runs 9 ms slow and the first message
 * takes 3 ms, so physical timestamps say it arrived before it was sent.
 */
export const examples: Record<string, { label: string; diagram: Diagram; pick: string[] }> = {
  skew: {
    label: "Skewed clocks",
    diagram: {
      events: [
        ev("a1", 0, 4),
        ev("a2", 0, 12),
        ev("b1", 1, 15),
        ev("b2", 1, 24),
        ev("c1", 2, 8),
        ev("c2", 2, 20),
        ev("c3", 2, 30),
        ev("c4", 2, 38),
        ev("a3", 0, 46),
        ev("b3", 1, 50),
      ],
      msgs: [
        { send: "a2", recv: "b1" },
        { send: "b2", recv: "c3" },
        { send: "c4", recv: "a3" },
      ],
      offsets: [0, -9, 4],
    },
    pick: ["a2", "b1"],
  },
  // Three processes that never talk until the end: Lamport numbers climb
  // independently, so they order unrelated events by how busy each process was.
  concurrent: {
    label: "Mostly concurrent",
    diagram: {
      events: [
        ev("a1", 0, 6),
        ev("a2", 0, 14),
        ev("a3", 0, 22),
        ev("a4", 0, 30),
        ev("b1", 1, 10),
        ev("b2", 1, 40),
        ev("c1", 2, 18),
        ev("c2", 2, 26),
        ev("c3", 2, 46),
        ev("b3", 1, 54),
      ],
      msgs: [
        { send: "a4", recv: "b2" },
        { send: "c3", recv: "b3" },
      ],
      offsets: [0, 0, 0],
    },
    pick: ["a3", "c1"],
  },
};

export const exampleNames = Object.keys(examples);

export const cloneDiagram = (d: Diagram): Diagram => ({
  events: d.events.map((e) => ({ ...e })),
  msgs: d.msgs.map((m) => ({ ...m })),
  offsets: [...d.offsets],
});
