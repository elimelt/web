// Markup for the pruning figure, shared by the build (render.ts) and the
// browser (client.ts). Pure functions of the layer, a result and the
// settings; nothing here imports the data.

import { esc, num } from "../../shared/format";
import { bins, sparsityOf, type Layer, type Result, type Settings, type Sweep } from "./model";

const pct = (v: number) => (v >= 0.995 ? "100%" : v < 0.001 ? "<0.1%" : `${num(v * 100, v < 0.1 ? 1 : 0)}%`);

export const METHODS: [Settings["method"], string][] = [
  ["magnitude", "Magnitude |w|"],
  ["wanda", "Wanda |w|·‖x‖"],
];
export const GROUPS: [Settings["group"], string][] = [
  ["output", "per output"],
  ["layer", "whole layer"],
];
export const PATTERNS: [Settings["pattern"], string][] = [
  ["unstructured", "Unstructured"],
  ["4:8", "4:8"],
  ["2:4", "2:4"],
];

export function controls(L: Layer, set: Settings): string {
  const b = (name: string, value: string, label: string, on: boolean) =>
    `<button type="button" name="${name}" value="${value}" aria-pressed="${on}" disabled>${esc(label)}</button>`;
  return [
    `<div class="pl-controls">`,
    `<div class="pl-group" role="group" aria-label="Score">${METHODS.map(([v, l]) => b("method", v, l, set.method === v)).join("")}</div>`,
    `<div class="pl-group" role="group" aria-label="Pattern">${PATTERNS.map(([v, l]) => b("pattern", v, l, set.pattern === v)).join("")}</div>`,
    `</div>`,
    `<div class="pl-row">`,
    `<label class="pl-slider"><span>Sparsity <output name="level-out">${pct(L.grid[set.level])}</output></span><input type="range" name="level" min="0" max="${L.grid.length - 1}" step="1" value="${set.level}" disabled></label>`,
    `<div class="pl-group" role="group" aria-label="Comparison group"><span class="pl-glabel">compare</span>${GROUPS.map(([v, l]) => b("group", v, l, set.group === v)).join("")}</div>`,
    `</div>`,
  ].join("");
}

export function readout(L: Layer, r: Result, set: Settings, loud: number): string {
  const kept = Math.round(r.keptByChannel[loud] * L.C);
  return [
    `Layer output error <strong>${pct(r.relErr)}</strong>`,
    `${pct(r.sparsity)} of weights removed, carrying ${pct(r.normRemoved)} of their norm`,
    `channel ${loud} (largest inputs) keeps ${kept} of ${L.C}`,
  ].join(" · ");
}

// ---- kept fraction by input size ------------------------------------------------
export const EDGES = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5];
const CW = 640;
const CL = 44;
const CR = 634;
const CT = 20;
const CH = 120;

export function keptChart(L: Layer, r: Result): string {
  const B = bins(L, r, EDGES);
  const lo = EDGES[0];
  const hi = EDGES[EDGES.length - 1];
  const xOf = (l: number) => CL + ((l - lo) / (hi - lo)) * (CR - CL);
  const yOf = (f: number) => CT + CH - f * CH;
  const out = [
    `<svg class="pl-chart" viewBox="0 0 ${CW} 178" role="img" aria-label="Fraction of weights kept for input channels grouped by the size of their activations">`,
    `<text class="pl-label" x="${CL}" y="12">weights kept, by the input channel's activation RMS (log scale)</text>`,
  ];
  for (const f of [0, 0.5, 1]) {
    out.push(`<line class="pl-grid" x1="${CL}" x2="${CR}" y1="${yOf(f)}" y2="${yOf(f)}"/>`);
    out.push(`<text class="pl-tick" x="${CL - 5}" y="${yOf(f) + 3.5}" text-anchor="end">${f * 100}%</text>`);
  }
  for (const b of B) {
    if (!b.count) continue;
    const x0 = xOf(b.lo) + 1;
    const x1 = xOf(b.hi) - 1;
    out.push(`<rect class="pl-bar" x="${x0.toFixed(1)}" y="${yOf(b.kept).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(b.kept * CH).toFixed(1)}"><title>${b.count} channel${b.count === 1 ? "" : "s"}, RMS ${num(10 ** b.lo, 2)} to ${num(10 ** b.hi, 2)}: ${pct(b.kept)} of weights kept</title></rect>`);
    out.push(`<text class="pl-count" x="${((x0 + x1) / 2).toFixed(1)}" y="${CT + CH + 12}" text-anchor="middle">${b.count}</text>`);
  }
  for (const [e, t] of [[-0.5, "0.3"], [0, "1"], [1, "10"], [2, "100"], [3, "1000"]] as [number, string][]) {
    out.push(`<text class="pl-tick" x="${xOf(e)}" y="${CT + CH + 30}" text-anchor="middle">${t}</text>`);
  }
  out.push(`<text class="pl-tick" x="${CL - 5}" y="${CT + CH + 12}" text-anchor="end">n</text>`);
  out.push("</svg>");
  return out.join("");
}

// ---- per-token chips -------------------------------------------------------------
export function chips(L: Layer, r: Result): string {
  return L.tokens
    .map((tok, t) => {
      const e = r.tokenErr[t];
      const shown = tok.trim() === "" ? "␣" : tok.trim();
      return `<span class="pl-chip" style="--e:${Math.min(1, e).toFixed(3)}" title="${esc(`${shown}: ${pct(e)} output error`)}"><span class="pl-tok">${esc(shown)}</span><span class="pl-err">${pct(e)}</span></span>`;
    })
    .join("");
}

// ---- whole-model perplexity, measured offline -----------------------------------
const SW = 640;
const SL = 44;
const SR = 630;
const ST = 22;
const SH = 150;
const SERIES = ["pl-s1", "pl-s2", "pl-s3", "pl-s4"];

export function sweepChart(S: Sweep, L: Layer, set: Settings): string {
  const xMax = S.sparsity[S.sparsity.length - 1];
  const all = S.curves.flatMap((c) => c.ppl).concat(S.dense);
  const yLo = Math.log10(Math.min(...all) * 0.95);
  const yHi = Math.log10(Math.max(...all) * 1.05);
  const xOf = (s: number) => SL + (s / xMax) * (SR - SL);
  const yOf = (p: number) => ST + SH - ((Math.log10(p) - yLo) / (yHi - yLo)) * SH;
  const out = [
    `<svg class="pl-chart" viewBox="0 0 ${SW} 200" role="img" aria-label="Whole-model perplexity against sparsity for each pruning method">`,
    `<text class="pl-label" x="${SL}" y="12">whole model: perplexity on Go blog text (log scale)</text>`,
  ];
  for (const p of niceTicks(10 ** yLo, 10 ** yHi)) {
    out.push(`<line class="pl-grid" x1="${SL}" x2="${SR}" y1="${yOf(p).toFixed(1)}" y2="${yOf(p).toFixed(1)}"/>`);
    out.push(`<text class="pl-tick" x="${SL - 5}" y="${(yOf(p) + 3.5).toFixed(1)}" text-anchor="end">${p}</text>`);
  }
  for (const s of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    if (s > xMax + 1e-9) continue;
    out.push(`<text class="pl-tick" x="${xOf(s)}" y="${ST + SH + 16}" text-anchor="middle">${Math.round(s * 100)}%</text>`);
  }
  out.push(`<line class="pl-dense" x1="${SL}" x2="${SR}" y1="${yOf(S.dense).toFixed(1)}" y2="${yOf(S.dense).toFixed(1)}"/>`);
  const sp = sparsityOf(L, set);
  if (sp <= xMax + 1e-9) out.push(`<line class="pl-now" x1="${xOf(sp)}" x2="${xOf(sp)}" y1="${ST}" y2="${ST + SH}"/>`);
  S.curves.forEach((c, i) => {
    const pts = c.ppl.map((p, k) => `${xOf(S.sparsity[k]).toFixed(1)},${yOf(p).toFixed(1)}`);
    out.push(`<polyline class="pl-line ${SERIES[i % SERIES.length]}" points="${pts.join(" ")}"/>`);
  });
  const dots = set.pattern === "unstructured" ? [] : S.nm.filter((p) => p.pattern === set.pattern);
  for (const p of dots) {
    const i = S.curves.findIndex((c) => c.key === p.key);
    out.push(`<circle class="pl-dot ${SERIES[Math.max(0, i) % SERIES.length]}" cx="${xOf(0.5)}" cy="${yOf(p.ppl).toFixed(1)}" r="4"><title>${esc(`${p.label}, ${p.pattern}: perplexity ${num(p.ppl, 1)}`)}</title></circle>`);
  }
  out.push("</svg>");
  const key = S.curves.map((c, i) => `<li><span class="pl-swatch ${SERIES[i % SERIES.length]}"></span>${esc(c.label)}</li>`);
  key.push(`<li><span class="pl-swatch pl-swatch-dense"></span>dense, ${num(S.dense, 1)}</li>`);
  if (dots.length) key.push(`<li><span class="pl-swatch pl-swatch-dot"></span>${esc(set.pattern)} at 50%</li>`);
  out.push(`<ul class="pl-key">${key.join("")}</ul>`);
  return out.join("");
}

function niceTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 2, 3, 5]) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  return out;
}
