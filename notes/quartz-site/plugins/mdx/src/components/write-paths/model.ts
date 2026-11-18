// A small B+-tree and a small leveled LSM-tree, fed the same stream of writes,
// with every byte each one writes counted. No DOM access, so the tests and
// render.ts run it in Node.
//
// Units: one record (key + value) is 1 unit. A B-tree page holds PAGE records
// and always costs PAGE units to write, however full it is. An SSTable holds
// at most FILE records and costs one unit per record it contains.
//
// B-tree logging follows SQLite in WAL mode: a commit appends a full image of
// every page the transaction dirtied to the log, and a checkpoint, run when
// the log holds CHECKPOINT_PAGES images, writes each distinct logged page back
// into the database file once.
//
// The LSM-tree follows RocksDB's leveled compaction in miniature: every put is
// appended to the log, a full memtable is flushed to L0 as one sorted file,
// two L0 files trigger an L0 -> L1 merge, and a level over its target size
// merges one file (chosen round robin by key) into the overlapping files of
// the next level. A file whose key range overlaps nothing below moves down
// without being rewritten (RocksDB's "trivial move"). Only the newest version
// of a key survives a merge.

export const PAGE = 8; // records per B-tree page
export const CHECKPOINT_PAGES = 16; // log images that trigger a checkpoint
export const MEMTABLE = 8; // records per memtable
export const FILE = 8; // records per SSTable
export const L0_TRIGGER = 2; // L0 files that trigger L0 -> L1
export const FANOUT = 4; // size ratio between adjacent levels
export const L1_TARGET = 16; // records
export const LEVELS = 3; // L0, L1 and the last level, L2
export const BLOOM_BITS = 10; // bits per key in each SSTable's filter
export const BLOOM_K = 7; // round(10 * ln 2)

export const KEYS = 64; // keys 0, 2, 4, ..., 126 are written; odd keys never are
export const keyOf = (i: number) => 2 * i;
export const levelTarget = (level: number) => L1_TARGET * FANOUT ** (level - 1);

// ---- B+-tree -----------------------------------------------------------------

export interface BNode {
  id: number;
  leaf: boolean;
  keys: number[]; // leaf: stored keys; internal: separators (keys[i] = smallest key of children[i + 1])
  children: BNode[];
}

export interface BTreeCounters {
  logUnits: number; // page images appended to the log, in units
  checkpointUnits: number; // pages written back by checkpoints, in units
  splits: number;
}

export class BTree {
  root: BNode;
  private nextId = 0;
  pages = 0;
  counters: BTreeCounters = { logUnits: 0, checkpointUnits: 0, splits: 0 };
  private dirty = new Set<number>(); // pages dirtied by the open transaction
  private logged = new Set<number>(); // pages with an image in the log since the last checkpoint
  private logImages = 0;
  lastWritten = new Set<number>(); // pages written (logged or checkpointed) by the last commit

  constructor() {
    this.root = this.alloc(true);
  }

  private alloc(leaf: boolean): BNode {
    this.pages += 1;
    return { id: this.nextId++, leaf, keys: [], children: [] };
  }

  get height(): number {
    let h = 1;
    for (let n = this.root; !n.leaf; n = n.children[0]) h += 1;
    return h;
  }

  /** Pages visited from the root to the leaf that holds (or would hold) key. */
  path(key: number): BNode[] {
    const out: BNode[] = [];
    let n = this.root;
    for (;;) {
      out.push(n);
      if (n.leaf) return out;
      n = n.children[childIndex(n, key)];
    }
  }

  has(key: number): boolean {
    const p = this.path(key);
    return p[p.length - 1].keys.includes(key);
  }

  /** Inserts or overwrites key inside the open transaction. */
  put(key: number): void {
    const split = this.insert(this.root, key);
    if (split) {
      const r = this.alloc(false);
      r.keys = [split.sep];
      r.children = [this.root, split.right];
      this.root = r;
      this.dirty.add(r.id);
    }
  }

  private insert(n: BNode, key: number): { sep: number; right: BNode } | null {
    if (n.leaf) {
      this.dirty.add(n.id);
      const i = lowerBound(n.keys, key);
      if (n.keys[i] === key) return null; // overwrite in place: the page is dirtied, nothing moves
      const appending = i === n.keys.length && this.isRightmost(n);
      n.keys.splice(i, 0, key);
      if (n.keys.length <= PAGE) return null;
      this.counters.splits += 1;
      const right = this.alloc(true);
      // SQLite's balance_quick: a key appended past the end of the rightmost
      // leaf starts a new leaf on its own, so sequential inserts fill pages.
      const cut = appending ? n.keys.length - 1 : Math.floor(n.keys.length / 2);
      right.keys = n.keys.splice(cut);
      this.dirty.add(right.id);
      return { sep: right.keys[0], right };
    }
    const ci = childIndex(n, key);
    const split = this.insert(n.children[ci], key);
    if (!split) return null;
    this.dirty.add(n.id);
    n.keys.splice(ci, 0, split.sep);
    n.children.splice(ci + 1, 0, split.right);
    if (n.children.length <= PAGE) return null;
    this.counters.splits += 1;
    const right = this.alloc(false);
    const mid = Math.floor(n.children.length / 2);
    const up = n.keys[mid - 1];
    right.children = n.children.splice(mid);
    right.keys = n.keys.splice(mid);
    n.keys.splice(mid - 1, 1);
    this.dirty.add(right.id);
    return { sep: up, right };
  }

  private isRightmost(leaf: BNode): boolean {
    let n = this.root;
    while (!n.leaf) n = n.children[n.children.length - 1];
    return n === leaf;
  }

  /** Commits the open transaction: one log image per dirtied page, then a checkpoint if the log is full. */
  commit(): void {
    this.lastWritten = new Set(this.dirty);
    for (const id of this.dirty) {
      this.counters.logUnits += PAGE;
      this.logged.add(id);
      this.logImages += 1;
    }
    this.dirty.clear();
    if (this.logImages >= CHECKPOINT_PAGES) this.checkpoint();
  }

  checkpoint(): void {
    this.counters.checkpointUnits += this.logged.size * PAGE;
    this.logged.clear();
    this.logImages = 0;
  }

  get writtenUnits(): number {
    return this.counters.logUnits + this.counters.checkpointUnits;
  }

  /** Units of storage the tree occupies: every page, full or not. */
  get storedUnits(): number {
    return this.pages * PAGE;
  }

  leaves(): BNode[] {
    const out: BNode[] = [];
    const walk = (n: BNode) => (n.leaf ? out.push(n) : n.children.forEach(walk));
    walk(this.root);
    return out;
  }

  /** Nodes by depth, root first. */
  levels(): BNode[][] {
    const out: BNode[][] = [];
    let row = [this.root];
    while (row.length) {
      out.push(row);
      row = row.flatMap((n) => n.children);
    }
    return out;
  }
}

function lowerBound(a: number[], key: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function childIndex(n: BNode, key: number): number {
  let i = 0;
  while (i < n.keys.length && key >= n.keys[i]) i++;
  return i;
}

// ---- Bloom filter --------------------------------------------------------------

/** 32-bit integer hash (lowbias32), independent of the key's order. */
function hash32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export class Bloom {
  bits: Uint8Array;
  constructor(keys: number[], salt: number, bitsPerKey = BLOOM_BITS, k = BLOOM_K) {
    this.m = Math.max(8, keys.length * bitsPerKey);
    this.k = k;
    this.salt = salt;
    this.bits = new Uint8Array(this.m);
    for (const key of keys) for (const b of this.probes(key)) this.bits[b] = 1;
  }
  m: number;
  k: number;
  salt: number;
  // Double hashing (Kirsch and Mitzenmacher): probe i is h1 + i * h2.
  probes(key: number): number[] {
    const h1 = hash32(key ^ Math.imul(this.salt, 0x9e3779b9));
    const h2 = hash32(h1 ^ 0x5bd1e995) | 1;
    const out: number[] = [];
    for (let i = 0; i < this.k; i++) out.push(((h1 + Math.imul(i, h2)) >>> 0) % this.m);
    return out;
  }
  mayContain(key: number): boolean {
    return this.probes(key).every((b) => this.bits[b] === 1);
  }
}

// ---- LSM-tree --------------------------------------------------------------------

export interface Entry {
  key: number;
  seq: number; // larger is newer
}

export interface SSTable {
  id: number;
  entries: Entry[]; // sorted by key, one entry per key
  bloom: Bloom;
}

export const lo = (f: SSTable) => f.entries[0].key;
export const hi = (f: SSTable) => f.entries[f.entries.length - 1].key;
const overlaps = (f: SSTable, a: number, b: number) => lo(f) <= b && hi(f) >= a;

export interface LsmCounters {
  logUnits: number;
  flushUnits: number;
  compactUnits: number;
  flushes: number;
  compactions: number;
  trivialMoves: number;
}

export interface CompactionEvent {
  kind: "flush" | "merge" | "move";
  from: number; // level, -1 for the memtable
  to: number;
  read: number; // units read
  written: number; // units written
}

export class Lsm {
  memtable = new Map<number, number>(); // key -> seq
  levels: SSTable[][] = Array.from({ length: LEVELS }, () => []); // L0 newest first; L1.. sorted by key
  counters: LsmCounters = { logUnits: 0, flushUnits: 0, compactUnits: 0, flushes: 0, compactions: 0, trivialMoves: 0 };
  events: CompactionEvent[] = []; // since the last commit
  lastWritten = new Set<number>(); // file ids written by the last commit
  private seq = 0;
  private nextId = 0;
  private cursor: number[] = Array(LEVELS).fill(-1); // round-robin compaction pointer per level (last key compacted)

  put(key: number): void {
    this.counters.logUnits += 1;
    this.memtable.set(key, ++this.seq);
    if (this.memtable.size >= MEMTABLE) this.flush();
  }

  /** Ends a batch. Writes already happened in put; this only resets the per-commit trace. */
  commit(): void {}

  beginCommit(): void {
    this.events = [];
    this.lastWritten = new Set();
  }

  private makeFile(entries: Entry[]): SSTable {
    const id = this.nextId++;
    this.lastWritten.add(id);
    return { id, entries, bloom: new Bloom(entries.map((e) => e.key), id + 1) };
  }

  private flush(): void {
    const entries = [...this.memtable.entries()].sort((a, b) => a[0] - b[0]).map(([key, seq]) => ({ key, seq }));
    this.memtable.clear();
    this.levels[0].unshift(this.makeFile(entries));
    this.counters.flushUnits += entries.length;
    this.counters.flushes += 1;
    this.events.push({ kind: "flush", from: -1, to: 0, read: 0, written: entries.length });
    this.compactAsNeeded();
  }

  size(level: number): number {
    return this.levels[level].reduce((s, f) => s + f.entries.length, 0);
  }

  /** Compaction score per level, as in RocksDB: L0 by file count, others by size over target. */
  score(level: number): number {
    if (level === 0) return this.levels[0].length / L0_TRIGGER;
    if (level === LEVELS - 1) return 0; // the last level has no level below it
    return this.size(level) / levelTarget(level);
  }

  private compactAsNeeded(): void {
    for (let guard = 0; guard < 100; guard++) {
      let best = -1;
      let bestScore = 1;
      for (let l = 0; l < LEVELS - 1; l++) {
        const s = this.score(l);
        if (s >= bestScore) {
          bestScore = s;
          best = l;
        }
      }
      if (best < 0) return;
      this.compact(best);
    }
  }

  private compact(level: number): void {
    const out = level + 1;
    let inputs: SSTable[];
    if (level === 0) {
      inputs = [...this.levels[0]];
    } else {
      // Round robin: the first file whose smallest key is past the last key compacted at this level.
      const files = this.levels[level];
      inputs = [files.find((f) => lo(f) > this.cursor[level]) ?? files[0]];
      this.cursor[level] = hi(inputs[0]);
    }
    const a = Math.min(...inputs.map(lo));
    const b = Math.max(...inputs.map(hi));
    const below = this.levels[out].filter((f) => overlaps(f, a, b));
    const inputsDisjoint = inputs.every((f, i) => inputs.every((g, j) => i === j || !overlaps(g, lo(f), hi(f))));
    const remove = (lv: number, fs: SSTable[]) => {
      const gone = new Set(fs.map((f) => f.id));
      this.levels[lv] = this.levels[lv].filter((f) => !gone.has(f.id));
    };
    if (below.length === 0 && inputsDisjoint) {
      remove(level, inputs);
      this.levels[out] = [...this.levels[out], ...inputs].sort((x, y) => lo(x) - lo(y));
      this.counters.trivialMoves += inputs.length;
      this.events.push({ kind: "move", from: level, to: out, read: 0, written: 0 });
      return;
    }
    // Merge: keep the newest version of each key.
    const newest = new Map<number, number>();
    let read = 0;
    for (const f of [...inputs, ...below]) {
      read += f.entries.length;
      for (const e of f.entries) if ((newest.get(e.key) ?? -1) < e.seq) newest.set(e.key, e.seq);
    }
    const merged = [...newest.entries()].sort((x, y) => x[0] - y[0]).map(([key, seq]) => ({ key, seq }));
    const files: SSTable[] = [];
    for (let i = 0; i < merged.length; i += FILE) files.push(this.makeFile(merged.slice(i, i + FILE)));
    remove(level, inputs);
    remove(out, below);
    this.levels[out] = [...this.levels[out], ...files].sort((x, y) => lo(x) - lo(y));
    this.counters.compactUnits += merged.length;
    this.counters.compactions += 1;
    this.events.push({ kind: "merge", from: level, to: out, read, written: merged.length });
  }

  get writtenUnits(): number {
    return this.counters.logUnits + this.counters.flushUnits + this.counters.compactUnits;
  }

  /** Units in SSTables, plus the log that holds the memtable's records. */
  get storedUnits(): number {
    let s = this.memtable.size;
    for (const lv of this.levels) for (const f of lv) s += f.entries.length;
    return s;
  }

  /** Newest sequence number for key, or undefined. */
  get(key: number): number | undefined {
    return this.lookup(key).seq;
  }

  /**
   * A point lookup: the memtable, then each L0 file newest first, then the one
   * file per level whose range covers the key. A file is read only if its
   * Bloom filter reports the key as possibly present.
   */
  lookup(key: number): { seq?: number; probes: { level: number; file: SSTable; bloom: boolean; read: boolean; found: boolean }[]; memtable: boolean } {
    const probes: { level: number; file: SSTable; bloom: boolean; read: boolean; found: boolean }[] = [];
    if (this.memtable.has(key)) return { seq: this.memtable.get(key), probes, memtable: true };
    for (let l = 0; l < LEVELS; l++) {
      const files = l === 0 ? this.levels[0] : this.levels[l].filter((f) => lo(f) <= key && key <= hi(f));
      for (const file of files) {
        if (key < lo(file) || key > hi(file)) continue;
        const bloom = file.bloom.mayContain(key);
        const e = bloom ? file.entries.find((x) => x.key === key) : undefined;
        probes.push({ level: l, file, bloom, read: bloom, found: !!e });
        if (e) return { seq: e.seq, probes, memtable: false };
      }
    }
    return { probes, memtable: false };
  }
}

// ---- workloads and the paired run ----------------------------------------------------

export type Workload = "random" | "sequential" | "updates";
export const WORKLOADS: Record<Workload, string> = {
  random: "insert 64 keys in random order",
  sequential: "insert 64 keys in ascending order",
  updates: "insert 64 keys, then overwrite 128 at random",
};

/** The stream of keys written, deterministic for a seed. */
export function stream(workload: Workload, seed: number): number[] {
  const rand = mulberry(seed);
  const ids = Array.from({ length: KEYS }, (_, i) => i);
  if (workload === "sequential") return ids.map(keyOf);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const out = ids.map(keyOf);
  if (workload === "updates") for (let i = 0; i < 2 * KEYS; i++) out.push(keyOf(Math.floor(rand() * KEYS)));
  return out;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Snapshot {
  ops: number; // writes applied
  btreeWritten: number;
  lsmWritten: number;
}

/** Both engines fed the same stream, one commit of `batch` writes per step. */
export class Run {
  btree = new BTree();
  lsm = new Lsm();
  keys: number[];
  pos = 0;
  history: Snapshot[] = [{ ops: 0, btreeWritten: 0, lsmWritten: 0 }];
  live = new Set<number>();
  lastKeys: number[] = [];
  constructor(
    public workload: Workload,
    public batch: number,
    public seed = 1,
  ) {
    this.keys = stream(workload, seed);
  }
  get done(): boolean {
    return this.pos >= this.keys.length;
  }
  step(): void {
    if (this.done) return;
    const end = Math.min(this.keys.length, this.pos + this.batch);
    this.lsm.beginCommit();
    this.lastKeys = this.keys.slice(this.pos, end);
    for (const k of this.lastKeys) {
      this.btree.put(k);
      this.lsm.put(k);
      this.live.add(k);
    }
    this.btree.commit();
    this.lsm.commit();
    this.pos = end;
    this.history.push({ ops: this.pos, btreeWritten: this.btree.writtenUnits, lsmWritten: this.lsm.writtenUnits });
  }
  runTo(ops: number): void {
    while (!this.done && this.pos < ops) this.step();
  }
  /** Bytes written per byte of user data, so far. */
  writeAmp(engine: "btree" | "lsm"): number {
    if (this.pos === 0) return 0;
    return (engine === "btree" ? this.btree.writtenUnits : this.lsm.writtenUnits) / this.pos;
  }
  /** Stored units per live record. The LSM's memtable records are live but not yet stored. */
  spaceAmp(engine: "btree" | "lsm"): number {
    if (this.live.size === 0) return 0;
    return (engine === "btree" ? this.btree.storedUnits : this.lsm.storedUnits) / this.live.size;
  }
}
