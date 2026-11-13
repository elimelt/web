// Page replacement policies on a page reference string, written so the figure
// can both count faults fast and explain one step at a time. The fault counts
// are checked by a test against pagesim.c, which produced the note's tables.

import curvesJson from "../../../../../../content/systems/operating-systems/lecture-notes/page-fault-experiments/traces/window_curves.json";

export type Policy = "fifo" | "clock" | "lru" | "opt";
export const POLICIES: Policy[] = ["fifo", "clock", "lru", "opt"];
export const POLICY_NAMES: Record<Policy, string> = { fifo: "FIFO", clock: "CLOCK", lru: "LRU", opt: "OPT" };

export interface TraceInfo {
  label: string;
  window_start: number;
  full_refs: number;
  refs: number;
  pages: number;
  curves: Record<Policy, number[]>;
}

/** Fault counts that pagesim.c computed for each trace window, at 1..pages frames. */
export const windows = curvesJson as Record<string, TraceInfo>;

/**
 * The string that textbooks use to show Belady's anomaly under FIFO: 9 faults
 * with 3 frames, 10 with 4. Wikipedia's article on the anomaly uses the same
 * pattern with pages relabeled.
 */
export const BELADY = Uint16Array.from([1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]);

/** For each reference, the index of the next reference to the same page, or `n` if none. */
export function nextUses(trace: Uint16Array): Int32Array {
  const n = trace.length;
  const next = new Int32Array(n);
  const last = new Map<number, number>();
  for (let t = n - 1; t >= 0; t--) {
    next[t] = last.get(trace[t]) ?? n;
    last.set(trace[t], t);
  }
  return next;
}

/** What happened at one reference. */
export interface Step {
  t: number;
  page: number;
  hit: boolean;
  /** Evicted page, or -1 if a free frame was used or it was a hit. */
  victim: number;
  /** For a fault with eviction, the time that justified the choice (see `why`). */
  victimTime: number;
  /** CLOCK only: reference bits the hand cleared before it found a victim. */
  swept: number;
}

/** A replacement policy with F frames, fed one reference at a time. */
export interface Sim {
  readonly policy: Policy;
  readonly frames: number;
  faults: number;
  step(t: number, page: number): Step;
  /** Resident pages in the order the policy considers them, first = next victim. */
  order(): number[];
  /** Per-page detail for the frames view: load time, last use, reference bit or next use. */
  detail(page: number): number;
  /** CLOCK: the frame slots in physical order and the hand position. */
  slots?(): { pages: number[]; bits: number[]; hand: number };
}

class Fifo implements Sim {
  readonly policy = "fifo" as const;
  faults = 0;
  private queue: number[] = [];
  private head = 0;
  private loaded = new Map<number, number>();
  constructor(readonly frames: number) {}
  step(t: number, page: number): Step {
    if (this.loaded.has(page)) return { t, page, hit: true, victim: -1, victimTime: -1, swept: 0 };
    this.faults++;
    let victim = -1;
    let victimTime = -1;
    if (this.loaded.size === this.frames) {
      victim = this.queue[this.head++];
      victimTime = this.loaded.get(victim)!;
      this.loaded.delete(victim);
      if (this.head > 4096 && this.head * 2 > this.queue.length) {
        this.queue = this.queue.slice(this.head);
        this.head = 0;
      }
    }
    this.queue.push(page);
    this.loaded.set(page, t);
    return { t, page, hit: false, victim, victimTime, swept: 0 };
  }
  order(): number[] {
    return this.queue.slice(this.head);
  }
  detail(page: number): number {
    return this.loaded.get(page) ?? -1;
  }
}

class Lru implements Sim {
  readonly policy = "lru" as const;
  faults = 0;
  // A Map iterates in insertion order, so deleting and re-inserting on every
  // use keeps it ordered from least to most recently used.
  private used = new Map<number, number>();
  constructor(readonly frames: number) {}
  step(t: number, page: number): Step {
    if (this.used.has(page)) {
      this.used.delete(page);
      this.used.set(page, t);
      return { t, page, hit: true, victim: -1, victimTime: -1, swept: 0 };
    }
    this.faults++;
    let victim = -1;
    let victimTime = -1;
    if (this.used.size === this.frames) {
      const [p, last] = this.used.entries().next().value as [number, number];
      victim = p;
      victimTime = last;
      this.used.delete(p);
    }
    this.used.set(page, t);
    return { t, page, hit: false, victim, victimTime, swept: 0 };
  }
  order(): number[] {
    return [...this.used.keys()];
  }
  detail(page: number): number {
    return this.used.get(page) ?? -1;
  }
}

class Clock implements Sim {
  readonly policy = "clock" as const;
  faults = 0;
  private pages: number[] = [];
  private bits: number[] = [];
  private slot = new Map<number, number>();
  private hand = 0;
  constructor(readonly frames: number) {}
  step(t: number, page: number): Step {
    const s = this.slot.get(page);
    if (s !== undefined) {
      this.bits[s] = 1;
      return { t, page, hit: true, victim: -1, victimTime: -1, swept: 0 };
    }
    this.faults++;
    if (this.pages.length < this.frames) {
      this.slot.set(page, this.pages.length);
      this.pages.push(page);
      this.bits.push(1);
      return { t, page, hit: false, victim: -1, victimTime: -1, swept: 0 };
    }
    let swept = 0;
    while (this.bits[this.hand]) {
      this.bits[this.hand] = 0;
      this.hand = (this.hand + 1) % this.frames;
      swept++;
    }
    const victim = this.pages[this.hand];
    this.slot.delete(victim);
    this.pages[this.hand] = page;
    this.bits[this.hand] = 1;
    this.slot.set(page, this.hand);
    this.hand = (this.hand + 1) % this.frames;
    return { t, page, hit: false, victim, victimTime: -1, swept };
  }
  order(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.pages.length; i++) out.push(this.pages[(this.hand + i) % this.pages.length]);
    return out;
  }
  detail(page: number): number {
    const s = this.slot.get(page);
    return s === undefined ? -1 : this.bits[s];
  }
  slots() {
    return { pages: [...this.pages], bits: [...this.bits], hand: this.pages.length < this.frames ? -1 : this.hand };
  }
}

/** Belady's MIN: evict the resident page whose next use is furthest away. */
class Opt implements Sim {
  readonly policy = "opt" as const;
  faults = 0;
  private nextOf = new Map<number, number>();
  // Max-heap of [next use, page]; entries go stale when a page is used again.
  private heap: number[] = [];
  constructor(readonly frames: number, private next: Int32Array) {}
  private push(key: number, page: number) {
    const h = this.heap;
    let i = h.length / 2;
    h.push(key, page);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[2 * p] >= h[2 * i]) break;
      [h[2 * p], h[2 * i]] = [h[2 * i], h[2 * p]];
      [h[2 * p + 1], h[2 * i + 1]] = [h[2 * i + 1], h[2 * p + 1]];
      i = p;
    }
  }
  private pop(): [number, number] {
    const h = this.heap;
    const top: [number, number] = [h[0], h[1]];
    const lastPage = h.pop()!;
    const lastKey = h.pop()!;
    const n = h.length / 2;
    if (n > 0) {
      h[0] = lastKey;
      h[1] = lastPage;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && h[2 * l] > h[2 * m]) m = l;
        if (r < n && h[2 * r] > h[2 * m]) m = r;
        if (m === i) break;
        [h[2 * m], h[2 * i]] = [h[2 * i], h[2 * m]];
        [h[2 * m + 1], h[2 * i + 1]] = [h[2 * i + 1], h[2 * m + 1]];
        i = m;
      }
    }
    return top;
  }
  step(t: number, page: number): Step {
    const nu = this.next[t];
    if (this.nextOf.has(page)) {
      this.nextOf.set(page, nu);
      this.push(nu, page);
      return { t, page, hit: true, victim: -1, victimTime: -1, swept: 0 };
    }
    this.faults++;
    let victim = -1;
    let victimTime = -1;
    if (this.nextOf.size === this.frames) {
      for (;;) {
        const [key, p] = this.pop();
        if (this.nextOf.get(p) === key) {
          victim = p;
          victimTime = key;
          this.nextOf.delete(p);
          break;
        }
      }
    }
    this.nextOf.set(page, nu);
    this.push(nu, page);
    return { t, page, hit: false, victim, victimTime, swept: 0 };
  }
  order(): number[] {
    return [...this.nextOf.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([p]) => p);
  }
  detail(page: number): number {
    return this.nextOf.get(page) ?? -1;
  }
}

export function makeSim(policy: Policy, frames: number, next: Int32Array): Sim {
  switch (policy) {
    case "fifo":
      return new Fifo(frames);
    case "lru":
      return new Lru(frames);
    case "clock":
      return new Clock(frames);
    case "opt":
      return new Opt(frames, next);
  }
}

/** Run a whole trace; returns the fault count and which references faulted. */
export function run(trace: Uint16Array, next: Int32Array, policy: Policy, frames: number): { faults: number; faulted: Uint8Array } {
  const sim = makeSim(policy, frames, next);
  const faulted = new Uint8Array(trace.length);
  for (let t = 0; t < trace.length; t++) if (!sim.step(t, trace[t]).hit) faulted[t] = 1;
  return { faults: sim.faults, faulted };
}

/** Fault counts at 1..maxFrames, for a trace small enough to compute on the spot. */
export function curve(trace: Uint16Array, next: Int32Array, policy: Policy, maxFrames: number): number[] {
  const out: number[] = [];
  for (let f = 1; f <= maxFrames; f++) out.push(run(trace, next, policy, f).faults);
  return out;
}

export const distinctPages = (trace: Uint16Array): number => new Set(trace).size;

/** Frame counts where adding a frame added faults. */
export function anomalies(counts: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < counts.length; i++) if (counts[i + 1] > counts[i]) out.push(i + 1);
  return out;
}
