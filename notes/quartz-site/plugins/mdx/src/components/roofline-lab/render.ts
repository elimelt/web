// Markup for the roofline figure. The build draws the finished chart and readout
// from the preset's starting choice; the client redraws both from the same
// functions when the reader picks a memory level or moves the batch slider.

import { esc, num } from "../../shared/format";
import {
  CPU,
  GEMM_K,
  GEMM_M,
  H100,
  H100_M,
  ISA_LABEL,
  LEVELS,
  LLAMA,
  decodeAttentionIntensity,
  gemmIntensity,
  gemmPoint,
  nearRidge,
  presetById,
  ridge,
  roof,
  type Isa,
  type Level,
  type Point,
  type Preset,
} from "./model";

export const W = 640;
export const H = 330;
const M = { left: 58, right: 16, top: 14, bottom: 46 };

interface Axes {
  x0: number; // log10 bounds
  x1: number;
  y0: number;
  y1: number;
  unit: string;
  scale: number; // GFLOP/s per displayed unit
}

const AXES: Record<"cpu" | "h100", Axes> = {
  cpu: { x0: Math.log10(1 / 8), x1: Math.log10(1024), y0: Math.log10(4), y1: Math.log10(3000), unit: "GFLOP/s", scale: 1 },
  h100: { x0: Math.log10(1 / 4), x1: Math.log10(8192), y0: Math.log10(300), y1: Math.log10(3e6), unit: "TFLOP/s", scale: 1e3 },
};

const plotW = W - M.left - M.right;
const plotH = H - M.top - M.bottom;
const sx = (a: Axes, i: number) => M.left + ((Math.log10(i) - a.x0) / (a.x1 - a.x0)) * plotW;
const sy = (a: Axes, g: number) => M.top + (1 - (Math.log10(Math.max(g, 1e-9)) - a.y0) / (a.y1 - a.y0)) * plotH;
const f1 = (v: number) => v.toFixed(1);

/** Intensity tick label: fractions below 1, integers above. */
export const intensityLabel = (i: number): string => (i >= 1 ? String(Math.round(i)) : `1/${Math.round(1 / i)}`);

/** A rate in the axis unit, with sensible precision. */
export function rate(gflops: number, a: Axes = AXES.cpu): string {
  const v = gflops / a.scale;
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

function frame(a: Axes): string[] {
  const out: string[] = [];
  for (let e = Math.ceil(a.y0); e <= Math.floor(a.y1); e++) {
    const y = f1(sy(a, 10 ** e));
    out.push(`<line class="rl-grid" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`);
    out.push(`<text class="rl-tick" x="${M.left - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${(10 ** e / a.scale).toLocaleString("en-US")}</text>`);
  }
  for (let e = Math.ceil(a.x0 / Math.log10(4)); e * Math.log10(4) <= a.x1 + 1e-9; e++) {
    const i = 4 ** e;
    const x = f1(sx(a, i));
    out.push(`<line class="rl-grid" x1="${x}" x2="${x}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    out.push(`<text class="rl-tick" x="${x}" y="${H - M.bottom + 17}" text-anchor="middle">${intensityLabel(i)}</text>`);
  }
  out.push(`<text class="rl-axis" x="${(M.left + W - M.right) / 2}" y="${H - 6}" text-anchor="middle">operational intensity (FLOP/byte)</text>`);
  const ym = (M.top + H - M.bottom) / 2;
  out.push(`<text class="rl-axis" x="13" y="${ym}" text-anchor="middle" transform="rotate(-90 13 ${ym})">${a.unit}</text>`);
  return out;
}

/** The roofline min(peak, bw·i) across the whole x range, as one path. */
function roofPath(a: Axes, peak: number, bw: number, cls: string): string {
  const i0 = 10 ** a.x0;
  const i1 = 10 ** a.x1;
  const r = Math.min(Math.max(ridge(peak, bw), i0), i1);
  const pts = [
    [i0, roof(i0, peak, bw)],
    [r, roof(r, peak, bw)],
    [i1, roof(i1, peak, bw)],
  ];
  const d = pts.map(([i, g], k) => `${k ? "L" : "M"}${f1(sx(a, i))} ${f1(sy(a, g))}`).join("");
  return `<path class="${cls}" d="${d}"/>`;
}

/** A label along a bandwidth diagonal, placed at intensity `at` and rotated to the line's slope. */
function diagLabel(a: Axes, bw: number, at: number, text: string, cls: string): string {
  const x = sx(a, at);
  const y = sy(a, bw * at);
  const ang = (Math.atan2(sy(a, bw * at * 4) - y, sx(a, at * 4) - x) * 180) / Math.PI;
  return `<text class="${cls}" x="${f1(x)}" y="${f1(y - 5)}" transform="rotate(${ang.toFixed(1)} ${f1(x)} ${f1(y)})">${esc(text)}</text>`;
}

function flatLabel(a: Axes, g: number, text: string, cls: string): string {
  return `<text class="${cls}" x="${W - M.right - 4}" y="${f1(sy(a, g) - 5)}" text-anchor="end">${esc(text)}</text>`;
}

function dots(a: Axes, pts: Point[], cls: string, selected?: (p: Point) => boolean): string {
  const out = [`<g class="${cls}">`];
  for (const p of pts) {
    const x = f1(sx(a, p.intensity));
    out.push(`<line class="rl-whisker" x1="${x}" x2="${x}" y1="${f1(sy(a, p.min))}" y2="${f1(sy(a, p.max))}"/>`);
    out.push(`<circle cx="${x}" cy="${f1(sy(a, p.median))}" r="${selected?.(p) ? 5.5 : 3.4}"${selected?.(p) ? ' class="rl-sel"' : ""}/>`);
  }
  out.push(`</g>`);
  return out.join("");
}

// ---------- levels ----------

export function levelsChart(level: Level): string {
  const a = AXES.cpu;
  const peak = CPU.peaks.avx512.median;
  const out = frame(a);
  for (const isa of ["avx2", "scalar"] as Isa[]) {
    const g = CPU.peaks[isa].median;
    out.push(`<line class="rl-ceil" x1="${M.left}" x2="${W - M.right}" y1="${f1(sy(a, g))}" y2="${f1(sy(a, g))}"/>`);
    out.push(flatLabel(a, g, `${ISA_LABEL[isa]} ${rate(g)}`, "rl-label"));
  }
  for (const lv of LEVELS) {
    if (lv !== level) out.push(roofPath(a, peak, CPU.bandwidth[lv], "rl-roof rl-faint"));
  }
  out.push(roofPath(a, peak, CPU.bandwidth[level], "rl-roof"));
  out.push(flatLabel(a, peak, `${ISA_LABEL.avx512} ${rate(peak)}`, "rl-label rl-strong"));
  out.push(diagLabel(a, CPU.bandwidth[level], 1 / 6, `${level} ${rate(CPU.bandwidth[level])} GB/s`, "rl-label rl-strong"));
  const near = nearRidge(level);
  out.push(dots(a, CPU.sweep[level], "rl-series rl-blue", (p) => p === near));
  return `<svg viewBox="0 0 ${W} ${H}" class="rl-chart" role="img" aria-label="${esc(`Measured roofline for ${level}. ${levelsText(level).replace(/<[^>]+>/g, "")}`)}">${out.join("")}</svg>`;
}

export function levelsText(level: Level): string {
  const peak = CPU.peaks.avx512.median;
  const bw = CPU.bandwidth[level];
  const r = ridge(peak, bw);
  const p = nearRidge(level);
  const frac = p.median / roof(p.intensity, peak, bw);
  return `${level}: the kernel reached <strong>${rate(bw)} GB/s</strong>, so the ridge sits at ${num(r, 1)} FLOP/byte. Nearest the ridge, at ${intensityLabel(p.intensity)} FLOP/byte, it ran at ${rate(p.median)} GFLOP/s, <strong>${Math.round(frac * 100)}%</strong> of the roof.`;
}

// ---------- gemm ----------

export function gemmChart(m: number): string {
  const a = AXES.cpu;
  const peak = CPU.peaks.avx512.median;
  const bw = CPU.read.DRAM;
  const out = frame(a);
  const i = gemmIntensity(m, GEMM_K, GEMM_K, 4);
  out.push(`<line class="rl-cursor" x1="${f1(sx(a, i))}" x2="${f1(sx(a, i))}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  out.push(roofPath(a, peak, bw, "rl-roof"));
  out.push(flatLabel(a, peak, `${ISA_LABEL.avx512} ${rate(peak)}`, "rl-label rl-strong"));
  out.push(diagLabel(a, bw, 1 / 6, `DRAM reads ${rate(bw)} GB/s`, "rl-label rl-strong"));
  out.push(dots(a, CPU.gemm.openblas, "rl-series rl-blue", (p) => p.M === m));
  out.push(dots(a, CPU.gemm.skinny, "rl-series rl-orange", (p) => p.M === m));
  return `<svg viewBox="0 0 ${W} ${H}" class="rl-chart" role="img" aria-label="${esc(`Measured GEMM throughput against the DRAM roofline. ${gemmText(m).replace(/<[^>]+>/g, "")}`)}">${out.join("")}</svg>`;
}

export function gemmText(m: number): string {
  const peak = CPU.peaks.avx512.median;
  const bw = CPU.read.DRAM;
  const i = gemmIntensity(m, GEMM_K, GEMM_K, 4);
  const bound = roof(i, peak, bw);
  const regime = i < ridge(peak, bw) ? "memory bound" : "compute bound";
  const pct = (p: Point | undefined) => (p ? `${rate(p.median)} GFLOP/s (${Math.round((p.median / bound) * 100)}%)` : "not run");
  return `M = <strong>${m}</strong>: intensity ${num(i, i < 10 ? 2 : 0)} FLOP/byte, ${regime}, roof <strong>${rate(bound)}</strong> GFLOP/s. OpenBLAS ${pct(gemmPoint("openblas", m))}; skinny.c ${pct(gemmPoint("skinny", m))}.`;
}

// ---------- h100 ----------

export function h100Chart(m: number): string {
  const a = AXES.h100;
  const out = frame(a);
  const i = gemmIntensity(m, LLAMA.d, LLAMA.d, 2);
  const att = decodeAttentionIntensity(LLAMA.group, 2);
  out.push(roofPath(a, H100.peak, H100.bw, "rl-roof"));
  out.push(flatLabel(a, H100.peak, `BF16 tensor ${rate(H100.peak, a)} TFLOP/s`, "rl-label rl-strong"));
  out.push(diagLabel(a, H100.bw, 1, `HBM3 ${num(H100.bw / 1e3, 2)} TB/s`, "rl-label rl-strong"));
  const ax = f1(sx(a, att));
  const ay = f1(sy(a, roof(att, H100.peak, H100.bw)));
  out.push(`<g class="rl-series rl-orange"><rect x="${(+ax - 4).toFixed(1)}" y="${(+ay - 4).toFixed(1)}" width="8" height="8"/></g>`);
  out.push(`<text class="rl-label" x="${(+ax + 8).toFixed(1)}" y="${(+ay + 16).toFixed(1)}">decode attention</text>`);
  out.push(`<line class="rl-cursor" x1="${f1(sx(a, i))}" x2="${f1(sx(a, i))}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  out.push(`<g class="rl-series rl-blue"><circle class="rl-sel" cx="${f1(sx(a, i))}" cy="${f1(sy(a, roof(i, H100.peak, H100.bw)))}" r="5.5"/></g>`);
  return `<svg viewBox="0 0 ${W} ${H}" class="rl-chart" role="img" aria-label="${esc(`H100 roofline model. ${h100Text(m).replace(/<[^>]+>/g, "")}`)}">${out.join("")}</svg>`;
}

export function h100Text(m: number): string {
  const i = gemmIntensity(m, LLAMA.d, LLAMA.d, 2);
  const bound = roof(i, H100.peak, H100.bw);
  const regime = i < ridge(H100.peak, H100.bw) ? "memory bound" : "compute bound";
  const us = ((2 * m * LLAMA.d * LLAMA.d) / (bound * 1e9)) * 1e6;
  return `M = <strong>${m}</strong>: intensity ${num(i, i < 10 ? 2 : 0)} FLOP/byte, ${regime}, at most <strong>${rate(bound, AXES.h100)}</strong> TFLOP/s (${num((bound / H100.peak) * 100, bound / H100.peak < 0.1 ? 1 : 0)}% of peak), so the projection takes at least ${num(us, us < 10 ? 1 : 0)} µs. Decode attention stays at ${decodeAttentionIntensity(LLAMA.group, 2)} FLOP/byte for any batch.`;
}

// ---------- figure ----------

export interface Props {
  preset?: unknown;
}

export const START: Record<string, number | Level> = { levels: "DRAM", gemm: 16, h100: 64 };

function legend(p: Preset): string {
  if (p.id === "gemm")
    return `<div class="rl-legend" aria-hidden="true"><span class="rl-key rl-key-blue">● OpenBLAS</span><span class="rl-key rl-key-orange">● skinny.c</span><span class="rl-key">— roof</span></div>`;
  if (p.id === "h100")
    return `<div class="rl-legend" aria-hidden="true"><span class="rl-key rl-key-blue">● projection GEMM</span><span class="rl-key rl-key-orange">■ decode attention</span><span class="rl-key">— roof (model)</span></div>`;
  return `<div class="rl-legend" aria-hidden="true"><span class="rl-key rl-key-blue">● measured</span><span class="rl-key">— chosen level</span><span class="rl-key rl-key-faint">— other levels</span><span class="rl-key">- - lower compute ceilings</span></div>`;
}

export function render(props: Props = {}): string {
  const p = presetById(props.preset);
  let controls: string;
  let chart: string;
  let text: string;
  if (p.id === "levels") {
    const lv = START.levels as Level;
    controls = `<div class="rl-buttons" role="group" aria-label="working set">${LEVELS.map((l) => `<button type="button" name="level-${l}" data-level="${l}" aria-pressed="${l === lv}" disabled>${l}</button>`).join("")}</div>`;
    chart = levelsChart(lv);
    text = levelsText(lv);
  } else {
    const ms = p.id === "gemm" ? GEMM_M : H100_M;
    const m = START[p.id] as number;
    controls = `<label class="rl-slider"><span>batch rows M <output name="m-out">${m}</output></span><input type="range" name="m" min="0" max="${ms.length - 1}" step="1" value="${ms.indexOf(m)}" aria-label="number of rows M, in powers of two" disabled></label>`;
    chart = p.id === "gemm" ? gemmChart(m) : h100Chart(m);
    text = p.id === "gemm" ? gemmText(m) : h100Text(m);
  }
  return `<figure class="rl" data-preset="${p.id}">
${controls}
${legend(p)}
<div class="rl-plot" data-part="chart">${chart}</div>
<p class="rl-readout" data-part="readout" aria-live="polite">${text}</p>
<figcaption>${esc(p.caption)}</figcaption>
</figure>`;
}
