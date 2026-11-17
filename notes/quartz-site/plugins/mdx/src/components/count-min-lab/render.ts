// Markup for the Count-Min figure: a log-log scatter of estimated against true
// counts for a sample of pages, with the Theorem 1 bound and the expected
// error of one row, plus readouts computed over every page in the hour.

import { num } from "../../shared/format";
import { mulberry32 } from "../../shared/random";
import { analyze, DEFAULT_D, DEFAULT_LOGW, expandCounts, PAGES, sampleIndices, VIEWS, type Stats } from "./model";

const W = 640;
const H = 340;
const M = { left: 56, right: 14, top: 14, bottom: 42 };
const X1 = 6; // log10 of the axis ends
const Y1 = 6;

const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (x: number, digits = 1) => `${num(x * 100, digits)}%`;
const sup = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶"];

export function chart(s: Stats): string {
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const x = (v: number) => M.left + (Math.log10(Math.max(v, 1)) / X1) * pw;
  const y = (v: number) => M.top + (1 - Math.min(Math.log10(Math.max(v, 1)), Y1) / Y1) * ph;
  const parts: string[] = [];
  for (let e = 0; e <= X1; e++) {
    parts.push(`<line class="cml-grid" x1="${x(10 ** e).toFixed(1)}" x2="${x(10 ** e).toFixed(1)}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    parts.push(`<text class="cml-tick" x="${x(10 ** e).toFixed(1)}" y="${H - M.bottom + 15}" text-anchor="middle">10${sup[e]}</text>`);
  }
  for (let e = 0; e <= Y1; e++) {
    parts.push(`<line class="cml-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(10 ** e).toFixed(1)}" y2="${y(10 ** e).toFixed(1)}"/>`);
    parts.push(`<text class="cml-tick" x="${M.left - 6}" y="${(y(10 ** e) + 4).toFixed(1)}" text-anchor="end">10${sup[e]}</text>`);
  }
  parts.push(`<text class="cml-axis" x="${M.left + pw / 2}" y="${H - 6}" text-anchor="middle">true views in the hour (log scale)</text>`);
  parts.push(`<text class="cml-axis" transform="translate(14 ${M.top + ph / 2}) rotate(-90)" text-anchor="middle">Count-Min estimate</text>`);
  const curve = (off: number, cls: string) => {
    const pts: string[] = [];
    for (let k = 0; k <= 60; k++) {
      const a = 10 ** ((k / 60) * X1);
      pts.push(`${k ? "L" : "M"}${x(a).toFixed(1)} ${y(a + off).toFixed(1)}`);
    }
    return `<path class="${cls}" d="${pts.join("")}"/>`;
  };
  parts.push(curve(0, "cml-diag"));
  parts.push(curve(VIEWS / s.w, "cml-row"));
  parts.push(curve(s.epsN, "cml-bound"));
  // points, with a deterministic horizontal jitter for the small integer counts
  const rnd = mulberry32(7);
  const dots: string[] = [];
  for (const p of s.sample) {
    const j = p.a < 30 ? 10 ** ((rnd() - 0.5) * 0.28) : 1;
    const cls = p.est === p.a ? "cml-pt cml-exact" : "cml-pt";
    dots.push(`<circle class="${cls}" cx="${x(p.a * j).toFixed(1)}" cy="${y(p.est).toFixed(1)}" r="1.9"/>`);
  }
  parts.push(`<g>${dots.join("")}</g>`);
  const label = `Estimated against true views for ${s.sample.length} pages, width ${s.w}, depth ${s.d}.`;
  return `<svg class="cml-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${parts.join("")}</svg>`;
}

export function readout(s: Stats): string {
  const kb = (s.w * s.d * 4) / 1024;
  return [
    `<strong>${fmtInt(s.w)} × ${s.d}</strong> counters (${num(kb, kb < 10 ? 1 : 0)} KB at 4 bytes each), so ε = e/w = ${num((Math.E / s.w) * 100, 3)}% and δ = e<sup>−d</sup> = ${pct(s.delta, s.delta < 0.01 ? 3 : 1)}.`,
    `Theorem 1 allows an error above εN = ${fmtInt(s.epsN)} views for up to ${pct(s.delta, s.delta < 0.01 ? 3 : 1)} of pages; over all ${fmtInt(PAGES)} pages, <strong>${pct(s.exceed, 3)}</strong> exceed it.`,
    `A page viewed once has median estimate <strong>${fmtInt(s.medianSingle)}</strong>; ${pct(s.exact)} of pages are estimated exactly, and the 100 most viewed pages are overestimated by ${pct(s.top100Rel, 2)} on average.`,
  ].join(" ");
}

export interface Props {
  logw?: number;
  d?: number;
  seed?: number;
}

let cached: Uint32Array | null = null;
export const counts = (): Uint32Array => (cached ??= expandCounts());

export function render(props: Props): string {
  const logW = typeof props.logw === "number" ? props.logw : DEFAULT_LOGW;
  const d = typeof props.d === "number" ? props.d : DEFAULT_D;
  const seed = typeof props.seed === "number" ? props.seed : 1;
  const s = analyze(counts(), logW, d, seed, sampleIndices(PAGES));
  return [
    `<figure class="cml" data-seed="${seed}">`,
    `<div class="cml-controls">`,
    `<label class="cml-slider"><span>Width w <output name="w-out">${fmtInt(2 ** logW)}</output></span><input type="range" name="logw" min="6" max="16" step="1" value="${logW}" disabled></label>`,
    `<label class="cml-slider"><span>Depth d <output name="d-out">${d}</output></span><input type="range" name="d" min="1" max="8" step="1" value="${d}" disabled></label>`,
    `<button type="button" name="rerun" disabled>New hash functions</button>`,
    `</div>`,
    `<div class="cml-legend" aria-hidden="true"><span class="cml-key cml-key-pt">page</span><span class="cml-key cml-key-exact">estimated exactly</span><span class="cml-key cml-key-diag">estimate = true</span><span class="cml-key cml-key-row">true + N/w (one row's expected error)</span><span class="cml-key cml-key-bound">true + εN (Theorem 1)</span></div>`,
    `<div class="cml-plot" data-part="chart">${chart(s)}</div>`,
    `<p class="cml-readout" data-part="readout" aria-live="polite">${readout(s)}</p>`,
    `<figcaption>Real data: ${fmtInt(VIEWS)} views of ${fmtInt(PAGES)} English Wikipedia pages (desktop) in the hour ending 13:00 UTC on 4 March 2026. The sketch runs in the page on every count; the plot shows the 1,500 most viewed pages and 2,500 others drawn at random, and the readouts cover every page.</figcaption>`,
    `</figure>`,
  ].join("");
}
