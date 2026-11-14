// Greedy set cover on small instances laid out on a grid, one pick at a time,
// with the per-element prices from the charging proof and the exact optimum by
// brute force. No DOM here: render.ts and the tests use it.

export interface CoverSet {
  name: string;
  /** Element ids. */
  cells: number[];
  cost: number;
  /** Drawn as the rectangle rows r0..r1, columns c0..c1 (inclusive). */
  rect: [number, number, number, number];
}

export interface Instance {
  rows: number;
  cols: number;
  /** Element id = row * cols + col. */
  sets: CoverSet[];
  weighted: boolean;
}

/**
 * Two rows of 2^m - 1 columns. The rows are an optimal cover of size 2. Block j
 * (j = 1..m) holds columns 2^(j-1) - 1 .. 2^j - 2 of both rows: 2^j elements,
 * one more than the row has left uncovered when greedy compares them, so greedy
 * takes the blocks, biggest first, and ends with m sets.
 */
export function twoRows(m: number): Instance {
  const cols = 2 ** m - 1;
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
  const sets: CoverSet[] = [
    { name: "Top row", cells: range(0, cols), cost: 1, rect: [0, 0, 0, cols - 1] },
    { name: "Bottom row", cells: range(cols, 2 * cols), cost: 1, rect: [1, 1, 0, cols - 1] },
  ];
  for (let j = m; j >= 1; j--) {
    const lo = 2 ** (j - 1) - 1;
    const hi = 2 ** j - 1;
    sets.push({ name: `Block ${j}`, cells: [...range(lo, hi), ...range(cols + lo, cols + hi)], cost: 1, rect: [0, 1, lo, hi - 1] });
  }
  return { rows: 2, cols, sets, weighted: false };
}

/**
 * Vazirani's tight example for weighted greedy: n singletons, element i costing
 * 1/(n - i), and one set of everything costing 1 + eps. Greedy buys the
 * singletons, cheapest per element first, and pays H_n.
 */
export function weightedTight(n: number, eps = 0.01): Instance {
  const sets: CoverSet[] = [{ name: "Everything", cells: Array.from({ length: n }, (_, i) => i), cost: 1 + eps, rect: [0, 0, 0, n - 1] }];
  for (let i = 0; i < n; i++) sets.push({ name: `Singleton ${i + 1}`, cells: [i], cost: 1 / (n - i), rect: [0, 0, i, i] });
  return { rows: 1, cols: n, sets, weighted: true };
}

export interface Preset {
  id: string;
  instance: Instance;
  prices: boolean;
}

export const PRESETS: Preset[] = [
  { id: "two-rows", instance: twoRows(4), prices: false },
  { id: "prices", instance: twoRows(3), prices: true },
  { id: "weighted", instance: weightedTight(6), prices: false },
];

export const preset = (id: string | undefined): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export interface Pick {
  set: number;
  /** Newly covered elements. */
  covered: number[];
  /** Cost per newly covered element: what each of them is charged. */
  price: number;
  /** For every set, how many uncovered elements it would cover at this moment. */
  fresh: number[];
}

/** Greedy: take the set with the lowest cost per newly covered element; ties go to the earlier set. */
export function greedy(inst: Instance): Pick[] {
  const n = inst.rows * inst.cols;
  const covered = new Set(inst.sets.flatMap((s) => s.cells));
  const uncovered = new Set([...Array(n).keys()].filter((e) => covered.has(e)));
  const picks: Pick[] = [];
  while (uncovered.size) {
    const fresh = inst.sets.map((s) => s.cells.filter((e) => uncovered.has(e)).length);
    let best = -1;
    let bestVal = Infinity;
    fresh.forEach((f, j) => {
      if (!f) return;
      const val = inst.sets[j].cost / f;
      if (val < bestVal - 1e-12) {
        best = j;
        bestVal = val;
      }
    });
    const newly = inst.sets[best].cells.filter((e) => uncovered.has(e));
    for (const e of newly) uncovered.delete(e);
    picks.push({ set: best, covered: newly, price: bestVal, fresh });
  }
  return picks;
}

/** Cheapest cover by trying every subset of sets (fine for up to ~16 sets). */
export function optimum(inst: Instance): { cost: number; sets: number[] } {
  const all = new Set(inst.sets.flatMap((s) => s.cells));
  const m = inst.sets.length;
  let best = Infinity;
  let bestMask = 0;
  for (let mask = 1; mask < 1 << m; mask++) {
    let cost = 0;
    const got = new Set<number>();
    for (let j = 0; j < m; j++) {
      if (mask & (1 << j)) {
        cost += inst.sets[j].cost;
        for (const e of inst.sets[j].cells) got.add(e);
      }
    }
    if (got.size === all.size && cost < best - 1e-12) {
      best = cost;
      bestMask = mask;
    }
  }
  return { cost: best, sets: [...Array(m).keys()].filter((j) => bestMask & (1 << j)) };
}

export const harmonic = (d: number): number => {
  let h = 0;
  for (let i = 1; i <= d; i++) h += 1 / i;
  return h;
};

/** Price charged to each element by the first k picks. */
export function prices(picks: Pick[], k: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of picks.slice(0, k)) for (const e of p.covered) out.set(e, p.price);
  return out;
}

/** A price as a fraction when it is 1/q (unweighted), else a decimal. */
export function fraction(x: number): string {
  const q = 1 / x;
  if (Math.abs(q - Math.round(q)) < 1e-9) return Math.round(q) === 1 ? "1" : `1/${Math.round(q)}`;
  return x.toFixed(2);
}
