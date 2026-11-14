// A per-branch 1-bit or 2-bit saturating counter, replayed over real branch
// outcomes. The outcome windows below were recorded from GNU gzip 1.12
// compressing 2 MB of text on x86-64 (see branch-prediction-lab/ beside the
// note): pick_branches.py cut 64 consecutive outcomes of one branch, starting
// at its 3000th execution, together with the state that branch's own 1-bit
// and 2-bit counters held at that moment. Nothing here is synthetic.

export type Bits = 1 | 2;

export interface Preset {
  /** One line naming the branch, for the figure's heading. */
  title: string;
  /** Address of the branch inside /usr/bin/gzip. */
  offset: string;
  /** "T" or "N" per execution, oldest first. */
  outcomes: string;
  /** State of the branch's own counters just before the window. */
  start: { 1: number; 2: number };
  /** The same branch over the whole recorded run (first 8M instructions). */
  whole: { runs: number; miss1: number; miss2: number; missTage: number };
}

export const presets: Record<string, Preset> = {
  // gzip's ct_tally() writes a byte of literal/match flags every 8 symbols:
  // if ((last_lit & 7) == 0). The jump around that code is taken 7 times out
  // of 8.
  loop: {
    title: "gzip, flush a flag byte every 8 symbols",
    offset: "0x51d6",
    outcomes: "TTTTTTTNTTTTTTTNTTTTTTTNTTTTTTTNTTTTTTTNTTTTTTTNTTTTTTTNTTTTTTTN",
    start: { 1: 0, 2: 2 },
    whole: { runs: 11485, miss1: 0.25, miss2: 0.125, missTage: 0.129 },
  },
  // A branch whose outcome mostly flips on every execution.
  alternate: {
    title: "gzip, a branch that mostly flips each time",
    offset: "0xeb54",
    outcomes: "TNTNTTNTNTNTNTNTNTNTNTNNNNTNTNTNTTNTNTTNTNNNTNTNTNTNTNNTNTNTNTNT",
    start: { 1: 0, 2: 0 },
    whole: { runs: 12669, miss1: 0.826, miss2: 0.593, missTage: 0.334 },
  },
  // ct_tally()'s if (dist == 0): was this symbol a literal byte or a match?
  // It depends on the input text, but a branch that ran just before it in
  // gzip's main loop (offset 0xe48f) had already gone the opposite way on the
  // same question, so global history predicts it almost perfectly.
  correlated: {
    title: "gzip, literal or match",
    offset: "0x51b5",
    outcomes: "TTNNNTTNNNNTTNNTNTTTTNTTTTNTTNNTTNTTTTTTTTTTTTTTTTTTTTTTTTTNTTTT",
    start: { 1: 1, 2: 3 },
    whole: { runs: 11485, miss1: 0.399, miss2: 0.381, missTage: 0.004 },
  },
};

export const stateNames: Record<Bits, string[]> = {
  1: ["last went not taken", "last went taken"],
  2: ["strongly not taken", "weakly not taken", "weakly taken", "strongly taken"],
};

export const stateCodes: Record<Bits, string[]> = {
  1: ["0", "1"],
  2: ["00", "01", "10", "11"],
};

/** What a counter in this state predicts. */
export const predicts = (bits: Bits, state: number): boolean => (bits === 1 ? state === 1 : state >= 2);

/** The counter's next state after an outcome. */
export function next(bits: Bits, state: number, taken: boolean): number {
  if (bits === 1) return taken ? 1 : 0;
  return taken ? Math.min(state + 1, 3) : Math.max(state - 1, 0);
}

export interface Step {
  before: number;
  predicted: boolean;
  taken: boolean;
  hit: boolean;
  after: number;
}

/** Replays a sequence of outcomes through one counter. */
export function replay(bits: Bits, start: number, outcomes: string): Step[] {
  const steps: Step[] = [];
  let state = start;
  for (const c of outcomes) {
    const taken = c === "T";
    const predicted = predicts(bits, state);
    const after = next(bits, state, taken);
    steps.push({ before: state, predicted, taken, hit: predicted === taken, after });
    state = after;
  }
  return steps;
}

export const presetKey = (key: unknown): string => (typeof key === "string" && key in presets ? key : "loop");
export const bitsOf = (bits: unknown): Bits => (Number(bits) === 1 ? 1 : 2);
