// Figure state: slider positions, presets, and their mapping to model
// parameters. Shared by the build-time render and the browser module.

import type { Params } from "./model";

export const RATES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]; // Mbit/s
export const RTTS = [1, 2, 5, 10, 20, 40, 60, 80, 100, 150, 200, 300]; // ms
export const BUFS = [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]; // KiB
export const READS = [10e3, 30e3, 100e3, 300e3, 1e6, 3e6, 10e6, 30e6, 100e6, Infinity]; // bytes/s
export const CHUNKS = [100, 200, 500, 1460, 4096, 16384, 65536]; // bytes
export const DURATIONS = [50, 100, 200, 500, 1000, 2000, 3000, 5000, 10000]; // ms

export interface State {
  rate: number; // indices into the arrays above
  rtt: number;
  buf: number;
  read: number;
  chunk: number;
  duration: number;
  pause: boolean;
  sws: boolean;
  loseUpdate: boolean;
  drops: number[];
}

export interface Preset {
  id: string;
  label: string;
  state: State;
  note: string;
}

const base: State = {
  rate: RATES.indexOf(100), rtt: RTTS.indexOf(40), buf: BUFS.indexOf(64), read: READS.length - 1,
  chunk: CHUNKS.indexOf(16384), duration: DURATIONS.indexOf(1000), pause: false, sws: true,
  loseUpdate: false, drops: [],
};

export const PRESETS: Preset[] = [
  { id: "small", label: "Window below BDP", state: { ...base },
    note: "A 64 KiB window on a path whose bandwidth-delay product is 500 KB. The sender empties its window in 5 ms, then waits 35 ms for ACKs." },
  { id: "full", label: "Window covers BDP", state: { ...base, buf: BUFS.indexOf(512) },
    note: "512 KiB covers the 500 KB bandwidth-delay product, so ACKs return before the window runs out and the link stays busy." },
  { id: "slow", label: "Slow reader", state: { ...base, buf: BUFS.indexOf(256), read: READS.indexOf(1e6), duration: DURATIONS.indexOf(2000) },
    note: "The application reads 1 MB/s. The buffer fills, and from then on the window opens only as fast as the application reads." },
  { id: "pause", label: "Reader pauses", state: { ...base, duration: DURATIONS.indexOf(3000), pause: true },
    note: "The application stops reading for the middle second. The window closes, the sender probes with growing gaps, and the receiver's window update restarts the flow." },
  { id: "lost-update", label: "Lost window update", state: { ...base, duration: DURATIONS.indexOf(5000), pause: true, loseUpdate: true },
    note: "Same pause, but the window update is lost. Nothing moves until the next probe, which here comes well after the reader resumed." },
  { id: "silly", label: "Silly window", state: { ...base, buf: BUFS.indexOf(8), read: READS.indexOf(10e3), chunk: CHUNKS.indexOf(200), duration: DURATIONS.indexOf(3000), sws: false },
    note: "An 8 KiB buffer drained 200 bytes at a time with silly window avoidance off. Every read opens a sliver of window and the sender fills it with a sliver of a segment." },
  { id: "loss", label: "Lost segment", state: { ...base, buf: BUFS.indexOf(512), duration: DURATIONS.indexOf(200), drops: [400] },
    note: "One segment is lost. Data behind the hole sits in the receiver's buffer unread, so the right edge stops moving until the retransmission fills the hole." },
];

export const presetById = (id: string | undefined): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export function toParams(s: State): Params {
  const durationMs = DURATIONS[s.duration];
  return {
    rateMbps: RATES[s.rate],
    rttMs: RTTS[s.rtt],
    bufBytes: BUFS[s.buf] * 1024,
    readBps: READS[s.read],
    readChunk: CHUNKS[s.chunk],
    stall: s.pause ? [durationMs / 3, (2 * durationMs) / 3] : null,
    sws: s.sws,
    loseFirstUpdate: s.loseUpdate,
    durationMs,
    drops: s.drops,
  };
}

// Number formatting used by labels and readouts.
export const fmtBytes = (b: number): string => {
  if (b >= 1024 * 1024) return `${+(b / (1024 * 1024)).toFixed(b >= 10 * 1024 * 1024 ? 0 : 1)} MiB`;
  if (b >= 1024) return `${+(b / 1024).toFixed(b >= 10 * 1024 ? 0 : 1)} KiB`;
  return `${Math.round(b)} B`;
};
export const fmtRate = (bps: number): string => {
  if (!Number.isFinite(bps)) return "as fast as data arrives";
  if (bps >= 1e6) return `${+(bps / 1e6).toFixed(1)} MB/s`;
  return `${+(bps / 1e3).toFixed(0)} kB/s`;
};
export const fmtMs = (ms: number): string => (ms >= 1000 ? `${+(ms / 1000).toFixed(2)} s` : `${+ms.toFixed(ms < 10 ? 2 : 1)} ms`);
export const fmtMbps = (m: number): string => (m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m >= 0.1 ? m.toFixed(2) : m.toFixed(3));
