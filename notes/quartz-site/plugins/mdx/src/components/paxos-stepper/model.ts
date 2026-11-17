// Single-decree Paxos (Lamport, "Paxos Made Simple", 2001) as a state machine
// the reader drives one message at a time. Two proposers (P1, P2) and three
// acceptors (A1..A3); any two acceptors form a majority. P1 numbers its rounds
// 1, 3, 5, ... and P2 numbers its rounds 2, 4, 6, ..., so no two rounds share
// a number.
//
// The acceptor rules are the ones in Lamport's paper and in the TLA+
// specification (tlaplus/Examples, specifications/Paxos/Paxos.tla):
//   prepare(n): if n is greater than every number it has promised, promise n
//               and report its highest-numbered accepted proposal;
//   accept(n,v): unless it has promised a number greater than n, accept.
// Acceptors ignore requests they reject (no NACKs), so a proposer whose round
// has been overtaken finds out only when its timer fires.
//
// Everything the figure shows, including which values are chosen, is computed
// here. The tests check it against an exhaustive search of small instances.

export const PROPOSERS = ["P1", "P2"] as const;
export const ACCEPTORS = ["A1", "A2", "A3"] as const;
export type PId = (typeof PROPOSERS)[number];
export type AId = (typeof ACCEPTORS)[number];
export type NodeId = PId | AId;
export const NODES: readonly NodeId[] = [...PROPOSERS, ...ACCEPTORS];
export const MAJORITY = 2;

export type MsgKind = "prepare" | "promise" | "accept" | "accepted";
export interface Vote {
  n: number;
  v: string;
}
export interface Msg {
  id: number;
  from: NodeId;
  to: NodeId;
  kind: MsgKind;
  n: number;
  /** promise: the acceptor's highest-numbered accepted proposal, if any. */
  prev?: Vote | null;
  /** accept and accepted: the value. */
  v?: string;
}

export interface Acceptor {
  /** Highest round number promised (0: none). */
  promised: number;
  accepted: Vote | null;
}

export type Phase = "idle" | "preparing" | "accepting" | "learned";
export interface Proposer {
  /** Current round number (0: has not started a round). */
  n: number;
  phase: Phase;
  own: string;
  /** Promises received for round n. */
  promises: Partial<Record<AId, Vote | null>>;
  /** The value sent in phase 2 of round n. */
  value: string | null;
  /** Acceptors that reported accepting round n. */
  acks: AId[];
  crashed: boolean;
  rounds: number;
}

export type Matcher = { from?: NodeId; to?: NodeId; kind?: MsgKind };
export type Action =
  | { type: "next" }
  | { type: "deliver"; id: number }
  | { type: "drop"; id: number }
  | { type: "deliverWhere"; m: Matcher }
  | { type: "start"; p: PId }
  | { type: "crash"; p: PId }
  | { type: "recover"; p: PId };

export type Mode = "fifo" | "duel";

export interface Sim {
  acc: Record<AId, Acceptor>;
  prop: Record<PId, Proposer>;
  inFlight: Msg[];
  nextId: number;
  /** Every vote ever cast, in order: the record from which "chosen" is read. */
  votes: { a: AId; n: number; v: string }[];
  /** Phase 2a rule: propose the highest-numbered reported value (true is Paxos). */
  adopt: boolean;
  mode: Mode;
  /** Scripted steps that Next takes first. */
  script: Action[];
  sent: number;
  history: string[];
  /** The message delivered or lost by the last step, drawn as an arrow. */
  last: (Pick<Msg, "from" | "to" | "kind"> & { outcome: "used" | "ignored" | "lost" }) | null;
}

export const isA = (n: NodeId): n is AId => n.startsWith("A");

function clone(s: Sim): Sim {
  return {
    ...s,
    acc: Object.fromEntries(ACCEPTORS.map((a) => [a, { ...s.acc[a] }])) as Sim["acc"],
    prop: Object.fromEntries(
      PROPOSERS.map((p) => [p, { ...s.prop[p], promises: { ...s.prop[p].promises }, acks: [...s.prop[p].acks] }]),
    ) as Sim["prop"],
    inFlight: [...s.inFlight],
    votes: [...s.votes],
    script: [...s.script],
    history: [...s.history],
  };
}

export function initial(opts: { adopt?: boolean; mode?: Mode; script?: Action[] } = {}): Sim {
  const prop = (own: string): Proposer => ({ n: 0, phase: "idle", own, promises: {}, value: null, acks: [], crashed: false, rounds: 0 });
  return {
    acc: { A1: { promised: 0, accepted: null }, A2: { promised: 0, accepted: null }, A3: { promised: 0, accepted: null } },
    prop: { P1: prop("x"), P2: prop("y") },
    inFlight: [],
    nextId: 1,
    votes: [],
    adopt: opts.adopt ?? true,
    mode: opts.mode ?? "fifo",
    script: opts.script ?? [],
    sent: 0,
    history: [],
    last: null,
  };
}

/** The round number a proposer uses for its k-th round (k from 1). */
export const roundNumber = (p: PId, k: number): number => 2 * (k - 1) + (p === "P1" ? 1 : 2);

const voteText = (x: Vote | null | undefined) => (x ? `(n=${x.n}, ${x.v})` : "nothing");

export function kindLabel(m: Pick<Msg, "kind" | "n" | "prev" | "v">): string {
  switch (m.kind) {
    case "prepare":
      return `prepare ${m.n}`;
    case "promise":
      return m.prev ? `promise ${m.n}, had ${m.prev.v}@${m.prev.n}` : `promise ${m.n}`;
    case "accept":
      return `accept ${m.n}, ${m.v}`;
    case "accepted":
      return `accepted ${m.n}, ${m.v}`;
  }
}

function send(s: Sim, from: NodeId, to: NodeId, kind: MsgKind, extra: Partial<Msg> & { n: number }) {
  s.inFlight.push({ id: s.nextId++, from, to, kind, ...extra });
  s.sent++;
}

/** Values chosen so far: v is chosen when a majority of acceptors accepted (n, v) for one n. */
export function chosen(s: Sim): { v: string; n: number; by: AId[] }[] {
  const out: { v: string; n: number; by: AId[] }[] = [];
  const byRound = new Map<number, Map<string, Set<AId>>>();
  for (const x of s.votes) {
    const r = byRound.get(x.n) ?? new Map<string, Set<AId>>();
    const set = r.get(x.v) ?? new Set<AId>();
    set.add(x.a);
    r.set(x.v, set);
    byRound.set(x.n, r);
  }
  for (const [n, r] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
    for (const [v, set] of r) {
      if (set.size >= MAJORITY) out.push({ v, n, by: ACCEPTORS.filter((a) => set.has(a)) });
    }
  }
  return out;
}

export const chosenValues = (s: Sim): string[] => [...new Set(chosen(s).map((c) => c.v))];

function start(s: Sim, p: PId) {
  const pr = s.prop[p];
  if (pr.crashed) return;
  pr.rounds++;
  pr.n = roundNumber(p, pr.rounds);
  pr.phase = "preparing";
  pr.promises = {};
  pr.value = null;
  pr.acks = [];
  for (const a of ACCEPTORS) send(s, p, a, "prepare", { n: pr.n });
  s.history.push(`${p} starts round ${pr.n} and sends prepare ${pr.n} to every acceptor.`);
}

/** The value a proposer sends in phase 2, given the promises it holds. */
export function pickValue(pr: Proposer, adopt: boolean): { v: string; from: Vote | null } {
  const reported = Object.values(pr.promises).filter((x): x is Vote => !!x);
  if (!adopt || !reported.length) return { v: pr.own, from: null };
  const top = reported.reduce((a, b) => (b.n > a.n ? b : a));
  return { v: top.v, from: top };
}

function deliver(s: Sim, m: Msg) {
  s.inFlight = s.inFlight.filter((x) => x.id !== m.id);
  const before = s.history.length;
  deliverTo(s, m);
  const said = s.history.slice(before).join(" ");
  s.last = { from: m.from, to: m.to, kind: m.kind, outcome: / ignores |^$/.test(said) ? "ignored" : "used" };
}

function deliverTo(s: Sim, m: Msg) {
  if (isA(m.to)) {
    const a = s.acc[m.to];
    if (m.kind === "prepare") {
      if (m.n > a.promised) {
        a.promised = m.n;
        send(s, m.to, m.from, "promise", { n: m.n, prev: a.accepted ? { ...a.accepted } : null });
        s.history.push(`${m.to} promises ${m.n} to ${m.from} and reports ${voteText(a.accepted)}.`);
      } else {
        s.history.push(`${m.to} ignores prepare ${m.n}: it has promised ${a.promised}.`);
      }
    } else if (m.kind === "accept") {
      if (m.n >= a.promised) {
        a.promised = m.n;
        a.accepted = { n: m.n, v: m.v! };
        s.votes.push({ a: m.to, n: m.n, v: m.v! });
        send(s, m.to, m.from, "accepted", { n: m.n, v: m.v });
        const now = chosen(s);
        const fresh = now.find((c) => c.n === m.n && c.v === m.v && c.by.length === MAJORITY && c.by.includes(m.to as AId));
        s.history.push(`${m.to} accepts (n=${m.n}, ${m.v}).` + (fresh ? ` A majority has now accepted it, so ${m.v} is chosen in round ${m.n}.` : ""));
      } else {
        s.history.push(`${m.to} ignores accept ${m.n}: it has promised ${a.promised}.`);
      }
    }
    return;
  }
  const p = m.to as PId;
  const pr = s.prop[p];
  if (pr.crashed) return;
  const from = m.from as AId;
  if (m.kind === "accepted" && (pr.phase !== "accepting" || m.n !== pr.n)) {
    s.history.push(`${p} ignores ${from}'s accepted ${m.n}: it is no longer waiting for it.`);
    return;
  }
  if (m.kind === "promise") {
    if (pr.phase !== "preparing" || m.n !== pr.n) {
      s.history.push(`${p} ignores ${from}'s promise ${m.n}: it no longer needs it.`);
      return;
    }
    pr.promises[from] = m.prev ?? null;
    const count = Object.keys(pr.promises).length;
    if (count < MAJORITY) {
      s.history.push(`${p} has ${count} promise for round ${pr.n} and needs ${MAJORITY}.`);
      return;
    }
    const pick = pickValue(pr, s.adopt);
    pr.value = pick.v;
    pr.phase = "accepting";
    for (const a of ACCEPTORS) send(s, p, a, "accept", { n: pr.n, v: pick.v });
    const why = pick.from
      ? `the highest-numbered proposal reported, ${voteText(pick.from)}`
      : Object.values(pr.promises).some((x) => x)
        ? `its own value, ignoring the reported proposal (the rule is switched off)`
        : `its own value, since no promise reported a proposal`;
    s.history.push(`${p} has a majority of promises and sends accept (${pr.n}, ${pick.v}): ${why}.`);
  } else if (m.kind === "accepted") {
    if (pr.phase !== "accepting" || m.n !== pr.n) return;
    if (!pr.acks.includes(from)) pr.acks.push(from);
    if (pr.acks.length >= MAJORITY) {
      pr.phase = "learned";
      s.history.push(`${p} hears from a majority that (n=${pr.n}, ${pr.value}) was accepted and learns that ${pr.value} is chosen.`);
    } else s.history.push(`${p} hears that ${from} accepted (n=${pr.n}, ${pr.value}).`);
  }
}

const matches = (m: Msg, q: Matcher) => (!q.from || m.from === q.from) && (!q.to || m.to === q.to) && (!q.kind || m.kind === q.kind);

/** Whether delivering this message now would change an acceptor's state. */
const wouldAccept = (s: Sim, m: Msg) => m.kind === "accept" && isA(m.to) && m.n >= s.acc[m.to].promised;

/**
 * The step Next takes when no scripted step is left. FIFO delivers the oldest
 * message. The duelling scheduler is the adversary from Paxos Made Simple
 * section 2.4: whenever one proposer's accept requests could succeed, the
 * other proposer's timer fires first and its prepare requests arrive first.
 */
export function defaultAction(s: Sim): Action | null {
  const live = s.inFlight.filter((m) => !(PROPOSERS as readonly string[]).includes(m.to) || !s.prop[m.to as PId].crashed);
  if (s.mode === "duel") {
    const first = (pred: (m: Msg) => boolean) => live.find(pred);
    const order: ((m: Msg) => boolean)[] = [
      (m) => m.kind === "prepare",
      (m) => m.kind === "promise",
      (m) => m.kind === "accept" && !wouldAccept(s, m),
    ];
    for (const pred of order) {
      const m = first(pred);
      if (m) return { type: "deliver", id: m.id };
    }
    for (const p of PROPOSERS) {
      const pr = s.prop[p];
      const other = p === "P1" ? "P2" : "P1";
      if (pr.phase === "accepting" && live.some((m) => m.from === p && wouldAccept(s, m)) && !s.prop[other].crashed && s.prop[other].n < pr.n)
        return { type: "start", p: other };
    }
  }
  const m = live[0];
  if (m) return { type: "deliver", id: m.id };
  return null;
}

/** The step Next will take, or null if there is nothing left to do. */
export function nextAction(s: Sim): Action | null {
  for (const a of s.script) {
    const r = resolve(s, a);
    if (r) return r;
  }
  return defaultAction(s);
}

function resolve(s: Sim, a: Action): Action | null {
  if (a.type === "deliverWhere") {
    const m = s.inFlight.find((x) => matches(x, a.m));
    return m ? { type: "deliver", id: m.id } : null;
  }
  return a;
}

export function describeNext(s: Sim): string {
  const a = nextAction(s);
  if (!a) return "Nothing left to deliver.";
  if (a.type === "start") return `Next: ${a.p}'s timer fires and it starts a new round.`;
  if (a.type === "crash") return `Next: ${a.p} crashes.`;
  if (a.type === "deliver") {
    const m = s.inFlight.find((x) => x.id === a.id)!;
    return `Next: deliver ${m.from} → ${m.to} ${kindLabel(m)}.`;
  }
  return "";
}

export function apply(s0: Sim, a: Action): Sim {
  if (a.type === "next") {
    const step = nextAction(s0);
    if (!step) return s0;
    const s = apply(s0, step);
    // Consume scripted steps up to and including the one just taken.
    const idx = s0.script.findIndex((x) => resolve(s0, x) !== null);
    if (idx >= 0 && s !== s0) s.script = s0.script.slice(idx + 1);
    return s;
  }
  const s = clone(s0);
  s.last = null;
  switch (a.type) {
    case "deliver": {
      const m = s.inFlight.find((x) => x.id === a.id);
      if (!m) return s0;
      deliver(s, m);
      break;
    }
    case "deliverWhere": {
      const m = s.inFlight.find((x) => matches(x, a.m));
      if (!m) return s0;
      deliver(s, m);
      break;
    }
    case "drop": {
      const m = s.inFlight.find((x) => x.id === a.id);
      if (!m) return s0;
      s.inFlight = s.inFlight.filter((x) => x.id !== a.id);
      s.history.push(`The network loses ${m.from} → ${m.to} ${kindLabel(m)}.`);
      s.last = { from: m.from, to: m.to, kind: m.kind, outcome: "lost" };
      break;
    }
    case "start":
      if (s.prop[a.p].crashed) return s0;
      start(s, a.p);
      break;
    case "crash": {
      if (s.prop[a.p].crashed) return s0;
      s.prop[a.p].crashed = true;
      const lost = s.inFlight.filter((m) => m.from === a.p || m.to === a.p).length;
      s.inFlight = s.inFlight.filter((m) => m.from !== a.p && m.to !== a.p);
      s.history.push(`${a.p} crashes. ${lost} message${lost === 1 ? "" : "s"} to or from it ${lost === 1 ? "is" : "are"} lost.`);
      break;
    }
    case "recover":
      if (!s.prop[a.p].crashed) return s0;
      s.prop[a.p].crashed = false;
      s.prop[a.p].phase = "idle";
      s.history.push(`${a.p} recovers. It remembers its last round number and starts again from idle.`);
      break;
  }
  return s;
}

/** A manual action by the reader: it abandons the rest of the script. */
export function manual(s: Sim, a: Action): Sim {
  const t = apply(s, a);
  if (t === s) return s;
  t.script = [];
  return t;
}

export interface Preset {
  label: string;
  build: (adopt?: boolean) => Sim;
}

const D = (from: NodeId, to: NodeId, kind: MsgKind): Action => ({ type: "deliverWhere", m: { from, to, kind } });

export const presets: Record<string, Preset> = {
  basic: {
    label: "One proposer, no failures",
    build: (adopt = true) => apply(initial({ adopt }), { type: "start", p: "P1" }),
  },
  takeover: {
    label: "P1 crashes after x is chosen; P2 takes over",
    build: (adopt = true) =>
      apply(
        initial({
          adopt,
          script: [
            D("P1", "A1", "prepare"),
            D("P1", "A2", "prepare"),
            D("P1", "A3", "prepare"),
            D("A1", "P1", "promise"),
            D("A2", "P1", "promise"),
            D("A3", "P1", "promise"),
            D("P1", "A1", "accept"),
            D("P1", "A2", "accept"),
            { type: "crash", p: "P1" },
            { type: "start", p: "P2" },
            D("P2", "A2", "prepare"),
            D("P2", "A3", "prepare"),
            D("A2", "P2", "promise"),
            D("A3", "P2", "promise"),
            D("P2", "A2", "accept"),
            D("P2", "A3", "accept"),
            D("A2", "P2", "accepted"),
            D("A3", "P2", "accepted"),
          ],
        }),
        { type: "start", p: "P1" },
      ),
  },
  duel: {
    label: "Two proposers keep pre-empting each other",
    build: (adopt = true) => apply(initial({ adopt, mode: "duel" }), { type: "start", p: "P1" }),
  },
};

export const startPreset = (key: unknown): string => (typeof key === "string" && key in presets ? key : "basic");

export function summarize(s: Sim): { tone: "good" | "bad" | "warn" | "neutral"; headline: string } {
  const c = chosen(s);
  const values = [...new Set(c.map((x) => x.v))];
  if (values.length > 1) {
    const parts = values.map((v) => {
      const first = c.find((x) => x.v === v)!;
      return `${v} in round ${first.n} (${first.by.join(", ")})`;
    });
    return { tone: "bad", headline: `Two different values are chosen: ${parts.join(" and ")}. Agreement is violated.` };
  }
  if (values.length === 1) {
    const rounds = c.map((x) => `${x.n} (${x.by.join(", ")})`);
    const learners = PROPOSERS.filter((p) => s.prop[p].phase === "learned");
    return {
      tone: "good",
      headline:
        `${values[0]} is chosen: a majority accepted it in round ${rounds.join(" and in round ")}.` +
        (learners.length ? ` ${learners.join(" and ")} ${learners.length > 1 ? "have" : "has"} learned it.` : " No proposer has learned it yet."),
    };
  }
  const rounds = PROPOSERS.reduce((t, p) => t + s.prop[p].rounds, 0);
  if (s.mode === "duel" && rounds > 2) return { tone: "warn", headline: `Nothing is chosen after ${rounds} rounds, although no message has been lost and no process has crashed.` };
  return { tone: "neutral", headline: "Nothing is chosen yet." };
}
