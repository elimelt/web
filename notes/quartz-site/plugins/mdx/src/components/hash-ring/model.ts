// The hash ring figure's logic, free of the DOM so render.ts, client.ts and
// the tests share it. Positions are 32-bit MurmurHash3 values; a key belongs
// to the first server point at or after its position, wrapping past 2^32.
// Table scenarios split the same 32-bit space into equal entries instead and
// look each entry's owner up in a table.

import data from "../../../../../../content/systems/distributed-systems/sharding-experiments/figure-data.json";

export const DATA = data as {
  requests: number;
  keys: number;
  sample: string[];
  top: [string, number][];
  entries: number;
  entryRequests: number[];
  entryKeys: number[];
};

export const NAMES = ["A", "B", "C", "D", "E", "F"];
const SPACE = 2 ** 32;

/** 32-bit MurmurHash3 (x86_32) of a string's UTF-8 bytes. */
export function murmur3(text: string, seed = 0): number {
  const bytes = new TextEncoder().encode(text);
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h = seed >>> 0;
  const blocks = bytes.length >> 2;
  for (let i = 0; i < blocks; i++) {
    const j = i * 4;
    let k = bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  let k = 0;
  const tail = blocks * 4;
  switch (bytes.length & 3) {
    case 3:
      k ^= bytes[tail + 2] << 16;
    // falls through
    case 2:
      k ^= bytes[tail + 1] << 8;
    // falls through
    case 1:
      k ^= bytes[tail];
      k = Math.imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, c2);
      h ^= k;
  }
  h ^= bytes.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Point {
  pos: number;
  server: number;
}

/** Each server's points, named "A#0", "A#1", ..., hashed with the placement seed, sorted around the ring. */
export function ringPoints(servers: number, points: number, seed: number): Point[] {
  const out: Point[] = [];
  for (let s = 0; s < servers; s++) {
    for (let i = 0; i < points; i++) out.push({ pos: murmur3(`${NAMES[s]}#${i}`, seed), server: s });
  }
  return out.sort((a, b) => a.pos - b.pos || a.server - b.server);
}

/** The server owning a position: the first point at or after it, wrapping around. */
export function ringOwner(ring: Point[], pos: number): number {
  let lo = 0;
  let hi = ring.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ring[mid].pos < pos) lo = mid + 1;
    else hi = mid;
  }
  return ring[lo === ring.length ? 0 : lo].server;
}

/** Arcs of the ring, as fractions of the circle in [0, 1], each with its owner. */
export interface Arc {
  from: number;
  to: number;
  server: number;
}

export function ringArcs(ring: Point[]): Arc[] {
  const arcs: Arc[] = [];
  const last = ring[ring.length - 1];
  // The arc that wraps past zero belongs to the first point.
  arcs.push({ from: 0, to: ring[0].pos / SPACE, server: ring[0].server });
  for (let i = 1; i < ring.length; i++) arcs.push({ from: ring[i - 1].pos / SPACE, to: ring[i].pos / SPACE, server: ring[i].server });
  arcs.push({ from: last.pos / SPACE, to: 1, server: ring[0].server });
  return arcs.filter((a) => a.to > a.from);
}

/** Fraction of the ring each server owns: its load with infinitely many keys. */
export function shares(arcs: Arc[], servers: number): number[] {
  const out = new Array<number>(servers).fill(0);
  for (const a of arcs) out[a.server] += a.to - a.from;
  return out;
}

/** The table's entry for a position: entries split the 32-bit space evenly. */
export const entryOf = (pos: number, entries: number): number => Math.floor((pos * entries) / SPACE);

/** Entries dealt out in turn: A, B, C, ..., A, B, ... */
export const roundRobin = (entries: number, servers: number): number[] => Array.from({ length: entries }, (_, e) => e % servers);

/**
 * A new server joins the table. It takes floor(entries / (servers + 1))
 * entries, one at a time from whichever server holds the most (the first such
 * server on a tie), taking that server's last entry.
 */
export function addToTable(owners: number[], servers: number): number[] {
  const next = owners.slice();
  const held = new Array<number>(servers).fill(0);
  for (const o of owners) held[o]++;
  const take = Math.floor(owners.length / (servers + 1));
  for (let t = 0; t < take; t++) {
    let s = 0;
    for (let i = 1; i < servers; i++) if (held[i] > held[s]) s = i;
    let e = next.length - 1;
    while (next[e] !== s) e--;
    next[e] = servers;
    held[s]--;
  }
  return next;
}

export function loads(owners: number[], weights: number[], servers: number): number[] {
  const out = new Array<number>(servers).fill(0);
  owners.forEach((o, e) => (out[o] += weights[e]));
  return out;
}

export interface Move {
  entry: number;
  from: number;
  to: number;
}

/**
 * One step of targeted rebalancing: move the entry from the busiest server to
 * the idlest that best evens the pair. Only entries lighter than the gap
 * qualify, so every move lowers the spread. Null when no entry qualifies.
 */
export function rebalanceStep(owners: number[], weights: number[], servers: number): Move | null {
  const load = loads(owners, weights, servers);
  let hi = 0;
  let lo = 0;
  for (let s = 1; s < servers; s++) {
    if (load[s] > load[hi]) hi = s;
    if (load[s] < load[lo]) lo = s;
  }
  const gap = load[hi] - load[lo];
  let best = -1;
  for (let e = 0; e < owners.length; e++) {
    if (owners[e] !== hi || !(weights[e] > 0 && weights[e] < gap)) continue;
    if (best < 0 || Math.abs(weights[e] - gap / 2) < Math.abs(weights[best] - gap / 2)) best = e;
  }
  return best < 0 ? null : { entry: best, from: hi, to: lo };
}

export const peak = (values: number[]): number => Math.max(...values) / (values.reduce((a, b) => a + b, 0) / values.length);

// ---- Scenarios -----------------------------------------------------------

export type ScenarioKey = "placement" | "points" | "add" | "add-points" | "table-add" | "hot";
export const SCENARIOS: ScenarioKey[] = ["placement", "points", "add", "add-points", "table-add", "hot"];

interface Scenario {
  table: boolean;
  servers: number;
  points: number;
}

const CONFIG: Record<ScenarioKey, Scenario> = {
  placement: { table: false, servers: 5, points: 1 },
  points: { table: false, servers: 5, points: 1 },
  add: { table: false, servers: 5, points: 1 },
  "add-points": { table: false, servers: 5, points: 16 },
  "table-add": { table: true, servers: 5, points: 0 },
  hot: { table: true, servers: 5, points: 0 },
};

export const POINT_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

export interface State {
  scenario: ScenarioKey;
  seed: number;
  points: number;
  added: boolean;
  owners: number[];
  moves: Move[];
}

export const scenarioKey = (s: unknown): ScenarioKey => (SCENARIOS.includes(s as ScenarioKey) ? (s as ScenarioKey) : "placement");

export function initial(scenario: ScenarioKey, seed = 0): State {
  const c = CONFIG[scenario];
  return { scenario, seed, points: c.points, added: false, owners: c.table ? roundRobin(DATA.entries, c.servers) : [], moves: [] };
}

export interface Dot {
  pos: number;
  server: number;
  moved: boolean;
  /** Requests in the trace, for the hot-key scenario; 0 otherwise. */
  requests: number;
}

export interface Bar {
  server: number;
  /** The fraction of the whole that the bar shows: ring, entries or requests. */
  share: number;
  detail: string;
}

export interface View {
  table: boolean;
  servers: number;
  arcs: Arc[];
  points: Point[];
  dots: Dot[];
  bars: Bar[];
  /** For table scenarios: each entry's owner, and the entries that just moved. */
  owners: number[];
  movedEntries: number[];
  readout: string;
  label: string;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const times = (x: number): string => `${x.toFixed(2)}×`;

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const keyPositions = (): number[] => DATA.sample.map((k) => murmur3(k));

export function view(state: State): View {
  const c = CONFIG[state.scenario];
  const servers = c.servers + (state.added ? 1 : 0);
  return c.table ? tableView(state, servers) : ringView(state, servers);
}

function ringView(state: State, servers: number): View {
  const ring = ringPoints(servers, state.points, state.seed);
  const arcs = ringArcs(ring);
  const share = shares(arcs, servers);
  const pos = keyPositions();
  const owner = pos.map((p) => ringOwner(ring, p));
  let before = owner;
  let beforeShare = share;
  if (state.added) {
    const old = ringPoints(servers - 1, state.points, state.seed);
    before = pos.map((p) => ringOwner(old, p));
    beforeShare = shares(ringArcs(old), servers - 1);
  }
  const counts = new Array<number>(servers).fill(0);
  owner.forEach((o) => counts[o]++);
  const dots = pos.map((p, i) => ({ pos: p, server: owner[i], moved: owner[i] !== before[i], requests: 0 }));
  const bars = share.map((s, i) => ({ server: i, share: s, detail: `${pct(s)} · ${counts[i]} key${counts[i] === 1 ? "" : "s"}` }));
  let busiest = 0;
  share.forEach((s, i) => (s > share[busiest] ? (busiest = i) : 0));
  const fair = 1 / servers;
  let readout: string;
  if (state.scenario === "add" || state.scenario === "add-points") {
    if (!state.added) {
      readout = "Press Add server F to see which keys move.";
    } else {
      const f = servers - 1;
      const donors = beforeShare.map((s, i) => (s - share[i] > 1e-12 ? NAMES[i] : "")).filter(Boolean);
      const moved = dots.filter((d) => d.moved).length;
      readout = `F took ${pct(share[f])} of the ring (a fair share is ${pct(fair)}), ${donors.length === 1 ? `all of it from ${donors[0]}` : `from ${list(donors)}`}. ${moved} of the ${pos.length} keys moved, every one of them to F.`;
    }
  } else {
    const what = state.points === 1 ? "With one point each" : `With ${state.points} points each`;
    readout = `${what}, the busiest server, ${NAMES[busiest]}, owns ${pct(share[busiest])} of the ring: ${times(share[busiest] / fair)} its fair share of ${pct(fair)}.`;
  }
  const label = `Hash ring with ${servers} servers and ${state.points} point${state.points === 1 ? "" : "s"} per server. ${readout}`;
  return { table: false, servers, arcs, points: ring, dots, bars, owners: [], movedEntries: [], readout, label };
}

function tableView(state: State, servers: number): View {
  const entries = DATA.entries;
  const hot = state.scenario === "hot";
  const owners = state.added ? addToTable(state.owners, servers - 1) : state.owners;
  const before = state.owners;
  const movedEntries = hot
    ? state.moves.length
      ? [state.moves[state.moves.length - 1].entry]
      : []
    : owners.map((o, e) => (o !== before[e] ? e : -1)).filter((e) => e >= 0);
  const arcs = owners.map((o, e) => ({ from: e / entries, to: (e + 1) / entries, server: o }));
  let dots: Dot[];
  let bars: Bar[];
  let readout: string;
  if (hot) {
    dots = DATA.top.map(([k, n]) => {
      const p = murmur3(k);
      const e = entryOf(p, entries);
      return { pos: p, server: owners[e], moved: movedEntries.includes(e), requests: n };
    });
    const load = loads(owners, DATA.entryRequests, servers);
    bars = load.map((l, i) => ({ server: i, share: l / DATA.requests, detail: `${pct(l / DATA.requests)} of requests` }));
    const p = peak(load);
    let busiest = 0;
    load.forEach((l, i) => (l > load[busiest] ? (busiest = i) : 0));
    const next = rebalanceStep(owners, DATA.entryRequests, servers);
    if (state.moves.length === 0) {
      readout = `Entries dealt out in turn leave ${NAMES[busiest]} serving ${times(p)} the mean load.`;
    } else {
      const m = state.moves[state.moves.length - 1];
      readout = `Moved entry ${m.entry} from ${NAMES[m.from]} to ${NAMES[m.to]}. The busiest server now serves ${times(p)} the mean load.`;
    }
    if (!next) readout += ` No single move lowers it further: ${state.moves.length} entr${state.moves.length === 1 ? "y" : "ies"} moved in all.`;
  } else {
    const pos = keyPositions();
    const ent = pos.map((p) => entryOf(p, entries));
    dots = pos.map((p, i) => ({ pos: p, server: owners[ent[i]], moved: owners[ent[i]] !== before[ent[i]], requests: 0 }));
    const held = new Array<number>(servers).fill(0);
    owners.forEach((o) => held[o]++);
    const counts = new Array<number>(servers).fill(0);
    dots.forEach((d) => counts[d.server]++);
    bars = held.map((h, i) => ({ server: i, share: h / entries, detail: `${h} entr${h === 1 ? "y" : "ies"} · ${counts[i]} keys` }));
    if (!state.added) {
      readout = "Press Add server F to see which keys move.";
    } else {
      const donors = movedEntries.map((e) => NAMES[before[e]]);
      const moved = dots.filter((d) => d.moved).length;
      readout = `F took ${movedEntries.length} of the ${entries} entries, one each from ${list(donors)}. ${moved} of the ${dots.length} keys moved, every one of them to F.`;
    }
  }
  const label = `Indirection table with ${entries} entries and ${servers} servers. ${readout}`;
  return { table: true, servers, arcs, points: [], dots, bars, owners, movedEntries, readout, label };
}

/** Applies a scenario's one action. */
export function act(state: State, action: string, value?: number): State {
  switch (action) {
    case "reseed":
      return { ...state, seed: state.seed + 1 };
    case "points":
      return { ...state, points: value ?? state.points };
    case "add":
      return { ...state, added: !state.added };
    case "move": {
      const m = rebalanceStep(state.owners, DATA.entryRequests, CONFIG[state.scenario].servers);
      if (!m) return state;
      const owners = state.owners.slice();
      owners[m.entry] = m.to;
      return { ...state, owners, moves: [...state.moves, m] };
    }
    case "reset":
      return initial(state.scenario, 0);
    default:
      return state;
  }
}

/** True when the hot-key scenario has no move left. */
export const settled = (state: State): boolean => rebalanceStep(state.owners, DATA.entryRequests, CONFIG[state.scenario].servers) === null;
