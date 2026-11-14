// A two-thread machine small enough to step by hand. Each thread runs a short
// program over two shared words (counter and held) and one private register r.
// Every line is one indivisible step; the reader chooses which thread takes
// the next step, which is exactly the freedom a scheduler has. Nothing here
// touches the DOM, so the tests and the build run it in Node.

export type Var = "counter" | "held";

// `short` is the same line abbreviated, shown instead of `text` at phone width.
export type Instr = { short?: string } & (
  | { k: "load"; v: Var; text: string; cs?: boolean } // r = v
  | { k: "inc"; text: string; cs?: boolean } // r = r + 1
  | { k: "store"; v: Var; text: string; cs?: boolean } // v = r
  | { k: "set"; v: Var; val: number; text: string; cs?: boolean } // v = val
  | { k: "tas"; v: Var; text: string; cs?: boolean } // r = v; v = 1, as one step
  | { k: "jnz"; to: number; text: string; cs?: boolean } // if r != 0 go to line `to`
);

export type ThreadId = "A" | "B";
export const THREADS: ThreadId[] = ["A", "B"];

export interface Preset {
  label: string;
  program: Instr[];
  /** An order worth trying, shown before the first step. */
  hint: string;
}

// Lines marked cs are inside the critical section: a thread whose next line is
// one of them has got past the lock (or, with no lock, is between its load and
// its store) and has not yet released it.
export const PRESETS: Record<string, Preset> = {
  counter: {
    label: "counter = counter + 1, no lock",
    program: [
      { k: "load", v: "counter", text: "r = counter", cs: true },
      { k: "inc", text: "r = r + 1", cs: true },
      { k: "store", v: "counter", text: "counter = r", cs: true },
    ],
    hint: "Try A, then B, then let each finish.",
  },
  "broken-lock": {
    label: "a lock built from a separate load and store",
    program: [
      { k: "load", v: "held", text: "r = held" },
      { k: "jnz", to: 0, text: "if (r != 0) goto 1", short: "if (r) goto 1" },
      { k: "set", v: "held", val: 1, text: "held = 1" },
      { k: "load", v: "counter", text: "r = counter", cs: true },
      { k: "inc", text: "r = r + 1", cs: true },
      { k: "store", v: "counter", text: "counter = r", cs: true },
      { k: "set", v: "held", val: 0, text: "held = 0", cs: true },
    ],
    hint: "Try A, B, A, B, A, B: both read held = 0 before either sets it.",
  },
  tas: {
    label: "a test-and-set spinlock",
    program: [
      { k: "tas", v: "held", text: "r = test_and_set(held)", short: "r = tas(held)" },
      { k: "jnz", to: 0, text: "if (r != 0) goto 1", short: "if (r) goto 1" },
      { k: "load", v: "counter", text: "r = counter", cs: true },
      { k: "inc", text: "r = r + 1", cs: true },
      { k: "store", v: "counter", text: "counter = r", cs: true },
      { k: "set", v: "held", val: 0, text: "held = 0", cs: true },
    ],
    hint: "Try A, B, B, B: B keeps getting 1 back while A holds the lock.",
  },
};

export const DEFAULT_PRESET = "counter";

export interface ThreadState {
  pc: number;
  r: number;
}

export interface Machine {
  preset: string;
  program: Instr[];
  mem: Record<Var, number>;
  th: Record<ThreadId, ThreadState>;
  /** Thread and line number (0-based) of every step taken, in order. */
  trace: { t: ThreadId; line: number }[];
  /** True once both threads have been inside the critical section at the same moment. */
  overlapSeen: boolean;
  /** Times a thread's test_and_set or load of held came back 1. */
  spins: number;
}

export function presetKey(v: unknown): string {
  return typeof v === "string" && v in PRESETS ? v : DEFAULT_PRESET;
}

export function fresh(preset: string): Machine {
  const key = presetKey(preset);
  return {
    preset: key,
    program: PRESETS[key].program,
    mem: { counter: 0, held: 0 },
    th: { A: { pc: 0, r: 0 }, B: { pc: 0, r: 0 } },
    trace: [],
    overlapSeen: false,
    spins: 0,
  };
}

export const done = (m: Machine, t: ThreadId): boolean => m.th[t].pc >= m.program.length;
export const finished = (m: Machine): boolean => done(m, "A") && done(m, "B");
export const inCS = (m: Machine, t: ThreadId): boolean => !done(m, t) && !!m.program[m.th[t].pc].cs;
export const bothInCS = (m: Machine): boolean => inCS(m, "A") && inCS(m, "B");

/** Runs one line of thread t. Does nothing if t has finished. */
export function step(m: Machine, t: ThreadId): void {
  const s = m.th[t];
  if (s.pc >= m.program.length) return;
  const ins = m.program[s.pc];
  m.trace.push({ t, line: s.pc });
  let next = s.pc + 1;
  switch (ins.k) {
    case "load":
      s.r = m.mem[ins.v];
      if (ins.v === "held" && s.r !== 0) m.spins++;
      break;
    case "inc":
      s.r = s.r + 1;
      break;
    case "store":
      m.mem[ins.v] = s.r;
      break;
    case "set":
      m.mem[ins.v] = ins.val;
      break;
    case "tas":
      s.r = m.mem[ins.v];
      m.mem[ins.v] = 1;
      if (s.r !== 0) m.spins++;
      break;
    case "jnz":
      if (s.r !== 0) next = ins.to;
      break;
  }
  s.pc = next;
  if (bothInCS(m)) m.overlapSeen = true;
}

/** Replays an order of thread ids from a fresh machine. */
export function run(preset: string, order: ThreadId[]): Machine {
  const m = fresh(preset);
  for (const t of order) step(m, t);
  return m;
}

/**
 * Every complete order of the two threads for a preset without loops (the
 * no-lock counter): the final counter of each. A thread with n lines and
 * another with n give C(2n, n) orders.
 */
export function allOrders(preset: string): number[] {
  const n = PRESETS[presetKey(preset)].program.length;
  const finals: number[] = [];
  const go = (order: ThreadId[], a: number, b: number) => {
    if (a === n && b === n) {
      finals.push(run(preset, order).mem.counter);
      return;
    }
    if (a < n) go([...order, "A"], a + 1, b);
    if (b < n) go([...order, "B"], a, b + 1);
  };
  go([], 0, 0);
  return finals;
}

export type Tone = "neutral" | "good" | "bad";

/** One sentence on what the reader is looking at now. */
export function summary(m: Machine): { text: string; tone: Tone } {
  const p = PRESETS[m.preset];
  if (m.trace.length === 0) return { text: `Each button runs one line of that thread. ${p.hint}`, tone: "neutral" };

  if (m.preset === "counter") {
    if (finished(m)) {
      const finals = allOrders("counter");
      const lost = finals.filter((c) => c < 2).length;
      if (m.mem.counter === 2)
        return { text: `counter = 2. Only ${finals.length - lost} of the ${finals.length} possible orders get this: one thread has to finish before the other reads.`, tone: "good" };
      return { text: `Two increments ran but counter = ${m.mem.counter}: the second store overwrote the first. ${lost} of the ${finals.length} possible orders lose an update.`, tone: "bad" };
    }
    if (bothInCS(m) && m.trace.some((s) => s.t === "A") && m.trace.some((s) => s.t === "B"))
      return { text: `Both threads have read counter and neither has stored it back. One update is already lost, whatever happens next.`, tone: "bad" };
    const last = m.trace[m.trace.length - 1];
    return { text: `${last.t} ran “${m.program[last.line].text}”.`, tone: "neutral" };
  }

  if (m.overlapSeen && bothInCS(m))
    return { text: "Both threads are inside the critical section at once. The lock let both through: mutual exclusion is broken.", tone: "bad" };

  if (finished(m)) {
    if (m.overlapSeen)
      return { text: `Both finished with counter = ${m.mem.counter}, but at one point both were inside the critical section together.`, tone: "bad" };
    return { text: `counter = ${m.mem.counter} and held = ${m.mem.held}. ${m.preset === "tas" ? "Every order ends this way: test_and_set reads and writes held in one step, so only one thread can see 0." : "This order happened to keep the threads apart."}`, tone: "good" };
  }

  const last = m.trace[m.trace.length - 1];
  const ins = m.program[last.line];
  const other: ThreadId = last.t === "A" ? "B" : "A";
  if ((ins.k === "tas" || (ins.k === "load" && ins.v === "held")) && m.th[last.t].r !== 0)
    return { text: `${last.t} read held = 1: ${other} has the lock, so ${last.t} will loop back and try again.`, tone: "neutral" };
  if (inCS(m, last.t) && !inCS(m, other))
    return { text: `${last.t} is inside the critical section.`, tone: "neutral" };
  return { text: `${m.trace.length} step${m.trace.length === 1 ? "" : "s"} taken.`, tone: "neutral" };
}
