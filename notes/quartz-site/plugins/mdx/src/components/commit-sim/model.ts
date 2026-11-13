// Two-phase commit as a state machine the reader can drive one event at a
// time. One coordinator (C) and three participants (P1..P3) run the textbook
// protocol of Bernstein, Hadzilacos and Goodman (1987, ch. 7): forced log
// writes before every vote and every commit decision, timeouts, recovery from
// the log, and optionally the cooperative termination protocol, in which an
// uncertain participant asks the other participants as well as the
// coordinator.
//
// Everything the figure shows is computed here: node states, logs, locks, the
// messages in flight, and whether an uncertain participant is blocked. Tests
// drive random runs through the same functions and check the atomic
// commitment properties.

export const PARTICIPANTS = ["P1", "P2", "P3"] as const;
export const NODES = ["C", ...PARTICIPANTS] as const;
export type NodeId = (typeof NODES)[number];
export type PId = (typeof PARTICIPANTS)[number];

export type MsgKind = "prepare" | "yes" | "no" | "commit" | "abort" | "ack" | "query" | "unknown";

export interface Msg {
  id: number;
  from: NodeId;
  to: NodeId;
  kind: MsgKind;
}

export interface LogRec {
  text: string;
  forced: boolean;
}

/**
 * Participant states, as BHG name the periods: "working" before it votes,
 * "uncertain" after a yes vote until it learns the decision.
 */
export type PState = "working" | "uncertain" | "committed" | "aborted";
/** Coordinator states. "idle": the client hasn't asked to commit yet. */
export type CState = "idle" | "waiting" | "committed" | "aborted" | "done";

export interface Sim {
  up: Record<NodeId, boolean>;
  log: Record<NodeId, LogRec[]>;
  /** Volatile state. A crash loses it; recovery rebuilds it from the log. */
  c: { state: CState; votes: Partial<Record<PId, "yes" | "no">>; acks: PId[] };
  p: Record<PId, PState>;
  /** Participants that will vote no when asked. */
  voteNo: PId[];
  cooperative: boolean;
  /** Cut links, as "A-B" with A before B in NODES order. */
  cut: string[];
  inFlight: Msg[];
  nextId: number;
  sent: number;
  forced: number;
  /** One sentence per event, newest last. */
  history: string[];
  /**
   * Set when a round of timeouts changed nothing. Next then stops offering
   * more rounds until the reader changes something (a crash, a recovery, a
   * cut or healed link), so a blocked system shows one futile round of
   * retries and then says it is stuck.
   */
  stuck: boolean;
}

export type Action =
  | { type: "next" }
  | { type: "deliver"; id: number }
  | { type: "lose"; id: number }
  | { type: "begin" }
  | { type: "timeouts" }
  | { type: "crash"; node: NodeId }
  | { type: "recover"; node: NodeId }
  | { type: "cut"; a: NodeId; b: NodeId }
  | { type: "voteNo"; node: PId; on: boolean }
  | { type: "cooperative"; on: boolean };

export const isP = (n: NodeId): n is PId => n !== "C";

export const linkKey = (a: NodeId, b: NodeId): string =>
  NODES.indexOf(a) < NODES.indexOf(b) ? `${a}-${b}` : `${b}-${a}`;

export const LINKS: [NodeId, NodeId][] = [
  ["C", "P1"],
  ["C", "P2"],
  ["C", "P3"],
  ["P1", "P2"],
  ["P2", "P3"],
  ["P1", "P3"],
];

export function initial(options: { cooperative?: boolean; voteNo?: PId[] } = {}): Sim {
  return {
    up: { C: true, P1: true, P2: true, P3: true },
    log: { C: [], P1: [], P2: [], P3: [] },
    c: { state: "idle", votes: {}, acks: [] },
    p: { P1: "working", P2: "working", P3: "working" },
    voteNo: [...(options.voteNo ?? [])],
    cooperative: options.cooperative ?? true,
    cut: [],
    inFlight: [],
    nextId: 1,
    sent: 0,
    forced: 0,
    history: [],
    stuck: false,
  };
}

export const clone = (s: Sim): Sim => JSON.parse(JSON.stringify(s));

const KIND_LABEL: Record<MsgKind, string> = {
  prepare: "PREPARE",
  yes: "YES",
  no: "NO",
  commit: "COMMIT",
  abort: "ABORT",
  ack: "ACK",
  query: "ASK",
  unknown: "UNSURE",
};
export const kindLabel = (k: MsgKind): string => KIND_LABEL[k];

// ---------------------------------------------------------------------------
// Primitive steps. Each mutates the clone it is given.

function send(s: Sim, from: NodeId, to: NodeId, kind: MsgKind): void {
  s.inFlight.push({ id: s.nextId++, from, to, kind });
  s.sent++;
}

function write(s: Sim, node: NodeId, text: string, forced: boolean): void {
  s.log[node].push({ text, forced });
  if (forced) s.forced++;
}

const note = (s: Sim, line: string) => s.history.push(line);

/** The decision a node's log records, if any. */
export function loggedDecision(s: Sim, node: NodeId): "commit" | "abort" | null {
  for (const r of s.log[node]) {
    if (r.text === "commit") return "commit";
    if (r.text === "abort") return "abort";
  }
  return null;
}

const hasRecord = (s: Sim, node: NodeId, text: string) => s.log[node].some((r) => r.text === text);

/** Locks are held from execution until the participant learns the outcome. */
export const holdsLocks = (s: Sim, p: PId): boolean => s.p[p] === "working" || s.p[p] === "uncertain";

function decideC(s: Sim, decision: "commit" | "abort"): void {
  // The commit record is forced: once it's on disk the transaction is
  // committed. An abort record needn't be, because a coordinator that finds
  // no decision in its log aborts anyway.
  write(s, "C", decision, decision === "commit");
  s.c.state = decision === "commit" ? "committed" : "aborted";
  s.c.acks = [];
  for (const p of PARTICIPANTS) {
    if (decision === "abort" && s.c.votes[p] === "no") continue; // it already aborted
    send(s, "C", p, decision);
  }
}

function finishP(s: Sim, p: PId, decision: "commit" | "abort"): void {
  write(s, p, decision, decision === "commit");
  s.p[p] = decision === "commit" ? "committed" : "aborted";
}

function deliverMsg(s: Sim, m: Msg): void {
  s.inFlight = s.inFlight.filter((x) => x.id !== m.id);
  const label = `${m.from} → ${m.to} ${kindLabel(m.kind)}`;
  if (s.cut.includes(linkKey(m.from, m.to))) {
    note(s, `${label} was lost: the link is cut.`);
    return;
  }
  if (!s.up[m.to]) {
    note(s, `${label} was lost: ${m.to} is down.`);
    return;
  }
  if (m.to === "C") deliverToC(s, m, label);
  else deliverToP(s, m.to, m, label);
}

function deliverToC(s: Sim, m: Msg, label: string): void {
  const from = m.from as PId;
  const c = s.c;
  if (m.kind === "yes" || m.kind === "no") {
    if (c.state !== "waiting") {
      note(s, `${label} arrived after C had already decided; C ignores it.`);
      return;
    }
    c.votes[from] = m.kind;
    if (m.kind === "no") {
      note(s, `${label}: one no vote is enough. C decides abort and tells the others.`);
      decideC(s, "abort");
    } else if (PARTICIPANTS.every((p) => c.votes[p] === "yes")) {
      note(s, `${label}: every vote is yes. C forces a commit record, and the transaction is now committed.`);
      decideC(s, "commit");
    } else {
      const missing = PARTICIPANTS.filter((p) => !c.votes[p]).join(", ");
      note(s, `${label}: C still waits for ${missing}.`);
    }
  } else if (m.kind === "ack") {
    if (!c.acks.includes(from)) c.acks.push(from);
    if ((c.state === "committed" || c.state === "aborted") && expectedAcks(s).every((p) => c.acks.includes(p))) {
      write(s, "C", "end", false);
      c.state = "done";
      note(s, `${label}: every participant has the decision. C writes an end record and can forget the transaction.`);
    } else note(s, `${label}.`);
  } else if (m.kind === "query") {
    const decision = c.state === "committed" || c.state === "aborted" ? c.state : c.state === "done" ? loggedDecision(s, "C") : null;
    if (decision) {
      const kind = decision === "committed" || decision === "commit" ? "commit" : "abort";
      send(s, "C", from, kind);
      note(s, `${label}: C answers ${kindLabel(kind)}.`);
    } else note(s, `${label}: C hasn't decided yet; its decision will reach ${from} when it has.`);
  } else note(s, `${label}.`);
}

/** Participants the coordinator waits on for an ACK of its decision. */
function expectedAcks(s: Sim): PId[] {
  const d = loggedDecision(s, "C");
  return PARTICIPANTS.filter((p) => !(d === "abort" && s.c.votes[p] === "no"));
}

function deliverToP(s: Sim, p: PId, m: Msg, label: string): void {
  const st = s.p[p];
  switch (m.kind) {
    case "prepare":
      if (st === "working") {
        if (s.voteNo.includes(p)) {
          write(s, p, "abort", false);
          s.p[p] = "aborted";
          send(s, p, "C", "no");
          note(s, `${label}: ${p} can't commit, so it aborts on its own, releases its locks and votes no.`);
        } else {
          write(s, p, "prepared", true);
          s.p[p] = "uncertain";
          send(s, p, "C", "yes");
          note(s, `${label}: ${p} forces a prepared record and votes yes. From now on it can't abort on its own.`);
        }
      } else if (st === "uncertain") {
        send(s, p, "C", "yes");
        note(s, `${label}: ${p} already voted yes and says so again.`);
      } else if (st === "aborted") {
        send(s, p, "C", "no");
        note(s, `${label}: ${p} already aborted, so it votes no.`);
      } else note(s, `${label}: ${p} already committed and ignores it.`);
      return;
    case "commit":
    case "abort": {
      const fromC = m.from === "C";
      if (st === "uncertain" || st === "working") {
        if (m.kind === "commit" && st === "working") {
          // Can't happen: commit needs this participant's yes vote.
          note(s, `${label}: impossible, ${p} never voted.`);
          return;
        }
        finishP(s, p, m.kind);
        note(
          s,
          `${label}: ${p} ${m.kind === "commit" ? "forces a commit record, applies its writes" : "writes an abort record, undoes its writes"} and releases its locks.`,
        );
      } else note(s, `${label}: ${p} already knows.`);
      if (fromC) send(s, p, "C", "ack");
      return;
    }
    case "query": {
      const asker = m.from as PId;
      if (st === "committed" || st === "aborted") {
        const kind = st === "committed" ? "commit" : "abort";
        send(s, p, asker, kind);
        note(s, `${label}: ${p} knows the outcome and answers ${kindLabel(kind)}.`);
      } else if (st === "working") {
        // It hasn't voted, so it may still abort, and that settles it.
        finishP(s, p, "abort");
        send(s, p, asker, "abort");
        note(s, `${label}: ${p} hasn't voted yet, so it aborts on its own and answers ABORT.`);
      } else {
        send(s, p, asker, "unknown");
        note(s, `${label}: ${p} is uncertain too and can't help.`);
      }
      return;
    }
    case "unknown":
      note(s, `${label}.`);
      return;
    default:
      note(s, `${label}.`);
  }
}

function begin(s: Sim): void {
  write(s, "C", "start 2PC", false);
  s.c.state = "waiting";
  for (const p of PARTICIPANTS) send(s, "C", p, "prepare");
  note(s, "The client asks C to commit. C sends PREPARE to every participant.");
}

/** Whether any node has a timer that would fire now. */
export function timersPending(s: Sim): boolean {
  if (s.up.C && s.c.state === "waiting") return true;
  if (s.up.C && (s.c.state === "committed" || s.c.state === "aborted")) return true;
  return PARTICIPANTS.some((p) => s.up[p] && (s.p[p] === "uncertain" || (s.p[p] === "working" && s.c.state !== "idle")));
}

function fireTimeouts(s: Sim): void {
  const lines: string[] = [];
  if (s.up.C && s.c.state === "waiting") {
    lines.push("C gave up waiting for votes and aborts");
    decideC(s, "abort");
  } else if (s.up.C && (s.c.state === "committed" || s.c.state === "aborted")) {
    const missing = expectedAcks(s).filter((p) => !s.c.acks.includes(p));
    for (const p of missing) send(s, "C", p, s.c.state === "committed" ? "commit" : "abort");
    if (missing.length) lines.push(`C resends its decision to ${missing.join(", ")}`);
  }
  for (const p of PARTICIPANTS) {
    if (!s.up[p]) continue;
    if (s.p[p] === "working" && s.c.state !== "idle") {
      finishP(s, p, "abort");
      lines.push(`${p} never got PREPARE, so it aborts on its own`);
    } else if (s.p[p] === "uncertain") {
      const asked = s.cooperative ? NODES.filter((n) => n !== p) : (["C"] as NodeId[]);
      for (const n of asked) send(s, p, n, "query");
      lines.push(`${p} is uncertain and asks ${asked.join(", ")} for the decision`);
    }
  }
  note(s, lines.length ? `Timeouts: ${lines.join("; ")}.` : "Timeouts fire, and nothing changes.");
}

function crash(s: Sim, n: NodeId): void {
  if (!s.up[n]) return;
  s.up[n] = false;
  if (n === "C") {
    s.c = { state: s.c.state === "idle" ? "idle" : s.c.state, votes: {}, acks: [] };
    note(s, "C crashes. It loses everything not in its log.");
  } else note(s, `${n} crashes. It loses everything not in its log.`);
}

function recover(s: Sim, n: NodeId): void {
  if (s.up[n]) return;
  s.up[n] = true;
  if (n === "C") {
    const d = loggedDecision(s, "C");
    if (hasRecord(s, "C", "end")) {
      s.c = { state: "done", votes: {}, acks: [] };
      note(s, "C recovers and finds an end record: nothing left to do.");
    } else if (d) {
      s.c = { state: d === "commit" ? "committed" : "aborted", votes: {}, acks: [] };
      for (const p of PARTICIPANTS) send(s, "C", p, d);
      note(s, `C recovers, finds a ${d} record and sends the decision to every participant again.`);
    } else if (hasRecord(s, "C", "start 2PC")) {
      // No decision on disk, so no participant can have committed: abort.
      s.c = { state: "waiting", votes: {}, acks: [] };
      decideC(s, "abort");
      note(s, "C recovers without a decision in its log. Nobody can have committed, so it aborts.");
    } else {
      s.c = { state: "idle", votes: {}, acks: [] };
      note(s, "C recovers. The transaction hadn't started its commit.");
    }
    return;
  }
  const d = loggedDecision(s, n);
  if (d) {
    s.p[n] = d === "commit" ? "committed" : "aborted";
    note(s, `${n} recovers and redoes what its log says: ${d}.`);
  } else if (hasRecord(s, n, "prepared")) {
    s.p[n] = "uncertain";
    note(s, `${n} recovers with a prepared record and no decision. It re-takes its locks and is uncertain.`);
  } else {
    finishP(s, n, "abort");
    note(s, `${n} recovers without a prepared record. It never voted yes, so it aborts.`);
  }
}

/** The event "Next" would run, if any. */
export function nextAction(s: Sim): Action | null {
  if (s.inFlight.length) return { type: "deliver", id: s.inFlight[0].id };
  if (s.c.state === "idle" && s.up.C) return { type: "begin" };
  if (timersPending(s) && (!s.stuck || timeoutsChangeSomething(s))) return { type: "timeouts" };
  return null;
}

/**
 * A round of timeouts is worth showing only if, followed through, it changes
 * some node's state or log. Otherwise every retry is lost or unanswered and
 * the system is stuck until the reader recovers a node or heals a link.
 */
export function timeoutsChangeSomething(s: Sim): boolean {
  const t = clone(s);
  t.history = [];
  const before = fingerprint(t);
  fireTimeouts(t);
  for (let i = 0; i < 200 && t.inFlight.length; i++) deliverMsg(t, t.inFlight[0]);
  return fingerprint(t) !== before;
}

const fingerprint = (s: Sim): string => JSON.stringify([s.p, s.c.state, s.log]);

export function apply(prev: Sim, action: Action): Sim {
  const s = clone(prev);
  switch (action.type) {
    case "next": {
      const a = nextAction(s);
      return a ? apply(prev, a) : prev;
    }
    case "deliver": {
      const m = s.inFlight.find((x) => x.id === action.id);
      if (m) deliverMsg(s, m);
      return s;
    }
    case "lose": {
      const m = s.inFlight.find((x) => x.id === action.id);
      if (m) {
        s.inFlight = s.inFlight.filter((x) => x.id !== m.id);
        note(s, `${m.from} → ${m.to} ${kindLabel(m.kind)} was lost in the network.`);
      }
      return s;
    }
    case "begin":
      if (s.c.state === "idle" && s.up.C) begin(s);
      return s;
    case "timeouts":
      s.stuck = !timeoutsChangeSomething(s);
      fireTimeouts(s);
      return s;
    case "crash":
      crash(s, action.node);
      s.stuck = false;
      return s;
    case "recover":
      recover(s, action.node);
      s.stuck = false;
      return s;
    case "cut": {
      s.stuck = false;
      const k = linkKey(action.a, action.b);
      if (s.cut.includes(k)) {
        s.cut = s.cut.filter((x) => x !== k);
        note(s, `The link between ${action.a} and ${action.b} is back.`);
      } else {
        s.cut.push(k);
        note(s, `The link between ${action.a} and ${action.b} is cut.`);
      }
      return s;
    }
    case "voteNo":
      s.stuck = false;
      s.voteNo = action.on ? [...new Set([...s.voteNo, action.node])] : s.voteNo.filter((p) => p !== action.node);
      return s;
    case "cooperative":
      s.stuck = false;
      s.cooperative = action.on;
      return s;
  }
}

export const run = (actions: Action[], start: Sim = initial()): Sim => actions.reduce(apply, start);

// ---------------------------------------------------------------------------
// What the figure reports.

/**
 * Whether p learns the outcome if nothing is repaired: deliver every message
 * in flight, let the timers fire, and repeat. This is the definition of not
 * being blocked, computed rather than guessed from the topology.
 */
export function settlesWithoutRepair(s: Sim, p: PId, rounds = 6): boolean {
  const t = clone(s);
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 200 && t.inFlight.length; i++) deliverMsg(t, t.inFlight[0]);
    if (t.p[p] !== "uncertain") return true;
    if (r < rounds - 1) fireTimeouts(t);
  }
  return false;
}

export type PStatus =
  | { kind: "working" | "committed" | "aborted" }
  | { kind: "uncertain"; blocked: boolean; waitingOn: NodeId[] }
  | { kind: "down"; uncertain: boolean };

/**
 * A participant is blocked when it is uncertain and nobody it can reach can
 * tell it the outcome. It then has to keep its locks until a failure is
 * repaired. waitingOn lists the nodes whose recovery (or reconnection) could
 * end the wait.
 */
export function status(s: Sim, p: PId): PStatus {
  if (!s.up[p]) return { kind: "down", uncertain: hasRecord(s, p, "prepared") && !loggedDecision(s, p) };
  if (s.p[p] !== "uncertain") return { kind: s.p[p] } as PStatus;
  if (settlesWithoutRepair(s, p)) return { kind: "uncertain", blocked: false, waitingOn: [] };
  const asked: NodeId[] = s.cooperative ? NODES.filter((n) => n !== p) : ["C"];
  // Of the nodes it can't reach, the ones that could settle it once back.
  const waitingOn = asked.filter((n) => {
    if (s.up[n] && !s.cut.includes(linkKey(p, n))) return false; // reachable, and uncertain too
    if (n === "C") return true;
    if (s.up[n]) return s.p[n] !== "uncertain";
    return loggedDecision(s, n) !== null || !hasRecord(s, n, "prepared");
  });
  return { kind: "uncertain", blocked: true, waitingOn };
}

/** The outcome, once any node knows it. Agreement means there is only one. */
export function outcomes(s: Sim): Set<"commit" | "abort"> {
  const out = new Set<"commit" | "abort">();
  for (const n of NODES) {
    const d = loggedDecision(s, n);
    if (d) out.add(d);
  }
  return out;
}

export interface Summary {
  headline: string;
  tone: "neutral" | "good" | "bad" | "warn";
}

export function summarize(s: Sim): Summary {
  const out = outcomes(s);
  if (out.size > 1) return { headline: "Atomicity violated: some node committed and another aborted.", tone: "bad" };
  const statuses = PARTICIPANTS.map((p) => [p, status(s, p)] as const);
  const blocked = statuses.filter(([, st]) => st.kind === "uncertain" && st.blocked).map(([p]) => p);
  const uncertainDown = statuses.filter(([, st]) => st.kind === "down" && st.uncertain).map(([p]) => p);
  const decided = PARTICIPANTS.filter((p) => s.p[p] === "committed" || s.p[p] === "aborted");
  if (blocked.length) {
    const who = blocked.join(", ");
    return {
      headline: `${who} ${blocked.length > 1 ? "are" : "is"} blocked: uncertain, holding locks, and nobody ${blocked.length > 1 ? "they" : "it"} can reach knows the outcome.`,
      tone: "bad",
    };
  }
  const word = out.has("commit") ? "committed" : out.has("abort") ? "aborted" : null;
  if (word && decided.length === PARTICIPANTS.length && PARTICIPANTS.every((p) => s.up[p]))
    return { headline: `Done: the transaction ${word} everywhere and every lock is released.`, tone: "good" };
  if (word) {
    const pending = PARTICIPANTS.filter((p) => !decided.includes(p) || !s.up[p]);
    return {
      headline: `The transaction has ${word}. ${pending.join(", ")} ${pending.length > 1 ? "don't" : "doesn't"} know yet.${uncertainDown.length ? ` ${uncertainDown.join(", ")} will be uncertain when ${uncertainDown.length > 1 ? "they recover" : "it recovers"}.` : ""}`,
      tone: "warn",
    };
  }
  if (s.c.state === "idle") return { headline: "The transaction has run and every participant holds its locks. Press Next to commit it.", tone: "neutral" };
  const uncertain = PARTICIPANTS.filter((p) => s.p[p] === "uncertain");
  return {
    headline: uncertain.length
      ? `Undecided. ${uncertain.join(", ")} ${uncertain.length > 1 ? "have" : "has"} voted yes and must wait for the outcome.`
      : "Undecided. Votes are on their way.",
    tone: "neutral",
  };
}

// ---------------------------------------------------------------------------
// Scenarios: action sequences that set up a situation worth exploring. They
// run through apply(), so they show the protocol's real behavior.

const deliverNext = (n: number): Action[] => Array.from({ length: n }, () => ({ type: "next" }) as Action);

export const scenarios: Record<string, { label: string; build: () => Sim }> = {
  fresh: { label: "Start: nothing has happened", build: () => initial() },
  no: {
    label: "P2 votes no",
    build: () => initial({ voteNo: ["P2"] }),
  },
  coordCrash: {
    label: "C crashes while votes are in flight",
    build: () => run([{ type: "begin" }, ...deliverNext(5), { type: "crash", node: "C" }]),
  },
  partialCommit: {
    label: "C crashes after telling only P1",
    build: () => {
      let s = run([{ type: "begin" }, ...deliverNext(6)]);
      // C has committed and sent COMMIT to all three. P1 gets it; the other two are lost.
      const [toP1, toP2, toP3] = ["P1", "P2", "P3"].map((p) => s.inFlight.find((m) => m.to === p && m.kind === "commit")!.id);
      s = run(
        [
          { type: "deliver", id: toP1 },
          { type: "lose", id: toP2 },
          { type: "lose", id: toP3 },
          { type: "crash", node: "C" },
        ],
        s,
      );
      return s;
    },
  },
  partition: {
    label: "P3 is cut off from C before the decision arrives",
    build: () => run([{ type: "begin" }, ...deliverNext(6), { type: "cut", a: "C", b: "P3" }]),
  },
};

/** For tests and the readout: one sentence describing what Next would do. */
export function describeNext(s: Sim): string {
  const a = nextAction(s);
  if (!a) return s.c.state === "idle" ? "C is down, so the commit can't start." : "Nothing more will happen until you recover a node or heal a link.";
  if (a.type === "begin") return "Next: C starts the commit.";
  if (a.type === "timeouts") return "Next: no messages are in flight, so timers fire.";
  const m = s.inFlight.find((x) => x.id === (a as { id: number }).id)!;
  return `Next: deliver ${m.from} → ${m.to} ${kindLabel(m.kind)}.`;
}
