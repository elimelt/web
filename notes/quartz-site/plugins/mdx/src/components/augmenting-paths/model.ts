// Edmonds-Karp on a small network: each step augments along the shortest path
// that breadth-first search finds in the residual graph; at the end the
// vertices still reachable from s give a minimum cut. No DOM here: render.ts
// and the tests use it.

/** Capacities at or above this are drawn as ∞. */
export const INF = 1_000_000_000;

export interface Net {
  names: string[];
  /** Layout in [0, 1] x [0, 1]. */
  xy: [number, number][];
  /** [tail, head, capacity]. */
  edges: [number, number, number][];
  /** An undirected edge carries flow either way, up to its capacity. */
  undirected?: boolean[];
  s: number;
  t: number;
}

/** A residual arc: edge e traversed forward (dir 1, tail to head) or backward (dir -1). */
export interface Arc {
  e: number;
  dir: 1 | -1;
}

export interface Augment {
  path: Arc[];
  bottleneck: number;
  /** Flow on each edge before this augmentation. */
  before: number[];
}

export interface Run {
  augments: Augment[];
  flow: number[];
  value: number;
  /** Vertices reachable from s in the final residual graph: the source side of a minimum cut. */
  reach: boolean[];
  /** Edges that cross the cut from the source side. */
  cut: number[];
  cutCapacity: number;
}

const undirectedAt = (net: Net, e: number) => !!net.undirected?.[e];

export function residual(net: Net, flow: number[], a: Arc): number {
  const c = net.edges[a.e][2];
  if (a.dir === 1) return c - flow[a.e];
  return undirectedAt(net, a.e) ? c + flow[a.e] : flow[a.e];
}

export const arcTail = (net: Net, a: Arc) => (a.dir === 1 ? net.edges[a.e][0] : net.edges[a.e][1]);
export const arcHead = (net: Net, a: Arc) => (a.dir === 1 ? net.edges[a.e][1] : net.edges[a.e][0]);

/** Residual arcs out of each vertex, in edge order. */
export function adjacency(net: Net): Arc[][] {
  const adj: Arc[][] = net.names.map(() => []);
  net.edges.forEach(([u, v], e) => {
    adj[u].push({ e, dir: 1 });
    adj[v].push({ e, dir: -1 });
  });
  return adj;
}

/** Breadth-first search from s over arcs with positive residual capacity. */
export function search(net: Net, flow: number[], adj = adjacency(net)) {
  const n = net.names.length;
  const parent: (Arc | null)[] = new Array(n).fill(null);
  const seen: boolean[] = new Array(n).fill(false);
  seen[net.s] = true;
  const queue = [net.s];
  for (let qh = 0; qh < queue.length && !seen[net.t]; qh++) {
    const u = queue[qh];
    for (const a of adj[u]) {
      const w = arcHead(net, a);
      if (!seen[w] && residual(net, flow, a) > 0) {
        seen[w] = true;
        parent[w] = a;
        queue.push(w);
      }
    }
  }
  return { parent, seen };
}

/** Vertices reachable from s in the residual graph (a full search). */
export function reachable(net: Net, flow: number[]): boolean[] {
  const adj = adjacency(net);
  const seen: boolean[] = net.names.map(() => false);
  seen[net.s] = true;
  const queue = [net.s];
  for (let qh = 0; qh < queue.length; qh++) {
    for (const a of adj[queue[qh]]) {
      const w = arcHead(net, a);
      if (!seen[w] && residual(net, flow, a) > 0) {
        seen[w] = true;
        queue.push(w);
      }
    }
  }
  return seen;
}

export function run(net: Net, maxSteps = 10_000): Run {
  const adj = adjacency(net);
  const flow = net.edges.map(() => 0);
  const augments: Augment[] = [];
  while (augments.length < maxSteps) {
    const { parent, seen } = search(net, flow, adj);
    if (!seen[net.t]) break;
    const path: Arc[] = [];
    for (let v = net.t; v !== net.s; ) {
      const a = parent[v] as Arc;
      path.unshift(a);
      v = arcTail(net, a);
    }
    const bottleneck = Math.min(...path.map((a) => residual(net, flow, a)));
    augments.push({ path, bottleneck, before: [...flow] });
    for (const a of path) flow[a.e] += a.dir * bottleneck;
  }
  const value = augments.reduce((sum, a) => sum + a.bottleneck, 0);
  const reach = reachable(net, flow);
  const cut: number[] = [];
  let cutCapacity = 0;
  net.edges.forEach(([u, v, c], e) => {
    const crosses = reach[u] !== reach[v] && (reach[u] || undirectedAt(net, e));
    if (crosses) {
      cut.push(e);
      cutCapacity += c;
    }
  });
  return { augments, flow, value, reach, cut, cutCapacity };
}

/** Flow on each edge after k augmentations. */
export function flowAt(r: Run, k: number): number[] {
  return k < r.augments.length ? r.augments[k].before : r.flow;
}

export const valueAt = (r: Run, k: number) => r.augments.slice(0, k).reduce((sum, a) => sum + a.bottleneck, 0);

// ------------------------------------------------------------------ presets

export interface Preset {
  id: string;
  net: Net;
  /** Height of the drawing in SVG units (width is 600). */
  height: number;
  /** For a bipartite matching network: the vertex indices of the two sides. */
  sides?: { x: number[]; y: number[] };
}

/** Seven edges in which the third shortest path cancels flow on a -> d. */
const NETWORK: Net = {
  names: ["s", "a", "b", "c", "d", "t"],
  xy: [[0, 0.5], [0.36, 0], [0.68, 0], [0.36, 1], [0.68, 1], [1, 0.5]],
  edges: [[0, 1, 6], [0, 3, 4], [1, 4, 3], [1, 2, 8], [3, 4, 2], [4, 5, 3], [2, 5, 9]],
  s: 0,
  t: 5,
};

/** x1..x4 and y1..y4; x3 and x4 both depend on y2, so the maximum matching has 3 edges. */
const MATCH_EDGES: [number, number][] = [[0, 0], [0, 2], [0, 3], [1, 0], [1, 1], [2, 1], [3, 1]];
const MATCHING: Net = {
  names: ["s", "x1", "x2", "x3", "x4", "y1", "y2", "y3", "y4", "t"],
  xy: [[0, 0.5], [0.33, 0], [0.33, 1 / 3], [0.33, 2 / 3], [0.33, 1], [0.67, 0], [0.67, 1 / 3], [0.67, 2 / 3], [0.67, 1], [1, 0.5]],
  edges: [
    ...[0, 1, 2, 3].map((i): [number, number, number] => [0, 1 + i, 1]),
    ...MATCH_EDGES.map(([x, y]): [number, number, number] => [1 + x, 5 + y, INF]),
    ...[0, 1, 2, 3].map((j): [number, number, number] => [5 + j, 9, 1]),
  ],
  s: 0,
  t: 9,
};

/** The diamond from the pseudo-polynomial warning, with C = 1000. */
const DIAMOND: Net = {
  names: ["s", "a", "b", "t"],
  xy: [[0, 0.5], [0.5, 0], [0.5, 1], [1, 0.5]],
  edges: [[0, 1, 1000], [0, 2, 1000], [1, 2, 1], [1, 3, 1000], [2, 3, 1000]],
  s: 0,
  t: 3,
};

export const PRESETS: Preset[] = [
  { id: "network", net: NETWORK, height: 230 },
  { id: "matching", net: MATCHING, height: 300, sides: { x: [1, 2, 3, 4], y: [5, 6, 7, 8] } },
  { id: "diamond", net: DIAMOND, height: 230 },
];

export function preset(id?: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}
