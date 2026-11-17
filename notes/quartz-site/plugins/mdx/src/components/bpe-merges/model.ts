// Byte-pair encoding, trained and applied exactly as the tokenization note
// describes. No DOM access, so the tests and the build run it in Node.
//
// Training: split the text into pieces with the GPT-2 pre-tokenizer regex,
// count each distinct piece, start every piece as a sequence of base units
// (characters, or UTF-8 bytes), then repeatedly merge the adjacent pair with
// the highest count, weighted by piece frequency. Ties go to the pair that
// occurs first in the text. Merges never cross piece boundaries. A pair's
// count includes overlapping occurrences (three spaces hold two space pairs),
// so a merge can remove fewer tokens than its count.

/**
 * Pre-tokenizer rules. "gpt2" is GPT-2's (Radford et al. 2019, encoder.py).
 * "o200k" is tiktoken's o200k_base pattern with its (?i:...) groups spelled
 * out as character classes; unlike GPT-2's it keeps combining marks (\p{M},
 * such as Devanagari vowel signs) inside words.
 */
const CONTRACTION = "(?:'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))?";
export const RULES = {
  gpt2: /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu,
  o200k: new RegExp(
    [
      `[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+${CONTRACTION}`,
      `[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*${CONTRACTION}`,
      `\\p{N}{1,3}`,
      ` ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*`,
      `\\s*[\\r\\n]+`,
      `\\s+(?!\\S)`,
      `\\s+`,
    ].join("|"),
    "gu",
  ),
};
export type Rule = keyof typeof RULES;

export type Unit = "char" | "byte";

export interface Merge {
  left: string;
  right: string;
  count: number;
}

export interface Candidate extends Merge {
  first: number;
}

export function pieces(text: string, rule: Rule = "gpt2"): string[] {
  return text.match(RULES[rule]) ?? [];
}

/** A piece's base units. Bytes are kept as one char per byte (code points 0-255). */
export function units(piece: string, unit: Unit): string[] {
  if (unit === "char") return Array.from(piece);
  return Array.from(new TextEncoder().encode(piece), (b) => String.fromCharCode(b));
}

/** Merges every non-overlapping left+right occurrence, scanning left to right. */
export function applyMerge(sym: string[], left: string, right: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < sym.length; i++) {
    if (i + 1 < sym.length && sym[i] === left && sym[i + 1] === right) {
      out.push(left + right);
      i++;
    } else out.push(sym[i]);
  }
  return out;
}

interface Type {
  sym: string[];
  freq: number;
}

export interface Step {
  merge: Merge | null; // the merge that produced this state (null at step 0)
  tokens: number; // tokens in the whole training text
  candidates: Candidate[]; // the highest-count pairs in this state, best first
}

export interface Training {
  unit: Unit;
  rule: Rule;
  order: number[]; // the text as a sequence of type indices
  base: number; // distinct base units in the text
  units: number; // base units in the text
  bytes: number; // UTF-8 bytes in the text
  merges: Merge[];
  steps: Step[];
  history: string[][][]; // history[k][t] = segmentation of type t after k merges
}

const SEP = "\u0000";

/** Pair counts in a state, ranked by count, then by first occurrence. */
export function rankPairs(types: Type[], firstOf: number[]): Candidate[] {
  const map = new Map<string, Candidate>();
  types.forEach((t, ti) => {
    for (let i = 0; i + 1 < t.sym.length; i++) {
      const key = t.sym[i] + SEP + t.sym[i + 1];
      const c = map.get(key);
      const first = firstOf[ti] * 4096 + i;
      if (c) c.count += t.freq;
      else map.set(key, { left: t.sym[i], right: t.sym[i + 1], count: t.freq, first });
    }
  });
  return [...map.values()].sort((a, b) => b.count - a.count || a.first - b.first);
}

/**
 * Trains up to maxMerges merges, stopping early when the best pair occurs
 * fewer than minCount times.
 */
export function train(text: string, unit: Unit, rule: Rule, maxMerges: number, minCount = 2, keepCandidates = 5): Training {
  const index = new Map<string, number>();
  const types: Type[] = [];
  const firstOf: number[] = [];
  const order: number[] = [];
  for (const p of pieces(text, rule)) {
    let t = index.get(p);
    if (t === undefined) {
      t = types.length;
      index.set(p, t);
      types.push({ sym: units(p, unit), freq: 0 });
      firstOf.push(order.length);
    }
    types[t].freq++;
    order.push(t);
  }
  const count = () => types.reduce((s, t) => s + t.sym.length * t.freq, 0);
  const baseSet = new Set<string>();
  for (const t of types) for (const s of t.sym) baseSet.add(s);
  const merges: Merge[] = [];
  const steps: Step[] = [];
  const history: string[][][] = [types.map((t) => t.sym)];
  const total = count();
  for (let k = 0; ; k++) {
    const ranked = rankPairs(types, firstOf);
    steps.push({ merge: k ? merges[k - 1] : null, tokens: k ? count() : total, candidates: ranked.slice(0, keepCandidates) });
    if (k >= maxMerges || !ranked.length || ranked[0].count < minCount) break;
    const { left, right, count: c } = ranked[0];
    merges.push({ left, right, count: c });
    for (const t of types) t.sym = applyMerge(t.sym, left, right);
    history.push(types.map((t) => t.sym));
  }
  return { unit, rule, order, base: baseSet.size, units: total, bytes: new TextEncoder().encode(text).length, merges, steps, history };
}

/** Segments new text with the first k learned merges, replayed in order. */
export function encode(text: string, merges: Merge[], unit: Unit, rule: Rule, k = merges.length): string[][] {
  const used = merges.slice(0, k);
  return pieces(text, rule).map((p) => used.reduce((sym, m) => applyMerge(sym, m.left, m.right), units(p, unit)));
}

/** The segmentation of the training text after k merges, piece by piece. */
export function segmentation(tr: Training, k: number): string[][] {
  const h = tr.history[Math.min(k, tr.history.length - 1)];
  return tr.order.map((t) => h[t]);
}

/** UTF-8 byte count of a token (each byte unit counts one). */
export function byteLength(token: string, unit: Unit): number {
  return unit === "byte" ? token.length : new TextEncoder().encode(token).length;
}

/**
 * A token as readable text: byte tokens that are not complete UTF-8 show
 * their bytes in hex. Spaces show as a middle dot, newlines as a return mark.
 */
export function display(token: string, unit: Unit): { text: string; partial: boolean } {
  let s = token;
  let partial = false;
  if (unit === "byte") {
    const bytes = Uint8Array.from(token, (c) => c.charCodeAt(0));
    try {
      s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      partial = true;
      s = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
    }
  }
  if (!partial) s = s.replace(/ /g, "·").replace(/\n/g, "↵").replace(/\t/g, "→");
  return { text: s, partial };
}
