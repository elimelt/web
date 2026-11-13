// Markup for the outlier figure, shared by the build (render.ts) and the
// browser (client.ts). Pure functions of a Layer, a Result and the settings;
// nothing here imports the data, so the browser bundle stays small.

import { esc, num } from "../../shared/format";
import type { Layer, Method, Result, Settings } from "./model";

export const METHODS: [Method, string][] = [
  ["tensor", "Per-tensor"],
  ["token", "Per-token"],
  ["smooth", "SmoothQuant"],
  ["int8", "LLM.int8()"],
  ["fp8", "FP8 E4M3"],
];

/** LLM.int8() thresholds the slider steps through. */
export const THRESHOLDS = [1, 2, 3, 4, 6, 8, 12, 20, 40, 100, 400, 2000];

const pct = (v: number) => (v >= 0.995 ? "100%" : v < 0.001 ? "<0.1%" : `${num(v * 100, v < 0.1 ? 1 : 0)}%`);

export function readout(L: Layer, r: Result, set: Settings): string {
  const parts = [
    `Output error <strong>${pct(r.relErr)}</strong>`,
    `SQNR ${num(r.sqnr, 1)} dB`,
    `${pct(r.zeroFrac)} of ${set.method === "int8" ? "INT8 " : ""}activations round to 0`,
  ];
  if (set.method === "int8") parts.push(`${r.floatCols} of ${L.N} channels kept in floating point`);
  if (Number.isFinite(r.step)) parts.push(`activation step ${num(r.step, r.step < 1 ? 3 : 1)}`);
  return parts.join(" · ");
}

// ---- the per-channel strip ---------------------------------------------------
const W0 = 640;
const LEFT = 44;
const RIGHT = 634;
const PANELS = [
  { top: 18, h: 92, label: "inputs: max |x| per channel" },
  { top: 140, h: 62, label: "weights: max |w| per input channel" },
];
const LOG_MIN = -4;
const LOG_MAX = 5;

function yOf(v: number, p: { top: number; h: number }): number {
  const l = Math.min(LOG_MAX, Math.max(LOG_MIN, Math.log10(Math.max(v, 10 ** LOG_MIN))));
  return p.top + p.h - ((l - LOG_MIN) / (LOG_MAX - LOG_MIN)) * p.h;
}

function bars(values: Float64Array, p: { top: number; h: number }, mask?: (j: number) => boolean): string {
  const n = values.length;
  const base = p.top + p.h;
  let d = "";
  for (let j = 0; j < n; j++) {
    if (mask && !mask(j)) continue;
    const x = LEFT + ((j + 0.5) / n) * (RIGHT - LEFT);
    d += `M${x.toFixed(2)} ${base}V${yOf(values[j], p).toFixed(1)}`;
  }
  return d;
}

export function strip(L: Layer, r: Result, set: Settings, floatMask: Uint8Array | null): string {
  const [px, pw] = PANELS;
  const out: string[] = [
    `<svg class="ol-strip" viewBox="0 0 ${W0} 222" role="img" aria-label="Largest input and weight magnitude for each of the ${L.N} input channels, log scale">`,
  ];
  for (const p of PANELS) {
    for (const e of [-2, 0, 2, 4]) {
      const y = yOf(10 ** e, p);
      out.push(`<line class="ol-grid" x1="${LEFT}" x2="${RIGHT}" y1="${y}" y2="${y}"/>`);
      out.push(`<text class="ol-tick" x="${LEFT - 5}" y="${y + 3.5}" text-anchor="end">${e === 0 ? "1" : `10${sup(e)}`}</text>`);
    }
    out.push(`<text class="ol-label" x="${LEFT}" y="${p.top - 5}">${p.label}</text>`);
  }
  if (Number.isFinite(r.step)) {
    const y = yOf(r.step / 2, px);
    const b = px.top + px.h;
    out.push(`<rect class="ol-zero" x="${LEFT}" y="${y}" width="${RIGHT - LEFT}" height="${Math.max(0, b - y)}"/>`);
    out.push(`<text class="ol-zero-label" x="${RIGHT - 4}" y="${Math.min(b - 4, y + 12)}" text-anchor="end">below half a step: rounds to 0</text>`);
  }
  const kept = floatMask;
  out.push(`<path class="ol-bar-x" d="${bars(r.xChan, px, kept ? (j) => !kept[j] : undefined)}"/>`);
  if (kept) out.push(`<path class="ol-bar-float" d="${bars(r.xChan, px, (j) => kept[j] === 1)}"/>`);
  out.push(`<path class="ol-bar-w" d="${bars(r.wChan, pw)}"/>`);
  out.push(`<text class="ol-tick" x="${LEFT}" y="218">channel 0</text>`);
  out.push(`<text class="ol-tick" x="${RIGHT}" y="218" text-anchor="end">${L.N - 1}</text>`);
  out.push("</svg>");
  return out.join("");
}

function sup(e: number): string {
  const map: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵" };
  return String(e).split("").map((c) => map[c] ?? c).join("");
}

// ---- per-token chips -----------------------------------------------------------
export function chips(L: Layer, r: Result): string {
  return L.tokens
    .map((tok, t) => {
      const e = r.tokenErr[t];
      const shown = tok.trim() === "" ? "␣" : tok.trim();
      return `<span class="ol-chip" style="--e:${Math.min(1, e).toFixed(3)}" title="${esc(`${shown}: ${pct(e)} output error`)}"><span class="ol-tok">${esc(shown)}</span><span class="ol-err">${pct(e)}</span></span>`;
    })
    .join("");
}

// ---- controls -------------------------------------------------------------------
export function controls(set: Settings): string {
  const b = (name: string, value: string, label: string, on: boolean) =>
    `<button type="button" name="${name}" value="${value}" aria-pressed="${on}" disabled>${label}</button>`;
  const ti = THRESHOLDS.indexOf(set.threshold);
  return [
    `<div class="ol-controls">`,
    `<div class="ol-group" role="group" aria-label="Activation scale">${METHODS.map(([m, l]) => b("method", m, l, set.method === m)).join("")}</div>`,
    `<div class="ol-group" role="group" aria-label="Integer bits">${b("bits", "8", "INT8", set.bits === 8)}${b("bits", "4", "INT4", set.bits === 4)}</div>`,
    `</div>`,
    `<div class="ol-sliders">`,
    `<label class="ol-slider"><span>SmoothQuant migration α <output name="alpha-out">${num(set.alpha, 2)}</output></span><input type="range" name="alpha" min="0" max="1" step="0.05" value="${set.alpha}" disabled></label>`,
    `<label class="ol-slider"><span>LLM.int8() outlier threshold <output name="thr-out">${set.threshold}</output></span><input type="range" name="threshold" min="0" max="${THRESHOLDS.length - 1}" step="1" value="${ti}" disabled></label>`,
    `</div>`,
  ].join("");
}

export function floatMaskOf(L: Layer, set: Settings): Uint8Array | null {
  if (set.method !== "int8") return null;
  const m = new Uint8Array(L.N);
  for (let j = 0; j < L.N; j++)
    for (let t = 0; t < L.T; t++)
      if (Math.abs(L.X[t * L.N + j]) >= set.threshold) {
        m[j] = 1;
        break;
      }
  return m;
}
