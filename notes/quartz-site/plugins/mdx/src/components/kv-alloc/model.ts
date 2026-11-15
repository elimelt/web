// KV-cache allocation on a replayed request trace: reserve the maximum length,
// grow a contiguous region by doubling, or allocate fixed-size pages (vLLM's
// PagedAttention). Free of the DOM so the build, the browser and the tests run
// the same code. test/kv-alloc.test.mjs checks it against kvsim.py, a separate
// Python implementation that produced the note's tables.
//
// One iteration is one decode step of a saturated FCFS server:
//   1. each running request, oldest admission first, appends one token's KV;
//      when memory runs out, the newest running request is preempted (freed
//      and put back at the head of the queue, to be recomputed) until the
//      growth fits;
//   2. requests that reached prompt + output tokens finish and free memory;
//   3. if nothing was preempted, the queue is admitted in order until the head
//      does not fit;
//   4. memory is classified (see Sample).

export type Kind = "max" | "double" | "paged";
export const KINDS: Kind[] = ["max", "double", "paged"];
export const BLOCK_SIZES = [8, 16, 32] as const;

export interface Config {
  kind: Kind;
  /** KV budget in token slots. */
  budget: number;
  /** Paged: tokens per block. */
  block: number;
  /** Reserve-max: slots reserved per request (the model's context length). */
  maxLen: number;
  /** Buddy allocators: the largest block, a power of two dividing the budget. */
  top: number;
  /** Paged: fraction of blocks admission leaves free (vLLM's default 1%). */
  watermark: number;
  /** Buddy allocators: fraction of the budget admission leaves free. */
  headroom: number;
}

/** Llama-3-8B in BF16: 128 KiB of KV per token, so 56 GiB is 458,752 slots. */
export const KV_BYTES_PER_TOKEN = 2 * 8 * 128 * 32 * 2;
export const BUDGET = (56 * 2 ** 30) / KV_BYTES_PER_TOKEN;

export const config = (kind: Kind, block = 16): Config => ({
  kind,
  budget: BUDGET,
  block,
  maxLen: 8192,
  top: 16384,
  watermark: 0.01,
  headroom: 0,
});

const MIN_BLOCK = 16;

/** Smallest power of two that is at least n. */
export function roundPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Index of the first element of a sorted array that is >= x. */
function lowerBound(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Binary buddy allocator. Free blocks of each size are kept sorted by address;
 * an allocation splits the lowest-address block of the smallest size that
 * fits, keeping the lower half each time.
 */
export class Buddy {
  private lists = new Map<number, number[]>();
  freeSlots: number;

  constructor(
    total: number,
    readonly top: number,
  ) {
    for (let s = MIN_BLOCK; s <= top; s *= 2) this.lists.set(s, []);
    const roots = this.lists.get(top)!;
    for (let a = 0; a < total; a += top) roots.push(a);
    this.freeSlots = total;
  }

  private has(size: number, addr: number): boolean {
    const l = this.lists.get(size)!;
    const i = lowerBound(l, addr);
    return i < l.length && l[i] === addr;
  }
  private take(size: number, addr: number): void {
    const l = this.lists.get(size)!;
    l.splice(lowerBound(l, addr), 1);
  }
  private put(size: number, addr: number): void {
    const l = this.lists.get(size)!;
    l.splice(lowerBound(l, addr), 0, addr);
  }

  /** Whether some free block can hold `size` slots. */
  fits(size: number): boolean {
    for (let s = size; s <= this.top; s *= 2) if (this.lists.get(s)!.length) return true;
    return false;
  }

  alloc(size: number): number {
    let s = size;
    while (s <= this.top && this.lists.get(s)!.length === 0) s *= 2;
    if (s > this.top) return -1;
    const addr = this.lists.get(s)!.shift()!;
    while (s > size) {
      s /= 2;
      this.put(s, addr + s);
    }
    this.freeSlots -= size;
    return addr;
  }

  free(addr: number, size: number): void {
    this.freeSlots += size;
    let a = addr;
    let s = size;
    while (s < this.top) {
      const buddy = a % (2 * s) === 0 ? a + s : a - s;
      if (!this.has(s, buddy)) break;
      this.take(s, buddy);
      a = Math.min(a, buddy);
      s *= 2;
    }
    this.put(s, a);
  }

  /** Doubles the block at addr if its upper buddy is free. */
  extend(addr: number, size: number): boolean {
    if (2 * size > this.top || addr % (2 * size) !== 0 || !this.has(size, addr + size)) return false;
    this.take(size, addr + size);
    this.freeSlots -= size;
    return true;
  }
}

export interface Live {
  id: number;
  /** Slots to allocate at (re)admission: the prompt, or prompt plus generated after a preemption. */
  ctx: number;
  /** KV length when the request finishes: prompt + output. */
  final: number;
  len: number;
  cap: number;
  /** Contiguous allocators: first slot. */
  addr: number;
  /** Paged: physical block ids in logical order. */
  blocks: number[];
}

/** Memory at the end of one iteration, in token slots. */
export interface Sample {
  used: number;
  /** Allocated slots the request will fill before it finishes. */
  reserved: number;
  /** Allocated slots past the request's final length. */
  internal: number;
  /** Free slots that would hold the head request, though no free block is large enough. */
  external: number;
  free: number;
  running: number;
  waiting: number;
  preempted: boolean;
}

export class Sim {
  running: Live[] = [];
  waiting: Live[];
  iteration = 0;
  preemptions = 0;
  recomputed = 0;
  copied = 0;
  last: Sample | null = null;
  readonly buddy: Buddy | null;
  private freeIds: number[] = [];
  private readonly reserve: number;

  constructor(
    reqs: ReadonlyArray<readonly [number, number]>,
    readonly cfg: Config,
  ) {
    this.waiting = reqs.map(([c, g], id) => ({ id, ctx: c, final: c + g, len: 0, cap: 0, addr: -1, blocks: [] }));
    if (cfg.kind === "paged") {
      const n = Math.floor(cfg.budget / cfg.block);
      for (let i = n - 1; i >= 0; i--) this.freeIds.push(i);
      this.reserve = Math.floor(cfg.watermark * n);
      this.buddy = null;
    } else {
      this.buddy = new Buddy(cfg.budget, cfg.top);
      this.reserve = cfg.headroom * cfg.budget;
    }
  }

  get done(): boolean {
    return this.running.length === 0 && this.waiting.length === 0;
  }

  /** Slots (contiguous) or blocks (paged) a waiting request needs to be admitted. */
  need(r: Live): number {
    const { kind, maxLen, block } = this.cfg;
    if (kind === "max") return maxLen;
    if (kind === "double") return Math.max(MIN_BLOCK, roundPow2(r.ctx));
    return Math.ceil(r.ctx / block);
  }

  private tryAdmit(r: Live): boolean {
    const n = this.need(r);
    if (this.buddy) {
      if (this.buddy.freeSlots - n < this.reserve) return false;
      const a = this.buddy.alloc(n);
      if (a < 0) return false;
      r.addr = a;
      r.cap = n;
    } else {
      if (this.freeIds.length - n < this.reserve) return false;
      r.blocks = [];
      for (let k = 0; k < n; k++) r.blocks.push(this.freeIds.pop()!);
      r.cap = n * this.cfg.block;
    }
    r.len = r.ctx;
    return true;
  }

  private release(r: Live): void {
    if (this.buddy) this.buddy.free(r.addr, r.cap);
    else for (let k = r.blocks.length - 1; k >= 0; k--) this.freeIds.push(r.blocks[k]);
    r.cap = 0;
    r.addr = -1;
    r.blocks = [];
  }

  /** Room for one more token in r; false when memory is exhausted. */
  private tryGrow(r: Live): boolean {
    if (r.len < r.cap) return true;
    if (!this.buddy) {
      const id = this.freeIds.pop();
      if (id === undefined) return false;
      r.blocks.push(id);
      r.cap += this.cfg.block;
      return true;
    }
    if (this.cfg.kind === "max") throw new Error(`request ${r.id} is longer than maxLen`);
    if (this.buddy.extend(r.addr, r.cap)) {
      r.cap *= 2;
      return true;
    }
    const a = this.buddy.alloc(2 * r.cap);
    if (a < 0) return false;
    this.copied += r.len;
    this.buddy.free(r.addr, r.cap);
    r.addr = a;
    r.cap *= 2;
    return true;
  }

  step(): Sample {
    this.iteration++;
    let preempted = false;
    for (let i = 0; i < this.running.length; ) {
      const r = this.running[i];
      let evictedSelf = false;
      while (!this.tryGrow(r)) {
        const v = this.running.pop()!;
        this.release(v);
        v.ctx = v.len;
        this.waiting.unshift(v);
        this.preemptions++;
        this.recomputed += v.len;
        preempted = true;
        if (v === r) {
          evictedSelf = true;
          break;
        }
      }
      if (evictedSelf) break;
      r.len++;
      i++;
    }
    const still: Live[] = [];
    for (const r of this.running) {
      if (r.len >= r.final) this.release(r);
      else still.push(r);
    }
    this.running = still;
    if (!preempted) {
      while (this.waiting.length && this.tryAdmit(this.waiting[0])) this.running.push(this.waiting.shift()!);
    }
    this.last = this.sample(preempted);
    return this.last;
  }

  private sample(preempted: boolean): Sample {
    let used = 0;
    let allocated = 0;
    let reserved = 0;
    let internal = 0;
    for (const r of this.running) {
      used += r.len;
      allocated += r.cap;
      const fill = Math.min(r.cap, r.final);
      reserved += fill - r.len;
      internal += r.cap - fill;
    }
    const unallocated = this.cfg.budget - allocated;
    let external = 0;
    if (this.buddy && this.waiting.length) {
      const n = this.need(this.waiting[0]);
      if (unallocated >= n && !this.buddy.fits(n)) external = unallocated;
    }
    return { used, reserved, internal, external, free: unallocated - external, running: this.running.length, waiting: this.waiting.length, preempted };
  }
}

/** What the note's tables report: averages over the iterations in which requests wait. */
export interface Summary {
  used: number;
  reserved: number;
  internal: number;
  external: number;
  free: number;
  running: number;
  steadyIterations: number;
  iterations: number;
  preemptions: number;
  recomputed: number;
  copied: number;
  peakRunning: number;
}

export interface Run {
  samples: Sample[];
  summary: Summary;
}

export function run(reqs: ReadonlyArray<readonly [number, number]>, cfg: Config): Run {
  const sim = new Sim(reqs, cfg);
  const samples: Sample[] = [];
  const acc = { used: 0, reserved: 0, internal: 0, external: 0, free: 0, running: 0 };
  let steady = 0;
  let peak = 0;
  while (!sim.done) {
    const s = sim.step();
    samples.push(s);
    peak = Math.max(peak, s.running);
    if (s.waiting > 0) {
      steady++;
      for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] += s[k];
    }
  }
  const avg = (v: number, scale: number) => (steady ? v / steady / scale : 0);
  const B = cfg.budget;
  return {
    samples,
    summary: {
      used: avg(acc.used, B),
      reserved: avg(acc.reserved, B),
      internal: avg(acc.internal, B),
      external: avg(acc.external, B),
      free: avg(acc.free, B),
      running: avg(acc.running, 1),
      steadyIterations: steady,
      iterations: sim.iteration,
      preemptions: sim.preemptions,
      recomputed: sim.recomputed,
      copied: sim.copied,
      peakRunning: peak,
    },
  };
}

/** Replays to the end of iteration t (1-based) and returns the simulator in that state. */
export function stateAt(reqs: ReadonlyArray<readonly [number, number]>, cfg: Config, t: number): Sim {
  const sim = new Sim(reqs, cfg);
  while (sim.iteration < t && !sim.done) sim.step();
  return sim;
}

export type Cat = "used" | "reserved" | "internal";

/** A run of slots in physical memory, by what it holds. */
export interface Segment {
  addr: number;
  size: number;
  cat: Cat;
}

/** Physical layout of the running requests, adjacent runs of one kind merged. */
export function layout(sim: Sim): Segment[] {
  const out: Segment[] = [];
  const push = (addr: number, size: number, cat: Cat) => {
    if (size > 0) out.push({ addr, size, cat });
  };
  // Splits logical slots [lo, hi) of request r, placed at physical `base`, by kind.
  const pieces = (r: Live, lo: number, hi: number, base: number) => {
    const fill = Math.min(r.cap, r.final);
    const cut = (a: number, b: number, cat: Cat) => {
      const s = Math.max(lo, a);
      const e = Math.min(hi, b);
      push(base + s - lo, e - s, cat);
    };
    cut(0, r.len, "used");
    cut(r.len, fill, "reserved");
    cut(fill, r.cap, "internal");
  };
  const b = sim.cfg.block;
  for (const r of sim.running) {
    if (sim.buddy) pieces(r, 0, r.cap, r.addr);
    else r.blocks.forEach((id, k) => pieces(r, k * b, (k + 1) * b, id * b));
  }
  out.sort((x, y) => x.addr - y.addr);
  const merged: Segment[] = [];
  for (const s of out) {
    const m = merged[merged.length - 1];
    if (m && m.cat === s.cat && m.addr + m.size === s.addr) m.size += s.size;
    else merged.push({ ...s });
  }
  return merged;
}
