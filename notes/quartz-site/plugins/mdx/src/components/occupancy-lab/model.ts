// Occupancy and latency hiding on one H100 SM, free of the DOM.
//
// occupancy() applies the documented compute capability 9.0 limits (CUDA C++
// Programming Guide, compute capabilities table; Hopper tuning guide) with the
// allocation rules of NVIDIA's occupancy calculator (cuda_occupancy.h):
// registers go to a warp in units of 256 and from one of the SM's four
// sub-partitions, each holding a quarter of the register file; shared memory
// goes to a block in units of 128 bytes, after 1 KB reserved per block.
// The test checks it against that calculator on 6,188 launch configurations.
//
// littles() applies Little's law: to sustain bandwidth B with latency L, an SM
// must keep B/SMs * L bytes in flight. B is the H100 SXM datasheet figure and
// L the unloaded HBM latency that Manjunath and Ramachandra (2026) measured
// with a pointer chase on an H100 SXM5. Loaded latency is higher, so the
// requirement is a lower bound and the bandwidth it implies is an upper bound.

export const H100 = {
  sms: 132,
  warpSize: 32,
  maxWarps: 64,
  maxBlocks: 32,
  maxThreadsPerBlock: 1024,
  regsPerSm: 65536,
  subpartitions: 4,
  regUnit: 256,
  maxRegsPerThread: 255,
  smemPerSm: 228 * 1024,
  smemPerBlock: 227 * 1024,
  smemReserved: 1024,
  smemUnit: 128,
  bandwidth: 3.35e12, // bytes per second, H100 SXM datasheet
  latencyNs: 353, // unloaded HBM latency, pointer chase on H100 SXM5
} as const;

export type Limit = "threads" | "registers" | "shared" | "blocks";
export const LIMITS: Limit[] = ["threads", "registers", "shared", "blocks"];

export interface Launch {
  threads: number; // threads per block
  regs: number; // registers per thread
  smemKB: number; // dynamic shared memory per block, KB of 1024 bytes
  bytesPerThread: number; // bytes each thread has in flight (load width x independent loads)
}

export interface Occupancy {
  warpsPerBlock: number;
  /** Blocks per SM each resource alone would allow. */
  byLimit: Record<Limit, number>;
  blocks: number;
  warps: number;
  binding: Limit[];
  regsPerWarp: number; // allocated, after rounding
  smemPerBlock: number; // allocated bytes, after reservation and rounding
}

const ceilTo = (x: number, unit: number) => Math.ceil(x / unit) * unit;

export function occupancy(l: Launch): Occupancy {
  const g = H100;
  const warpsPerBlock = Math.ceil(l.threads / g.warpSize);
  const threads = l.threads > g.maxThreadsPerBlock ? 0 : Math.floor(g.maxWarps / warpsPerBlock);

  const regsPerWarp = ceilTo(l.regs * g.warpSize, g.regUnit);
  let registers: number;
  if (l.regs > g.maxRegsPerThread || regsPerWarp * ceilTo(warpsPerBlock, g.subpartitions) > g.regsPerSm) {
    registers = 0;
  } else {
    const perSub = Math.floor(g.regsPerSm / g.subpartitions / regsPerWarp);
    registers = Math.floor((perSub * g.subpartitions) / warpsPerBlock);
  }

  const smemBytes = Math.round(l.smemKB * 1024);
  const smemPerBlock = ceilTo(smemBytes + g.smemReserved, g.smemUnit);
  const shared = smemBytes > g.smemPerBlock ? 0 : Math.floor(g.smemPerSm / smemPerBlock);

  const byLimit: Record<Limit, number> = { threads, registers, shared, blocks: g.maxBlocks };
  const blocks = Math.min(threads, registers, shared, g.maxBlocks);
  const binding = LIMITS.filter((k) => byLimit[k] === blocks);
  return { warpsPerBlock, byLimit, blocks, warps: blocks * warpsPerBlock, binding, regsPerWarp, smemPerBlock };
}

export interface Littles {
  inFlight: number; // bytes in flight per SM
  required: number; // bytes per SM that Little's law requires at full bandwidth
  coverage: number; // inFlight / required
  bandwidthBound: number; // bytes per second for the whole GPU, at most the peak
}

export function littles(warps: number, bytesPerThread: number): Littles {
  const g = H100;
  const required = (g.bandwidth / g.sms) * g.latencyNs * 1e-9;
  const inFlight = warps * g.warpSize * bytesPerThread;
  const coverage = inFlight / required;
  return { inFlight, required, coverage, bandwidthBound: Math.min(1, coverage) * g.bandwidth };
}

export type PresetKey = "registers" | "shared" | "full" | "vector";

export const PRESETS: Record<PresetKey, Launch> = {
  registers: { threads: 256, regs: 255, smemKB: 0, bytesPerThread: 4 },
  shared: { threads: 256, regs: 32, smemKB: 100, bytesPerThread: 4 },
  full: { threads: 256, regs: 32, smemKB: 0, bytesPerThread: 4 },
  vector: { threads: 256, regs: 32, smemKB: 0, bytesPerThread: 16 },
};

export const presetKey = (v: unknown): PresetKey =>
  typeof v === "string" && v in PRESETS ? (v as PresetKey) : "full";

export const THREAD_CHOICES = [64, 128, 256, 512, 1024];
export const BYTE_CHOICES = [4, 8, 16, 32, 64];
