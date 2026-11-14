// The maximal-matching 2-approximation for vertex cover, one scanned edge at a
// time, plus an optional pruning pass, and the exact optimum by brute force so
// the figure can compare the two. No DOM here: render.ts and the tests use it.

import { mulberry32 } from "../../shared/random";

export interface Graph {
  names: string[];
  /** Layout in [0, 1] x [0, 1]. */
  xy: [number, number][];
  edges: [number, number][];
}

/** The Florentine families marriage network (Padgett), as shipped with networkx; Kamada-Kawai layout. */
const FLORENTINE: Graph = {
  names: ["Acciaiuoli", "Albizzi", "Barbadori", "Bischeri", "Castellani", "Ginori", "Guadagni", "Lamberteschi", "Medici", "Pazzi", "Peruzzi", "Ridolfi", "Salviati", "Strozzi", "Tornabuoni"],
  xy: [[0.341, 0.159], [0.628, 0.256], [0.332, 0.704], [0.811, 0.765], [0.459, 0.955], [0.691, 0], [0.799, 0.467], [1, 0.399], [0.411, 0.41], [0, 0.303], [0.688, 1], [0.506, 0.617], [0.196, 0.37], [0.615, 0.833], [0.603, 0.446]],
  edges: [[0, 8], [1, 5], [1, 6], [1, 8], [2, 4], [2, 8], [3, 6], [3, 10], [3, 13], [4, 10], [4, 13], [6, 7], [6, 14], [8, 11], [8, 12], [8, 14], [9, 12], [10, 13], [11, 13], [11, 14]],
};

/** K_{3,3}: every maximal matching is perfect, so the algorithm takes all 6 vertices; 3 suffice. */
const K33: Graph = {
  names: ["a1", "a2", "a3", "b1", "b2", "b3"],
  xy: [[0, 0], [0, 0.5], [0, 1], [1, 0], [1, 0.5], [1, 1]],
  edges: [0, 1, 2].flatMap((a) => [3, 4, 5].map((b) => [a, b] as [number, number])),
};

export interface Preset {
  id: string;
  graph: Graph;
  /** Seed for the edge order; the reader can draw new orders when `reorder` is set. */
  seed: number;
  prune: boolean;
  reorder: boolean;
}

export const PRESETS: Preset[] = [
  { id: "florentine", graph: FLORENTINE, seed: 3, prune: false, reorder: true },
  { id: "k33", graph: K33, seed: 1, prune: false, reorder: false },
  { id: "florentine-prune", graph: FLORENTINE, seed: 3, prune: true, reorder: false },
];

export const preset = (id: string | undefined): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** The edge indices in a seeded random order (Fisher-Yates with mulberry32). */
export function edgeOrder(graph: Graph, seed: number): number[] {
  const order = graph.edges.map((_, i) => i);
  const rand = mulberry32(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export type Step =
  | { kind: "take"; edge: number }
  | { kind: "skip"; edge: number; coveredBy: number }
  | { kind: "drop"; vertex: number }
  | { kind: "keep"; vertex: number; witness: number };

export interface Run {
  order: number[];
  steps: Step[];
}

/** Scan edges in `order`; take both ends of each edge with neither end in the cover. Then, if asked, prune. */
export function run(graph: Graph, order: number[], prune: boolean): Run {
  const inCover = new Set<number>();
  const steps: Step[] = [];
  for (const e of order) {
    const [u, v] = graph.edges[e];
    if (inCover.has(u)) steps.push({ kind: "skip", edge: e, coveredBy: u });
    else if (inCover.has(v)) steps.push({ kind: "skip", edge: e, coveredBy: v });
    else {
      inCover.add(u);
      inCover.add(v);
      steps.push({ kind: "take", edge: e });
    }
  }
  if (prune) {
    // Visit cover vertices in the order they joined; drop one whose every neighbour is still in the cover.
    const joined = steps.flatMap((s) => (s.kind === "take" ? graph.edges[s.edge] : []));
    for (const v of joined) {
      const outside = neighbours(graph, v).find((w) => !inCover.has(w));
      if (outside === undefined) {
        inCover.delete(v);
        steps.push({ kind: "drop", vertex: v });
      } else steps.push({ kind: "keep", vertex: v, witness: outside });
    }
  }
  return { order, steps };
}

export function neighbours(graph: Graph, v: number): number[] {
  return graph.edges.flatMap(([a, b]) => (a === v ? [b] : b === v ? [a] : []));
}

export interface Snapshot {
  cover: Set<number>;
  matching: number[];
  /** Edges with neither end in the cover. */
  uncovered: Set<number>;
  current: Step | null;
}

/** The state after the first `k` steps. */
export function snapshot(graph: Graph, r: Run, k: number): Snapshot {
  const cover = new Set<number>();
  const matching: number[] = [];
  for (const s of r.steps.slice(0, k)) {
    if (s.kind === "take") {
      matching.push(s.edge);
      cover.add(graph.edges[s.edge][0]);
      cover.add(graph.edges[s.edge][1]);
    } else if (s.kind === "drop") cover.delete(s.vertex);
  }
  const uncovered = new Set(graph.edges.map((_, i) => i).filter((i) => !cover.has(graph.edges[i][0]) && !cover.has(graph.edges[i][1])));
  return { cover, matching, uncovered, current: k > 0 ? r.steps[k - 1] : null };
}

/** Size of a minimum vertex cover and one such cover, by trying subsets in order of size (n <= 20). */
export function optimum(graph: Graph): { size: number; cover: number[] } {
  const n = graph.names.length;
  const masks = graph.edges.map(([u, v]) => (1 << u) | (1 << v));
  let best = (1 << n) - 1;
  let bestSize = n;
  for (let s = 0; s < 1 << n; s++) {
    const size = popcount(s);
    if (size >= bestSize) continue;
    if (masks.every((m) => (m & s) !== 0)) {
      best = s;
      bestSize = size;
    }
  }
  return { size: bestSize, cover: [...Array(n).keys()].filter((i) => best & (1 << i)) };
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}
