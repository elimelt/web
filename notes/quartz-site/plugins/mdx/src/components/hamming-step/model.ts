// Hamming(7,4), optionally extended with an overall parity bit (SECDED).
// Positions are 1-based as in Hamming's paper: check bits at 1, 2 and 4,
// data at 3, 5, 6 and 7. Check bit p covers every position whose index has
// bit p set. The extended code adds position 0, the parity of all 7 bits.

export type Bits = number[];

export const DATA_POS = [3, 5, 6, 7];
export const CHECKS = [1, 2, 4];

/** Positions check bit p covers, itself included. */
export const covers = (p: number): number[] => [1, 2, 3, 4, 5, 6, 7].filter((i) => i & p);

/** An 8-entry word indexed by position; entry 0 is the overall parity bit. */
export function encode(data: Bits, extended: boolean): Bits {
  const w = Array(8).fill(0);
  DATA_POS.forEach((pos, i) => (w[pos] = data[i]));
  for (const p of CHECKS) w[p] = covers(p).filter((i) => i !== p).reduce((a, i) => a ^ w[i], 0);
  if (extended) w[0] = w.slice(1).reduce((a, b) => a ^ b, 0);
  return w;
}

/** Parity of the positions check p covers: 0 means the check holds. */
export const checkFails = (w: Bits, p: number): number => covers(p).reduce((a, i) => a ^ w[i], 0);

/** The syndrome: the sum of the failing checks' positions. */
export const syndrome = (w: Bits): number => CHECKS.reduce((s, p) => s + (checkFails(w, p) ? p : 0), 0);

export const overallFails = (w: Bits): number => w.reduce((a, b) => a ^ b, 0);

export type Action = "none" | "fix" | "fix-p0" | "detect";

export interface Decoded {
  syn: number;
  /** extended only: whether the overall parity fails */
  overall: number;
  action: Action;
  /** Position flipped by the decoder, or -1. */
  flipped: number;
  corrected: Bits;
  data: Bits;
}

export function decode(w: Bits, extended: boolean): Decoded {
  const syn = syndrome(w);
  const overall = extended ? overallFails(w) : 0;
  let action: Action = "none";
  let flipped = -1;
  if (!extended) {
    if (syn) {
      action = "fix";
      flipped = syn;
    }
  } else if (syn && overall) {
    action = "fix";
    flipped = syn;
  } else if (syn && !overall) {
    action = "detect";
  } else if (!syn && overall) {
    action = "fix-p0";
    flipped = 0;
  }
  const corrected = [...w];
  if (flipped >= 0) corrected[flipped] ^= 1;
  return { syn, overall, action, flipped, corrected, data: DATA_POS.map((p) => corrected[p]) };
}

export interface Scenario {
  id: string;
  extended: boolean;
  data: Bits;
  /** Positions flipped in transit. */
  flips: number[];
}

const DATA = [1, 0, 1, 1];

export const SCENARIOS: Record<string, Scenario> = {
  clean: { id: "clean", extended: false, data: DATA, flips: [] },
  one: { id: "one", extended: false, data: DATA, flips: [6] },
  two: { id: "two", extended: false, data: DATA, flips: [3, 6] },
  secded: { id: "secded", extended: true, data: DATA, flips: [3, 6] },
};

export const scenarioById = (id: string | undefined): Scenario => SCENARIOS[id ?? "clean"] ?? SCENARIOS.clean;
