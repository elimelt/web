// MESI simulation of per-core counters laid out in memory at a given stride.
// Each core owns one 8-byte counter; the preset decides the stride and
// whether a core writes its counter or only reads it. Accesses run one at a
// time, with no store buffer, so every write needs the line in Modified state
// before it completes. No DOM access, so render.ts and the tests can run it.

import { mulberry32 } from "../../shared/random";

export type State = "M" | "E" | "S" | "I";
export type Role = "write" | "read";
export const LINE = 64;
export const WORD = 8;

export interface Preset {
  label: string;
  stride: number;
  roles: Role[];
}

export const PRESETS: Record<string, Preset> = {
  packed: { label: "Four counters packed into one cache line", stride: 8, roles: ["write", "write", "write", "write"] },
  padded: { label: "Four counters padded to one cache line each", stride: 64, roles: ["write", "write", "write", "write"] },
  reader: { label: "One writer and three readers on one cache line", stride: 8, roles: ["write", "read", "read", "read"] },
};

export const presetKey = (p: unknown): string => (typeof p === "string" && p in PRESETS ? p : "packed");

export type Source = "hit" | "upgrade" | "memory" | "core";

export interface Event {
  core: number;
  op: Role;
  line: number;
  source: Source;
  /** The core whose Modified copy supplied the data, when source is "core". */
  from: number;
  /** Copies in other cores invalidated by this access. */
  invalidated: number[];
}

export interface Machine {
  key: string;
  stride: number;
  roles: Role[];
  lines: number;
  /** state[core][line] */
  state: State[][];
  /** Each core's counter value, as the program sees it. */
  value: number[];
  trace: Event[];
}

export const cores = (key: string): number => PRESETS[key].roles.length;
export const offsetOf = (stride: number, core: number): number => core * stride;
export const lineOf = (stride: number, core: number): number => Math.floor(offsetOf(stride, core) / LINE);

export function fresh(key: string): Machine {
  const p = PRESETS[presetKey(key)];
  const n = p.roles.length;
  const lines = lineOf(p.stride, n - 1) + 1;
  return {
    key: presetKey(key),
    stride: p.stride,
    roles: p.roles.slice(),
    lines,
    state: Array.from({ length: n }, () => Array<State>(lines).fill("I")),
    value: Array(n).fill(0),
    trace: [],
  };
}

/** Core `c` performs its role's access on its own counter. */
export function step(m: Machine, c: number): Event {
  const line = lineOf(m.stride, c);
  const op = m.roles[c];
  const st = m.state;
  const others = st.map((_, k) => k).filter((k) => k !== c);
  const owner = others.find((k) => st[k][line] === "M" || st[k][line] === "E") ?? -1;
  const ownerWasM = owner >= 0 && st[owner][line] === "M";
  const ev: Event = { core: c, op, line, source: "hit", from: -1, invalidated: [] };
  const mine = st[c][line];

  if (op === "read") {
    if (mine === "I") {
      if (owner >= 0) {
        // A Modified or Exclusive copy elsewhere drops to Shared; a Modified
        // one supplies the data (a HITM on Intel).
        ev.source = ownerWasM ? "core" : "memory";
        ev.from = ownerWasM ? owner : -1;
        st[owner][line] = "S";
        st[c][line] = "S";
      } else {
        ev.source = "memory";
        st[c][line] = others.some((k) => st[k][line] === "S") ? "S" : "E";
      }
    }
  } else {
    if (mine === "E") st[c][line] = "M";
    else if (mine !== "M") {
      if (mine === "S") ev.source = "upgrade";
      else if (ownerWasM) {
        ev.source = "core";
        ev.from = owner;
      } else ev.source = "memory";
      for (const k of others) {
        if (st[k][line] !== "I") {
          ev.invalidated.push(k);
          st[k][line] = "I";
        }
      }
      st[c][line] = "M";
    }
    m.value[c] += 1;
  }
  m.trace.push(ev);
  return ev;
}

export interface Tally {
  accesses: number;
  hits: number;
  fromCore: number;
  invalidations: number;
}

export function tally(m: Machine): Tally {
  const t: Tally = { accesses: m.trace.length, hits: 0, fromCore: 0, invalidations: 0 };
  for (const e of m.trace) {
    if (e.source === "hit") t.hits++;
    if (e.source === "core") t.fromCore++;
    t.invalidations += e.invalidated.length;
  }
  return t;
}

/** A seeded random interleaving of `count` accesses. */
export function randomSchedule(n: number, count: number, seed: number): number[] {
  const r = mulberry32(seed);
  return Array.from({ length: count }, () => Math.floor(r() * n));
}

export function run(key: string, schedule: number[]): Machine {
  const m = fresh(key);
  for (const c of schedule) step(m, c);
  return m;
}

export function describe(m: Machine, e: Event | undefined): string {
  if (!e) return "No accesses yet. Each button makes that core access its own counter once.";
  const what = `Core ${e.core} ${e.op === "write" ? "writes" : "reads"} c${e.core} (line ${e.line})`;
  const inv = e.invalidated.length
    ? ` and invalidates the copy in core${e.invalidated.length > 1 ? "s" : ""} ${e.invalidated.join(", ")}`
    : "";
  switch (e.source) {
    case "hit":
      return `${what}: hit, the line is already ${m.state[e.core][e.line] === "M" ? "Modified" : m.state[e.core][e.line] === "E" ? "Exclusive" : "Shared"} in its cache.`;
    case "upgrade":
      return `${what}: the line is Shared, so the core sends an upgrade${inv}.`;
    case "memory":
      return `${what}: miss, served from L3 or memory${inv}.`;
    case "core":
      return `${what}: miss, core ${e.from} holds the line Modified and supplies it${inv}.`;
  }
}
