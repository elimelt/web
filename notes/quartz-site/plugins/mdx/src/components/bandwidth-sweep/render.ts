// Markup for the bandwidth sweep figure. The build draws the chart and the
// readout for the preset; the client redraws both from the same functions
// when the thread count or the write-allocate box changes.

import { esc } from "../../shared/format";
import {
  allocates,
  busFactor,
  byThreads,
  capacities,
  DRAM_MIN,
  GiB,
  KiB,
  LATENCY_NS,
  LEVELS,
  LINE,
  MiB,
  plateau,
  preset,
  series,
  THREADS,
  type Kernel,
  type Preset,
} from "./model";

export interface Props {
  kernels?: unknown;
  threads?: unknown;
  bus?: unknown;
}

export const W = 640;
export const H = 280;
const M = { left: 50, right: 12, top: 22, bottom: 38 };
const X_LO = 14; // log2(16 KiB)
const X_HI = 32; // log2(4 GiB)
const f = (x: number): string => x.toFixed(1);
const gbs = (x: number): string => (x >= 100 ? x.toFixed(0) : x.toFixed(1));

export const xPos = (bytes: number): number => M.left + ((Math.log2(bytes) - X_LO) / (X_HI - X_LO)) * (W - M.left - M.right);

export function sizeLabel(bytes: number): string {
  if (bytes >= GiB) return `${+(bytes / GiB).toFixed(2)} GiB`;
  if (bytes >= MiB) return `${+(bytes / MiB).toFixed(2)} MiB`;
  return `${+(bytes / KiB).toFixed(2)} KiB`;
}

const KERNEL_LABEL: Record<Kernel, string> = {
  read: "read",
  copy: "copy",
  triad: "triad",
  "copy-nt": "copy, streaming stores",
  "triad-nt": "triad, streaming stores",
};

/** The y range covers every series the preset can show, so the axis never moves. */
export function yRange(p: Preset): [number, number] {
  const vals: number[] = [];
  const ts = byThreads(p) ? [...THREADS] : [...THREADS];
  for (const k of p.kernels) {
    for (const t of ts) {
      for (const pt of series(k, t)) {
        vals.push(pt[2], pt[3]);
        if (allocates(k) && !byThreads(p)) vals.push(pt[3] * busFactor(k));
      }
    }
  }
  return [Math.min(...vals) * 0.85, Math.max(...vals) * 1.12];
}

const Y_TICKS = [5, 10, 20, 50, 100, 200, 500, 1000, 2000];
const X_TICKS = [16 * KiB, 256 * KiB, 4 * MiB, 64 * MiB, 1 * GiB, 4 * GiB];

interface Line {
  cls: string;
  k: Kernel;
  t: number;
  scale: number;
  primary: boolean;
}

function lines(p: Preset, t: number, bus: boolean): Line[] {
  if (byThreads(p)) {
    const k = p.kernels[0];
    // Unselected thread counts first, so the selected one is drawn on top.
    return [...THREADS]
      .sort((a, b) => (a === t ? 1 : 0) - (b === t ? 1 : 0))
      .map((tt) => ({ cls: `bw-t${tt}`, k, t: tt, scale: 1, primary: tt === t }));
  }
  return p.kernels.map((k) => ({ cls: `bw-k-${k}`, k, t, scale: bus && allocates(k) ? busFactor(k) : 1, primary: true }));
}

export function chartSvg(p: Preset, t: number, bus: boolean): string {
  const [lo, hi] = yRange(p);
  const plotH = H - M.top - M.bottom;
  const y = (v: number) => M.top + (1 - (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * plotH;
  const what = byThreads(p) ? `${p.kernels[0]} with 1 to 4 threads` : `${p.kernels.join(", ")} with ${t} thread${t > 1 ? "s" : ""}`;
  const label = `Bandwidth in GB/s against working-set size, ${what}${bus ? ", counting write-allocate reads" : ""}`;
  const out: string[] = [`<svg viewBox="0 0 ${W} ${H}" class="bw-chart" role="img" aria-label="${esc(label)}">`];
  for (const v of Y_TICKS) {
    if (v < lo || v > hi) continue;
    const yy = f(y(v));
    out.push(`<line class="bw-grid" x1="${M.left}" x2="${W - M.right}" y1="${yy}" y2="${yy}"/>`);
    // On a phone the 2x labels, and one sitting on the x axis labels, are
    // dropped so the rest do not overlap.
    const minor = String(v)[0] === "2" || y(v) > M.top + plotH - 12 ? " bw-minor" : "";
    out.push(`<text class="bw-tick${minor}" x="${M.left - 6}" y="${f(y(v) + 4)}" text-anchor="end">${v}</text>`);
  }
  for (const b of X_TICKS) {
    const minor = b === 256 * KiB || b === 64 * MiB ? " bw-minor" : "";
    out.push(`<text class="bw-tick${minor}" x="${f(xPos(b))}" y="${H - M.bottom + 17}" text-anchor="middle">${sizeLabel(b)}</text>`);
  }
  out.push(`<text class="bw-axis" x="${M.left + (W - M.left - M.right) / 2}" y="${H - 3}" text-anchor="middle">working set (all arrays together)</text>`);
  const ym = M.top + plotH / 2;
  out.push(`<text class="bw-axis" x="12" y="${f(ym)}" text-anchor="middle" transform="rotate(-90 12 ${f(ym)})">GB/s</text>`);

  // Where each level ends for this team, and where DRAM-resident sizes begin.
  for (const c of capacities(t)) {
    const xx = f(xPos(c.bytes));
    const name = c.level === "L3" ? "L3" : t > 1 ? `${t}×${c.level}` : c.level;
    out.push(`<line class="bw-cap" x1="${xx}" x2="${xx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    out.push(`<text class="bw-note" x="${xx}" y="${M.top - 6}" text-anchor="middle">${name}</text>`);
  }
  const xd = xPos(DRAM_MIN);
  out.push(`<rect class="bw-dram" x="${f(xd)}" y="${M.top}" width="${f(W - M.right - xd)}" height="${plotH}"/>`);
  out.push(`<text class="bw-note" x="${f((xd + W - M.right) / 2)}" y="${M.top - 6}" text-anchor="middle">DRAM</text>`);

  for (const ln of lines(p, t, bus)) {
    const pts = series(ln.k, ln.t);
    out.push(`<g class="bw-series ${ln.cls}${ln.primary ? "" : " bw-dim"}">`);
    if (ln.primary) {
      for (const pt of pts) {
        out.push(`<line class="bw-range" x1="${f(xPos(pt[0]))}" x2="${f(xPos(pt[0]))}" y1="${f(y(pt[2] * ln.scale))}" y2="${f(y(pt[3] * ln.scale))}"/>`);
      }
    }
    out.push(`<polyline points="${pts.map((pt) => `${f(xPos(pt[0]))},${f(y(pt[1] * ln.scale))}`).join(" ")}"/>`);
    out.push(`</g>`);
  }
  out.push(`</svg>`);
  return out.join("");
}

export function readoutHtml(p: Preset, t: number, bus: boolean): string {
  const parts: string[] = [];
  const s = t > 1 ? "s" : "";
  if (byThreads(p)) {
    const k = p.kernels[0];
    const levels = LEVELS.map((lv) => `${lv} <b>${gbs(plateau(k, t, lv))}</b>`).join(" · ");
    parts.push(`<span>${t} thread${s}, median inside each level: ${levels} GB/s</span>`);
    const d1 = plateau(k, 1, "DRAM");
    const dt = plateau(k, t, "DRAM");
    if (t > 1) parts.push(`<span>DRAM: <b>${gbs(dt)} GB/s</b>, ${(dt / d1).toFixed(2)}× one thread, ${gbs(dt / t)} GB/s per thread</span>`);
    const inflight = (dt / t) * LATENCY_NS / LINE;
    parts.push(`<span>Little's law per core: ${gbs(dt / t)} GB/s × ${LATENCY_NS.toFixed(0)} ns ÷ ${LINE} B ≥ <b>${inflight.toFixed(0)}</b> lines in flight</span>`);
  } else {
    for (const k of p.kernels) {
      const counted = plateau(k, t, "DRAM");
      const shown = bus && allocates(k) ? counted * busFactor(k) : counted;
      const note = allocates(k) ? (bus ? `, ${gbs(counted)} counted × ${busFactor(k) === 1.5 ? "3/2" : "4/3"}` : `, ${gbs(counted * busFactor(k))} with write-allocate`) : "";
      parts.push(`<span><i class="bw-key bw-k-${k}"></i>${esc(KERNEL_LABEL[k])}: DRAM <b>${gbs(shown)} GB/s</b>${note}</span>`);
    }
  }
  return parts.join("");
}

function keys(p: Preset): string {
  if (byThreads(p)) return THREADS.map((t) => `<span><i class="bw-key bw-t${t}"></i>${t} thread${t > 1 ? "s" : ""}</span>`).join("");
  return p.kernels.map((k) => `<span><i class="bw-key bw-k-${k}"></i>${esc(KERNEL_LABEL[k])}</span>`).join("");
}

export function render(props: Props = {}): string {
  const p = preset(props);
  const buttons = THREADS.map(
    (t) => `<button type="button" name="t${t}" value="${t}" aria-pressed="${t === p.threads}" disabled>${t}</button>`,
  ).join("");
  const allocating = !byThreads(p) && p.kernels.some(allocates);
  const box = allocating
    ? `<label class="bw-check"><input type="checkbox" name="bus"${p.bus ? " checked" : ""} disabled> Count write-allocate reads</label>`
    : "";
  const what = byThreads(p)
    ? `${p.kernels[0]} (sum of one array) with 1 to 4 threads; the bold line is the selected count, with each point's range over 5 runs`
    : `${p.kernels.join(", ")} at the selected thread count, each point with its range over 5 runs`;
  return `<figure class="bw" data-kernels="${p.kernels.join(",")}" data-threads="${p.threads}" data-bus="${p.bus}">
<div class="bw-controls"><span class="bw-label">Threads</span><span class="bw-group" role="group" aria-label="Threads">${buttons}</span>${box}</div>
<div class="bw-plot" data-part="chart">${chartSvg(p, p.threads, p.bus)}</div>
<p class="bw-keys">${keys(p)}<span><i class="bw-key bw-key-cap"></i>capacity of the team's caches</span></p>
<p class="bw-readout" data-part="readout" aria-live="polite">${readoutHtml(p, p.threads, p.bus)}</p>
<figcaption>Measured, not simulated: ${what}, in a 4-vCPU KVM guest on an Emerald Rapids Xeon (48 KiB L1D and 2 MiB L2 per core, 260 MiB shared L3). Bandwidth counts bytes as STREAM does, one read or write per array element. The cache lines mark t × 48 KiB, t × 2 MiB and the shared L3.</figcaption>
</figure>`;
}
