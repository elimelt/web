// The sequence alignment DP from the dynamic programming note, free of the
// DOM so render.ts, client.ts and the tests share it. Costs are kept in half
// units (the sliders move in steps of 0.5), so every comparison is exact
// integer arithmetic and ties are real ties.

export const MAX_LEN = 12;
export const DEFAULT_X = "ocurrance";
export const DEFAULT_Y = "occurrence";

/** Bit flags for the moves that attain a cell's minimum. */
export const DIAG = 1;
export const UP = 2; // x_i against a gap: from (i - 1, j)
export const LEFT = 4; // y_j against a gap: from (i, j - 1)

export interface Table {
  x: string;
  y: string;
  /** Gap and mismatch costs in half units. */
  gap: number;
  mismatch: number;
  m: number;
  n: number;
  /** cost[i * (n + 1) + j] = OPT(i, j) in half units. */
  cost: Int32Array;
  /** Which moves attain the minimum, as DIAG | UP | LEFT flags; 0 on (0, 0). */
  moves: Uint8Array;
}

/** Keeps letters and digits, at most MAX_LEN of them. */
export function clean(s: string): string {
  return Array.from(s.normalize("NFC"))
    .filter((c) => /[\p{L}\p{N}]/u.test(c))
    .slice(0, MAX_LEN)
    .join("");
}

export function sub(t: Pick<Table, "x" | "y" | "mismatch">, i: number, j: number): number {
  return t.x[i - 1] === t.y[j - 1] ? 0 : t.mismatch;
}

export function fill(x: string, y: string, gap: number, mismatch: number): Table {
  const m = x.length;
  const n = y.length;
  const w = n + 1;
  const cost = new Int32Array((m + 1) * w);
  const moves = new Uint8Array((m + 1) * w);
  const t: Table = { x, y, gap, mismatch, m, n, cost, moves };
  for (let i = 1; i <= m; i++) {
    cost[i * w] = i * gap;
    moves[i * w] = UP;
  }
  for (let j = 1; j <= n; j++) {
    cost[j] = j * gap;
    moves[j] = LEFT;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const d = cost[(i - 1) * w + j - 1] + sub(t, i, j);
      const u = cost[(i - 1) * w + j] + gap;
      const l = cost[i * w + j - 1] + gap;
      const best = Math.min(d, u, l);
      cost[i * w + j] = best;
      moves[i * w + j] = (d === best ? DIAG : 0) | (u === best ? UP : 0) | (l === best ? LEFT : 0);
    }
  }
  return t;
}

export const at = (t: Table, i: number, j: number): number => t.cost[i * (t.n + 1) + j];
export const movesAt = (t: Table, i: number, j: number): number => t.moves[i * (t.n + 1) + j];

/** The move the traceback takes from (i, j): diagonal first, then up, then left, as in the note's Python. */
export function preferred(flags: number): number {
  return flags & DIAG ? DIAG : flags & UP ? UP : flags & LEFT ? LEFT : 0;
}

export interface Alignment {
  /** Cells on the traceback path, from (m, n) back to (0, 0). */
  path: [number, number][];
  top: string;
  bottom: string;
  /** Per column: "match", "mismatch" or "gap". */
  kinds: ("match" | "mismatch" | "gap")[];
  matches: number;
  mismatches: number;
  gaps: number;
}

export function traceback(t: Table): Alignment {
  let i = t.m;
  let j = t.n;
  const path: [number, number][] = [[i, j]];
  const top: string[] = [];
  const bottom: string[] = [];
  while (i > 0 || j > 0) {
    const mv = preferred(movesAt(t, i, j));
    if (mv === DIAG) {
      top.push(t.x[i - 1]);
      bottom.push(t.y[j - 1]);
      i--;
      j--;
    } else if (mv === UP) {
      top.push(t.x[i - 1]);
      bottom.push("-");
      i--;
    } else {
      top.push("-");
      bottom.push(t.y[j - 1]);
      j--;
    }
    path.push([i, j]);
  }
  top.reverse();
  bottom.reverse();
  const kinds = top.map((a, k) => (a === "-" || bottom[k] === "-" ? "gap" : a === bottom[k] ? "match" : "mismatch")) as Alignment["kinds"];
  const count = (k: string) => kinds.filter((x) => x === k).length;
  return { path, top: top.join(""), bottom: bottom.join(""), kinds, matches: count("match"), mismatches: count("mismatch"), gaps: count("gap") };
}

/** Cost of an alignment given as two gapped rows, in half units. */
export function score(top: string, bottom: string, gap: number, mismatch: number): number {
  let s = 0;
  for (let k = 0; k < top.length; k++) {
    if (top[k] === "-" || bottom[k] === "-") s += gap;
    else if (top[k] !== bottom[k]) s += mismatch;
  }
  return s;
}

/** Interior cells in fill order: step k (1-based) fills cell number k - 1, row by row. */
export const cellOfStep = (t: Pick<Table, "n">, k: number): [number, number] => [Math.floor((k - 1) / t.n) + 1, ((k - 1) % t.n) + 1];
export const steps = (t: Pick<Table, "m" | "n">): number => t.m * t.n;

/** Whether cell (i, j) holds a value after `step` interior cells are filled. Border cells are filled from the start. */
export function filled(t: Pick<Table, "n">, step: number, i: number, j: number): boolean {
  if (i === 0 || j === 0) return true;
  return (i - 1) * t.n + j <= step;
}

/**
 * Whether a two-row implementation still holds cell (i, j) after `step`
 * cells. It keeps the row being filled and the one before it, so once row i
 * is under way, rows below i - 1 are gone.
 */
export function held(t: Pick<Table, "m" | "n">, step: number, i: number): boolean {
  if (t.n === 0 || t.m === 0) return true;
  const current = step === 0 ? 1 : Math.min(t.m, Math.floor((step - 1) / t.n) + 1);
  return i >= current - 1;
}

export interface Candidate {
  move: number;
  from: [number, number];
  base: number;
  add: number;
  total: number;
  best: boolean;
}

export function candidates(t: Table, i: number, j: number): Candidate[] {
  const flags = movesAt(t, i, j);
  const out: Candidate[] = [];
  if (i > 0 && j > 0) {
    const base = at(t, i - 1, j - 1);
    out.push({ move: DIAG, from: [i - 1, j - 1], base, add: sub(t, i, j), total: base + sub(t, i, j), best: !!(flags & DIAG) });
  }
  if (i > 0) {
    const base = at(t, i - 1, j);
    out.push({ move: UP, from: [i - 1, j], base, add: t.gap, total: base + t.gap, best: !!(flags & UP) });
  }
  if (j > 0) {
    const base = at(t, i, j - 1);
    out.push({ move: LEFT, from: [i, j - 1], base, add: t.gap, total: base + t.gap, best: !!(flags & LEFT) });
  }
  return out;
}

/** Half units to text: 3 -> "1.5", 4 -> "2". */
export const half = (v: number): string => (v % 2 === 0 ? String(v / 2) : (v / 2).toFixed(1));
