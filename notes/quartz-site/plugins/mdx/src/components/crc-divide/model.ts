// CRC as long division over GF(2), step by step. A step lines the generator
// up under the leftmost 1 of the working bits and XORs it in; when no 1 is
// left before the last k bits, those k bits are the remainder.

export type Bits = number[];

export interface Step {
  /** Where the generator's first bit lines up. */
  at: number;
  /** The working bits after this XOR. */
  after: Bits;
}

export function divide(dividend: Bits, gen: Bits): { steps: Step[]; remainder: Bits } {
  const k = gen.length - 1;
  const work = [...dividend];
  const steps: Step[] = [];
  for (let i = 0; i + k < work.length; i++) {
    if (!work[i]) continue;
    for (let j = 0; j < gen.length; j++) work[i + j] ^= gen[j];
    steps.push({ at: i, after: [...work] });
  }
  return { steps, remainder: work.slice(work.length - k) };
}

/** The check bits a sender appends: the remainder of message followed by k zeros. */
export function checkBits(message: Bits, gen: Bits): Bits {
  return divide([...message, ...Array(gen.length - 1).fill(0)], gen).remainder;
}

export const bits = (s: string): Bits => [...s].map((c) => (c === "1" ? 1 : 0));
export const str = (b: Bits): string => b.join("");

/** x^3 + x + 1 for 1011. */
export function polyText(gen: Bits): string {
  const d = gen.length - 1;
  const terms: string[] = [];
  gen.forEach((b, i) => {
    if (!b) return;
    const p = d - i;
    terms.push(p === 0 ? "1" : p === 1 ? "x" : `x<sup>${p}</sup>`);
  });
  return terms.join(" + ");
}

export interface Scenario {
  id: string;
  mode: "send" | "receive";
  message: Bits;
  gen: Bits;
  /** Codeword positions flipped on the way (receive mode). */
  errors: number[];
}

const MESSAGE = bits("11010011");
const GEN = bits("1011");

export const SCENARIOS: Record<string, Scenario> = {
  // The sender computes the check bits.
  send: { id: "send", mode: "send", message: MESSAGE, gen: GEN, errors: [] },
  // The receiver divides what arrived; nothing was flipped.
  clean: { id: "clean", mode: "receive", message: MESSAGE, gen: GEN, errors: [] },
  // A burst no longer than the generator's degree: always caught.
  burst: { id: "burst", mode: "receive", message: MESSAGE, gen: GEN, errors: [3, 4, 5] },
  // The error pattern is the generator itself, shifted: 1011 at position 2.
  missed: { id: "missed", mode: "receive", message: MESSAGE, gen: GEN, errors: [2, 4, 5] },
};

export const scenarioById = (id: string | undefined): Scenario => SCENARIOS[id ?? "send"] ?? SCENARIOS.send;

export function codeword(s: Scenario): Bits {
  return [...s.message, ...checkBits(s.message, s.gen)];
}

/** What the division starts from: the padded message, or the received word. */
export function dividend(s: Scenario, errors: number[]): Bits {
  if (s.mode === "send") return [...s.message, ...Array(s.gen.length - 1).fill(0)];
  const w = codeword(s);
  for (const e of errors) w[e] ^= 1;
  return w;
}
