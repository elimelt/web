// Markup for the router load figure, shared by the build (render.ts) and the
// browser (client.ts). Pure functions of Routes, Settings and a Result; the
// data are not imported here, so the browser bundle stays small.

import { num } from "../../shared/format";
import { BATCHES, type Result, type Routes, type Settings, type Traffic } from "./model";

export const TRAFFIC: [Traffic, string][] = [
  ["mixed", "All four"],
  ["prose", "Prose"],
  ["code", "Go code"],
  ["shakespeare", "Shakespeare"],
  ["math", "Math notes"],
];
export const MODELS: [string, string][] = [["e8", "8 experts"], ["e64", "64 experts"]];
export const LAYERS = [1, 7, 11];

const pct = (v: number) => (v <= 0 ? "0%" : v < 0.001 ? "<0.1%" : `${num(v * 100, v < 0.1 ? 1 : 0)}%`);

export function controls(model: string, layer: number, s: Settings): string {
  const b = (name: string, value: string, label: string, on: boolean) =>
    `<button type="button" name="${name}" value="${value}" aria-pressed="${on}" disabled>${label}</button>`;
  const group = (label: string, body: string) =>
    `<div class="rl-group" role="group" aria-label="${label}"><span class="rl-glabel">${label}</span>${body}</div>`;
  return [
    `<div class="rl-controls">`,
    group("Model", MODELS.map(([v, l]) => b("model", v, l, v === model)).join("")),
    group("Switch layer in encoder block", LAYERS.map((v) => b("layer", String(v), String(v + 1), v === layer)).join("")),
    group("Text", TRAFFIC.map(([v, l]) => b("traffic", v, l, v === s.traffic)).join("")),
    group("Tokens per batch", BATCHES.map((v) => b("batch", String(v), String(v), v === s.batch)).join("")),
    group("Batch made of", b("mode", "tokens", "independent tokens", s.mode === "tokens") + b("mode", "sequences", "whole sequences", s.mode === "sequences")),
    `</div>`,
    `<div class="rl-row">`,
    `<label class="rl-slider"><span>Capacity factor c <output name="cf-out">${num(s.cf, 2)}</output></span><input type="range" name="cf" min="1" max="3" step="0.05" value="${s.cf}" disabled></label>`,
    `<button type="button" name="resample" class="rl-resample" disabled>Draw another batch</button>`,
    `</div>`,
  ].join("");
}

export function readout(r: Routes, s: Settings, res: Result): string {
  const fair = s.batch / r.N;
  return [
    `<span>This batch: <strong>${res.batchDropped}</strong> of ${s.batch} tokens over capacity (${pct(res.batchDropped / s.batch)}); each expert holds ${res.C} (fair share ${num(fair, fair < 10 ? 2 : 0)}).</span>`,
    `<span>Averaged over 400 batches: <strong>${pct(res.meanDrop)}</strong> dropped (95th percentile ${pct(res.p95Drop)}); the busiest expert gets ${num(res.meanMaxOverMean, 2)}× its fair share.</span>`,
    `<span>Over all of this text, the busiest expert gets ${num(res.poolMaxOverMean, 2)}× its fair share.</span>`,
  ].join("");
}

const W = 640;
const H = 230;
const M = { left: 44, right: 10, top: 14, bottom: 34 };

function niceMax(v: number): number {
  const steps = [1, 2, 2.5, 5, 10];
  const e = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  for (const s of steps) if (s * e >= v) return s * e;
  return 10 * e;
}

export function chart(r: Routes, s: Settings, res: Result): string {
  const N = r.N;
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const peak = Math.max(res.C, ...res.batch, ...Array.from(res.pool, (f) => f * s.batch));
  const ymax = niceMax(peak * 1.08);
  const y = (v: number) => M.top + ph - (v / ymax) * ph;
  const slot = pw / N;
  const bw = Math.max(1.5, slot * (N > 16 ? 0.72 : 0.6));
  const parts: string[] = [];
  for (const t of [0, ymax / 2, ymax]) {
    parts.push(`<line class="rl-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`);
    parts.push(`<text class="rl-tick" x="${M.left - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${num(t, t < 10 && t % 1 ? 1 : 0)}</text>`);
  }
  let kept = "";
  let over = "";
  let mean = "";
  for (let i = 0; i < N; i++) {
    const x = M.left + i * slot + (slot - bw) / 2;
    const n = res.batch[i];
    const k = Math.min(n, res.C);
    if (k > 0) kept += `M${x.toFixed(1)} ${y(k).toFixed(1)}h${bw.toFixed(1)}V${y(0).toFixed(1)}h${(-bw).toFixed(1)}Z`;
    if (n > res.C) over += `M${x.toFixed(1)} ${y(n).toFixed(1)}h${bw.toFixed(1)}V${y(res.C).toFixed(1)}h${(-bw).toFixed(1)}Z`;
    const yf = y(res.pool[i] * s.batch);
    mean += `M${(x - 1).toFixed(1)} ${yf.toFixed(1)}h${(bw + 2).toFixed(1)}`;
    const every = N > 16 ? 8 : 1;
    if (i % every === 0) parts.push(`<text class="rl-tick" x="${(x + bw / 2).toFixed(1)}" y="${H - M.bottom + 13}" text-anchor="middle">${i}</text>`);
  }
  parts.push(`<path class="rl-kept" d="${kept}"/>`, `<path class="rl-over" d="${over}"/>`, `<path class="rl-mean" d="${mean}"/>`);
  const yc = y(res.C).toFixed(1);
  parts.push(`<line class="rl-cap" x1="${M.left}" x2="${W - M.right}" y1="${yc}" y2="${yc}"/>`);
  parts.push(`<text class="rl-cap-label" x="${W - M.right}" y="${(y(res.C) - 4).toFixed(1)}" text-anchor="end">capacity ${res.C}</text>`);
  parts.push(`<text class="rl-axis" x="${M.left + pw / 2}" y="${H - 4}" text-anchor="middle">expert</text>`);
  parts.push(`<text class="rl-axis" transform="translate(12 ${M.top + ph / 2}) rotate(-90)" text-anchor="middle">tokens in this batch</text>`);
  return `<svg class="rl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tokens routed to each of ${N} experts in one batch of ${s.batch}, with the capacity line at ${res.C}">${parts.join("")}</svg>`;
}

export const LEGEND =
  `<p class="rl-legend"><span class="rl-key rl-key-kept"></span>processed <span class="rl-key rl-key-over"></span>over capacity, dropped <span class="rl-key rl-key-mean"></span>expected from this text's overall routing</p>`;
