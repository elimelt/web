// The skip list and treap figure's model: both structures built over Wikipedia
// article titles (as integer ranks in sorted order) with seeded random levels
// and priorities, the comparisons each search makes, and their exact
// expectations. The figure's tests check every function here against an
// independent Python implementation
// (content/algorithms/probabilistic/search-structure-experiments/figure_ref.py).

/** Skip-list levels are capped here, as in the benchmark. */
export const MAXL = 40;
/** Keys in the drawn structures. */
export const SMALL = 16;

/** The seed of one part of a run: 0 and 1 for the drawn skip list and treap, 2 and 3 for the full ones. */
export function partSeed(base: number, part: number): number {
  return (Math.imul(base, 0x9e3779b1) + part) >>> 0;
}

/**
 * Levels of a skip list over keys 0..n-1, drawn in insertion order: a key's
 * level is 1 plus the number of draws below p before the first draw at or
 * above p, capped at MAXL.
 */
export function skipLevels(order: ArrayLike<number>, n: number, p: number, rnd: () => number): Uint8Array {
  const lv = new Uint8Array(n);
  for (let j = 0; j < order.length; j++) {
    let l = 1;
    while (l < MAXL && rnd() < p) l++;
    lv[order[j]] = l;
  }
  return lv;
}

export interface Step {
  level: number;
  key: number;
  /** True when the search moved to the key; false for the comparison that ended the level. */
  moved: boolean;
}

export class SkipList {
  readonly n: number;
  readonly height: number;
  /** next[i][k + 1] is the first key after k with level above i, or -1; next[i][0] is the head's. */
  readonly next: Int32Array[];
  constructor(readonly lv: Uint8Array) {
    this.n = lv.length;
    let h = 1;
    for (const l of lv) if (l > h) h = l;
    this.height = h;
    this.next = [];
    for (let i = 0; i < h; i++) {
      const nx = new Int32Array(this.n + 1);
      let after = -1;
      for (let k = this.n - 1; k >= -1; k--) {
        nx[k + 1] = after;
        if (k >= 0 && lv[k] > i) after = k;
      }
      this.next.push(nx);
    }
  }
  /**
   * Searches for key m from the head at the top level, counting every key
   * comparison as the benchmark does: one per move, one that ends each level
   * whose next pointer exists, and a final equality test.
   */
  search(m: number, path?: Step[]): number {
    let x = -1;
    let cmps = 0;
    for (let i = this.height - 1; i >= 0; i--) {
      const nx = this.next[i];
      for (;;) {
        const y = nx[x + 1];
        if (y < 0) break;
        cmps++;
        if (y < m) {
          path?.push({ level: i, key: y, moved: true });
          x = y;
        } else {
          path?.push({ level: i, key: y, moved: false });
          break;
        }
      }
    }
    return cmps + 1;
  }
}

export interface Treap {
  root: number;
  left: Int32Array;
  right: Int32Array;
  /** Depth of each key, the root at depth 1. */
  depth: Int32Array;
  height: number;
  pri: Float64Array;
}

/**
 * A treap over keys 0..n-1 whose priorities are drawn in insertion order. Its
 * shape is the Cartesian tree of the priorities (a max-heap), built with a
 * stack; of two keys with equal priorities, the larger becomes a descendant
 * of the smaller.
 */
export function treap(order: ArrayLike<number>, n: number, rnd: () => number): Treap {
  const pri = new Float64Array(n);
  for (let j = 0; j < order.length; j++) pri[order[j]] = rnd();
  const left = new Int32Array(n).fill(-1);
  const right = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  for (let k = 0; k < n; k++) {
    let last = -1;
    while (stack.length && pri[stack[stack.length - 1]] < pri[k]) last = stack.pop()!;
    left[k] = last;
    if (stack.length) right[stack[stack.length - 1]] = k;
    stack.push(k);
  }
  const root = stack.length ? stack[0] : -1;
  const depth = new Int32Array(n);
  let height = 0;
  const todo: [number, number][] = root >= 0 ? [[root, 1]] : [];
  while (todo.length) {
    const [k, d] = todo.pop()!;
    depth[k] = d;
    if (d > height) height = d;
    if (left[k] >= 0) todo.push([left[k], d + 1]);
    if (right[k] >= 0) todo.push([right[k], d + 1]);
  }
  return { root, left, right, depth, height, pri };
}

/** The keys on the path from the root to key m. A successful search makes one comparison per key on it. */
export function treapPath(t: Treap, m: number): number[] {
  const path: number[] = [];
  let k = t.root;
  while (k >= 0) {
    path.push(k);
    if (k === m) break;
    k = m < k ? t.left[k] : t.right[k];
  }
  return path;
}

/** Exact expected comparisons of the skip-list search above for the m-th smallest of n keys (m from 1). */
export function skipExpected(n: number, p: number, m: number): number {
  let e = 1;
  for (let i = 0; i < MAXL; i++) {
    e += ((1 - p) / p) * (1 - (1 - p ** (i + 1)) ** (m - 1)) + 1 - (1 - p ** i) ** (n - m + 1);
  }
  return e;
}

export function harmonic(n: number): number {
  let h = 0;
  for (let k = 1; k <= n; k++) h += 1 / k;
  return h;
}

/** Expected depth of the m-th smallest of n keys in a treap (m from 1): H_m + H_(n-m+1) - 1. */
export function treapExpected(n: number, m: number, H?: Float64Array): number {
  const h = H ?? harmonicTable(n);
  return h[m] + h[n - m + 1] - 1;
}

export function harmonicTable(n: number): Float64Array {
  const h = new Float64Array(n + 2);
  for (let k = 1; k <= n + 1; k++) h[k] = h[k - 1] + 1 / k;
  return h;
}

export interface Run {
  p: number;
  base: number;
  /** The drawn keys, as ranks among all titles in sorted order. */
  smallKeys: number[];
  smallSkip: SkipList;
  smallTreap: Treap;
  /** Comparisons for each of the n keys, in sorted order. */
  skipCost: Int32Array;
  treapDepth: Int32Array;
  skipHeight: number;
  treapHeight: number;
}

/** Both structures over the first SMALL titles inserted, and over all n titles. */
export function run(order: ArrayLike<number>, p: number, base: number, mulberry: (seed: number) => () => number): Run {
  const n = order.length;
  const firstKeys = Array.from(order).slice(0, SMALL);
  const smallKeys = [...firstKeys].sort((a, b) => a - b);
  const smallOrder = firstKeys.map((k) => smallKeys.indexOf(k));
  const smallSkip = new SkipList(skipLevels(smallOrder, SMALL, p, mulberry(partSeed(base, 0))));
  const smallTreap = treap(smallOrder, SMALL, mulberry(partSeed(base, 1)));
  const big = new SkipList(skipLevels(order, n, p, mulberry(partSeed(base, 2))));
  const skipCost = new Int32Array(n);
  for (let m = 0; m < n; m++) skipCost[m] = big.search(m);
  const t = treap(order, n, mulberry(partSeed(base, 3)));
  return { p, base, smallKeys, smallSkip, smallTreap, skipCost, treapDepth: t.depth, skipHeight: big.height, treapHeight: t.height };
}
