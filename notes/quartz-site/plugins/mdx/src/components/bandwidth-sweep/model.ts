// Measured bandwidth of five STREAM-style kernels against working-set size,
// with 1 to 4 threads, in a 4-vCPU KVM guest on an Intel Xeon reporting
// family 6, model 207 (Emerald Rapids). Nothing here is simulated: every point
// is the median of 5 processes (each the median of 7 timed samples), and the
// derived quantities are arithmetic on those medians.
//
//   capacity   where each cache level ends for a team of t threads: L1 and
//              L2 are private, so t threads hold t times one core's share;
//              L3 is shared, so its capacity does not grow with t
//   plateau    the median bandwidth over the sizes well inside one level
//   bus bytes  a normal store to a line that is not in cache first reads the
//              line (write-allocate), which STREAM does not count; copy then
//              moves 3 lines for every 2 it counts, triad 4 for every 3

import { DATA, type Point } from "./data";

export { DATA };
export type { Point };

export const KiB = 1024;
export const MiB = 1024 * KiB;
export const GiB = 1024 * MiB;

/** Per-core L1D and L2, and the shared L3, as the guest reports them. */
export const L1 = 48 * KiB;
export const L2 = 2 * MiB;
export const L3 = 260 * MiB;
/** The smallest working set counted as DRAM-resident: about 4 x L3. */
export const DRAM_MIN = 1 * GiB;

export const KERNELS = ["read", "copy", "triad", "copy-nt", "triad-nt"] as const;
export type Kernel = (typeof KERNELS)[number];
export const THREADS = [1, 2, 3, 4] as const;
export type Level = "L1" | "L2" | "L3" | "DRAM";
export const LEVELS: Level[] = ["L1", "L2", "L3", "DRAM"];

/** Bytes on the bus per byte STREAM counts. */
export function busFactor(k: Kernel): number {
  if (k === "copy") return 3 / 2;
  if (k === "triad") return 4 / 3;
  return 1;
}

/** Normal (cached) stores pay for write-allocate; read has no stores and -nt bypasses it. */
export const allocates = (k: Kernel): boolean => k === "copy" || k === "triad";

/** The last byte of each level for a team of t threads. */
export function capacities(t: number): { level: Level; bytes: number }[] {
  return [
    { level: "L1", bytes: t * L1 },
    { level: "L2", bytes: t * L2 },
    { level: "L3", bytes: L3 },
  ];
}

/**
 * The level a working set sits in, or null in a transition. Bounds stay well
 * inside each level: up to two thirds of the team's L1, between one sixteenth
 * and one half of its L2, from twice its L2 to half the L3, and from 1 GiB.
 */
export function level(t: number, ws: number): Level | null {
  if (ws <= (t * L1 * 2) / 3) return "L1";
  if (ws >= (t * L2) / 16 && ws <= (t * L2) / 2) return "L2";
  if (ws >= 2 * t * L2 && ws <= L3 / 2) return "L3";
  if (ws >= DRAM_MIN) return "DRAM";
  return null;
}

export function series(k: Kernel, t: number): Point[] {
  const s = DATA.series[`${k}/${t}`];
  if (!s) throw new Error(`no data for ${k} with ${t} threads`);
  return s;
}

function median(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Median of the per-size medians inside one level, counted or as bus bytes. */
export function plateau(k: Kernel, t: number, lv: Level, bus = false): number {
  const vals = series(k, t)
    .filter((p) => level(t, p[0]) === lv)
    .map((p) => p[1] * (bus ? busFactor(k) : 1));
  if (!vals.length) throw new Error(`no ${lv} sizes for ${k}/${t}`);
  return median(vals);
}

export interface Preset {
  kernels: Kernel[];
  threads: number;
  bus: boolean;
}

export function preset(props: { kernels?: unknown; threads?: unknown; bus?: unknown }): Preset {
  const kernels = String(props.kernels ?? "read")
    .split(",")
    .map((s) => s.trim())
    .filter((k, i, a): k is Kernel => (KERNELS as readonly string[]).includes(k) && a.indexOf(k) === i);
  const t = Number(props.threads);
  return {
    kernels: kernels.length ? kernels : ["read"],
    threads: (THREADS as readonly number[]).includes(t) ? t : 1,
    bus: String(props.bus) === "true",
  };
}

/** One kernel: one series per thread count. Several: one per kernel at the chosen count. */
export const byThreads = (p: Preset): boolean => p.kernels.length === 1;

/** Bytes per cache line. */
export const LINE = 64;
/**
 * Single-chain DRAM latency of a pointer chase with 2 MB pages, measured on
 * the same VM right after the sweep: the median of 15 runs of mlp_bench.c
 * (bandwidth_bench-latency.txt beside the note).
 */
export const LATENCY_NS = 163.2;
