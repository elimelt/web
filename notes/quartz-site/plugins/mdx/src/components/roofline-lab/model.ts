// The roofline bound and the recorded measurements it is drawn against. The CPU
// numbers are medians of real runs of roofline.c, gemm_batch.py and skinny.c
// (see the note's "How this was measured"), summarized by summarize.py. The
// H100 preset is the model alone, from NVIDIA's datasheet numbers; nothing
// about it was measured here.

import summaryJson from "../../../../../../content/ml/serving-systems/performance-modeling/roofline-summary.json";

export interface Point {
  intensity: number;
  median: number;
  min: number;
  max: number;
  M?: number;
  fma?: number;
}

export type Level = "L1" | "L2" | "L3" | "DRAM";
export type Isa = "avx512" | "avx2" | "scalar";

interface ThreadSummary {
  peaks: Record<Isa, { median: number; min: number; max: number }>;
  bandwidth: Record<Level, number>;
  read: Record<Level, number>;
  sweep: Record<Level, Point[]>;
  gemm: Record<"openblas" | "skinny" | "openblas_l3" | "skinny_l3", Point[]>;
}

export const SUMMARY = (summaryJson as { threads: Record<string, ThreadSummary> }).threads;
/** The figure shows the whole four-core VM. */
export const CPU = SUMMARY["4"];
export const LEVELS: Level[] = ["L1", "L2", "L3", "DRAM"];
export const ISA_LABEL: Record<Isa, string> = { avx512: "AVX-512 FMA", avx2: "AVX2 FMA", scalar: "scalar FMA" };

/** Attainable FLOP/s at operational intensity `i` (FLOP/byte) under one compute and one bandwidth ceiling. */
export const roof = (i: number, peak: number, bw: number): number => Math.min(peak, bw * i);

/** Intensity at which the bandwidth line meets the compute ceiling. */
export const ridge = (peak: number, bw: number): number => peak / bw;

/** Minimum-traffic intensity of C[M,N] = A[M,K] B[K,N] with `bytes`-byte elements: every operand moved once. */
export const gemmIntensity = (M: number, K: number, N: number, bytes: number): number =>
  (2 * M * K * N) / (bytes * (M * K + K * N + M * N));

/** Decode attention of one query token: 4·c·d_head·h_q FLOPs over 2·c·d_head·h_kv·S bytes of K and V. */
export const decodeAttentionIntensity = (groupSize: number, bytes: number): number => (2 * groupSize) / bytes;

/** H100 SXM, dense BF16 tensor throughput and HBM3 bandwidth from NVIDIA's datasheet, in GFLOP/s and GB/s. */
export const H100 = { peak: 989e3, bw: 3350 };
/** Llama 2 70B: hidden size 8192, eight query heads per KV head. */
export const LLAMA = { d: 8192, group: 8 };

/** The weight matrix in the GEMM measurements is 16384 × 16384 FP32 (1 GiB), so it streams from DRAM. */
export const GEMM_K = 16384;
export const GEMM_M = CPU.gemm.openblas.map((p) => p.M as number);
export const H100_M = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

export type PresetId = "levels" | "gemm" | "h100";
export interface Preset {
  id: PresetId;
  caption: string;
}

export const PRESETS: Record<PresetId, Preset> = {
  levels: {
    id: "levels",
    caption:
      "Measured on a four-core KVM guest (Intel Xeon, AVX-512). Each point is one run of the same kernel (load a float, apply K dependent FMAs, store it) on a working set that fits the chosen level, so intensity is K/4 FLOP per byte read or written. Points are medians of 7 runs; whiskers span the slowest and fastest run. The diagonal for each level is the highest bandwidth the kernel reached there. Log scales.",
  },
  gemm: {
    id: "gemm",
    caption:
      "Measured: Y = X W with W a 16384 × 16384 FP32 matrix (1 GiB, so it comes from DRAM) and X holding M rows, on the same four cores. Blue is OpenBLAS 0.3.34 through NumPy; orange is skinny.c, a short kernel written for M ≤ 64. Intensity counts each operand moved once. The roof uses the measured read-only DRAM bandwidth, since nearly all the traffic is reads of W. Medians of 7 runs.",
  },
  h100: {
    id: "h100",
    caption:
      "Model, not measurement: the roofline bound on an H100 SXM (989 dense BF16 TFLOP/s, 3.35 TB/s) for one BF16 projection of Llama 2 70B, [M, 8192] × [8192, 8192], and for decode attention with eight query heads per KV head. Real kernels land below the line.",
  },
};

export const presetById = (v: unknown): Preset =>
  typeof v === "string" && v in PRESETS ? PRESETS[v as PresetId] : PRESETS.levels;

/** The sweep point closest to a level's ridge, the region where the roofline is least accurate. */
export function nearRidge(level: Level): Point {
  const r = ridge(CPU.peaks.avx512.median, CPU.bandwidth[level]);
  return CPU.sweep[level].reduce((a, b) => (Math.abs(Math.log(b.intensity / r)) < Math.abs(Math.log(a.intensity / r)) ? b : a));
}

export const gemmPoint = (series: "openblas" | "skinny", M: number): Point | undefined =>
  CPU.gemm[series].find((p) => p.M === M);
