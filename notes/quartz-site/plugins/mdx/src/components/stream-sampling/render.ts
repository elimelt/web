// Build-time markup and the pure drawing functions of the stream-sampling figure.

import { esc, num } from "../../shared/format";
import initialJson from "../../../../../../content/algorithms/probabilistic/sampling-experiments/initial.json";
import metaJson from "../../../../../../content/algorithms/probabilistic/sampling-experiments/meta.json";
import { coverage, KS, METHODS, SUBSETS, summarize, TRIALS, type Method } from "./model";

interface Meta {
  records: number;
  views: number;
  names: string[];
  fullRecords: number;
  fullViews: number;
}
export const META = metaJson as Meta;
const INITIAL = initialJson as {
  K: number;
  subset: string;
  truth: number;
  records: number;
  est: Record<Method, number[]>;
  pvar: number[];
  first: { idx: number[]; tau: number; w: number[]; inSubset: boolean[] };
};

export const DEFAULT_K = INITIAL.K;
export const DEFAULT_SUBSET = INITIAL.subset;
/** The strip chart's x axis runs from 0 to this multiple of the true sum; larger estimates sit at the edge. */
export const XMAX = 3;

export const LABELS: Record<Method, string> = {
  uniform: "Uniform (Algorithm L)",
  priority: "Priority sampling",
  ppswor: "Weighted without replacement",
};

export interface View {
  K: number;
  subset: string;
  truth: number;
  records: number;
  est: Record<Method, number[]>;
  pvar: number[];
  /** The first trial's priority sample: views of each kept record, whether it is in the subset, and tau. */
  kept: { w: number; inSubset: boolean }[];
  tau: number;
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number, d = 1) => `${num(100 * v, d)}%`;

/** Deterministic vertical jitter in [0, 1) for the i-th dot. */
const jitter = (i: number) => (i * 0.6180339887498949) % 1;

/** One row of dots per sampler: each trial's estimate divided by the true sum. */
export function strips(v: View, narrow: boolean): string {
  const W = narrow ? 360 : 600;
  const L = { left: narrow ? 8 : 190, right: 16, top: 8 };
  const rowH = narrow ? 58 : 44;
  const labelH = narrow ? 18 : 0;
  const H = L.top + METHODS.length * (rowH + labelH) + 34;
  const pw = W - L.left - L.right;
  const x = (r: number) => L.left + (Math.min(r, XMAX) / XMAX) * pw;
  const parts: string[] = [];
  const bottom = L.top + METHODS.length * (rowH + labelH);
  for (let t = 0; t <= XMAX; t += 0.5) {
    const label = t === XMAX ? `≥ ${t}` : String(t);
    parts.push(`<text class="ss-tick" x="${x(t).toFixed(1)}" y="${bottom + 15}" text-anchor="${t === XMAX ? "end" : "middle"}">${label}</text>`);
  }
  METHODS.forEach((m, mi) => {
    const y0 = L.top + mi * (rowH + labelH);
    if (narrow) parts.push(`<text class="ss-label" x="${L.left}" y="${y0 + 13}">${LABELS[m]}</text>`);
    else parts.push(`<text class="ss-label" x="${L.left - 10}" y="${y0 + rowH / 2 + 4}" text-anchor="end">${LABELS[m]}</text>`);
    const top = y0 + labelH + 6;
    const span = rowH - 12;
    // Grid and the truth line span each row's dots only, so they never cross a label.
    for (let t = 0; t <= XMAX; t += 0.5) {
      parts.push(`<line class="ss-grid" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${top - 4}" y2="${top + span + 4}"/>`);
    }
    parts.push(`<line class="ss-truth" x1="${x(1).toFixed(1)}" x2="${x(1).toFixed(1)}" y1="${top - 4}" y2="${top + span + 4}"/>`);
    v.est[m].forEach((e, i) => {
      const r = e / v.truth;
      const cls = r > XMAX ? `ss-dot ss-${m} ss-over` : `ss-dot ss-${m}`;
      parts.push(`<circle class="${cls}" cx="${x(r).toFixed(1)}" cy="${(top + jitter(i) * span).toFixed(1)}" r="2.6"/>`);
    });
  });
  parts.push(`<text class="ss-axis" x="${L.left + pw / 2}" y="${H - 3}" text-anchor="middle">estimate ÷ true views (1 is exact)</text>`);
  const aria = `Estimates of the subset's views from ${v.est.uniform.length} runs of each sampler with K = ${v.K}, divided by the true value.`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

/** The first priority sample: kept records by views, heaviest first, on a log scale, with tau. */
export function keptChart(v: View, narrow: boolean): string {
  const W = narrow ? 360 : 600;
  const L = { left: narrow ? 44 : 52, right: 16, top: 10 };
  const ph = narrow ? 130 : 150;
  const H = L.top + ph + 34;
  const pw = W - L.left - L.right;
  const ws = v.kept.map((k) => k.w);
  const top = Math.max(10, ...ws, v.tau);
  const decades = Math.ceil(Math.log10(top));
  const y = (w: number) => L.top + ph - (Math.log10(Math.max(w, 1)) / decades) * ph;
  const x = (i: number) => L.left + ((i + 0.5) / v.kept.length) * pw;
  const parts: string[] = [];
  for (let d = 0; d <= decades; d++) {
    const yy = y(10 ** d).toFixed(1);
    parts.push(`<line class="ss-grid" x1="${L.left}" x2="${W - L.right}" y1="${yy}" y2="${yy}"/>`);
    parts.push(`<text class="ss-tick" x="${L.left - 6}" y="${(Number(yy) + 4).toFixed(1)}" text-anchor="end">${fmt(10 ** d)}</text>`);
  }
  const ty = y(v.tau).toFixed(1);
  parts.push(`<line class="ss-tau" x1="${L.left}" x2="${W - L.right}" y1="${ty}" y2="${ty}"/>`);
  parts.push(`<text class="ss-tick ss-tau-label" x="${W - L.right}" y="${(Number(ty) - 5).toFixed(1)}" text-anchor="end">τ = ${num(v.tau, v.tau < 10 ? 2 : 1)}</text>`);
  const r = v.kept.length > 500 ? 1.4 : v.kept.length > 100 ? 2 : 2.8;
  v.kept.forEach((k, i) => {
    parts.push(`<circle class="ss-dot ${k.inSubset ? "ss-in" : "ss-out"}" cx="${x(i).toFixed(1)}" cy="${y(k.w).toFixed(1)}" r="${r}"/>`);
  });
  parts.push(`<text class="ss-axis" x="${L.left + pw / 2}" y="${H - 14}" text-anchor="middle">the ${fmt(v.kept.length)} kept records, by views</text>`);
  parts.push(`<text class="ss-axis" x="${L.left + pw / 2}" y="${H - 1}" text-anchor="middle">(views on a log scale)</text>`);
  const aria = `The ${v.kept.length} records of one priority sample by views, with the threshold tau at ${num(v.tau, 1)} views.`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

export function subsetLabel(id: string): string {
  return SUBSETS.find((s) => s.id === id)?.label ?? id;
}

export function readout(v: View): string {
  const s = Object.fromEntries(METHODS.map((m) => [m, summarize(v.est[m], v.truth)])) as Record<Method, ReturnType<typeof summarize>>;
  const cov = coverage(v.est.priority, v.pvar, v.truth);
  const trials = v.est.uniform.length;
  const zero = s.uniform.zero > 0 ? ` The uniform sample held no record of the subset in ${pct(s.uniform.zero, 0)} of runs.` : "";
  return (
    `<p>${esc(subsetLabel(v.subset))}: ${fmt(v.records)} records with ${fmt(v.truth)} views, ${pct(v.truth / META.views)} of the substream's views. ` +
    `Over ${trials} runs with <i>K</i> = ${fmt(v.K)}, the relative root mean squared error is <strong>${pct(s.uniform.rrmse)}</strong> for the uniform sample, <strong>${pct(s.priority.rrmse)}</strong> for priority sampling and <strong>${pct(s.ppswor.rrmse)}</strong> for weighted sampling without replacement.${zero}</p>` +
    `<p>Priority sampling's interval, the estimate ± 2 standard deviations from its own variance estimate, held the true value in ${pct(cov, 0)} of runs.</p>`
  );
}

export function keptText(v: View): string {
  const heavy = v.kept.filter((k) => k.w > v.tau).length;
  const inS = v.kept.filter((k) => k.inSubset).length;
  return `In the first run, the threshold τ is ${num(v.tau, v.tau < 10 ? 2 : 1)} views. The ${fmt(heavy)} kept records with more views than τ count at their own views, and the other ${fmt(v.kept.length - heavy)} count as τ each. ${fmt(inS)} of the kept records belong to the subset (orange).`;
}

export function initialView(): View {
  return {
    K: INITIAL.K,
    subset: INITIAL.subset,
    truth: INITIAL.truth,
    records: INITIAL.records,
    est: INITIAL.est,
    pvar: INITIAL.pvar,
    kept: INITIAL.first.w.map((w, i) => ({ w, inSubset: INITIAL.first.inSubset[i] })).sort((a, b) => b.w - a.w),
    tau: INITIAL.first.tau,
  };
}

export function render(props: { base?: string }): string {
  const base = props.base ?? "";
  const v = initialView();
  const ki = KS.indexOf(DEFAULT_K);
  const opts = SUBSETS.map((s) => `<option value="${s.id}"${s.id === DEFAULT_SUBSET ? " selected" : ""}>${esc(s.label)}</option>`).join("");
  return [
    `<figure class="ss" data-base="${esc(base)}">`,
    `<div class="ss-controls">`,
    `<label class="ss-select"><span>Subset to estimate</span><select name="subset" disabled>${opts}</select></label>`,
    `<label class="ss-slider"><span>Sample size <i>K</i> <output name="k-out">${DEFAULT_K}</output></span><input type="range" name="k" min="0" max="${KS.length - 1}" step="1" value="${ki}" disabled></label>`,
    `<button type="button" name="reseed" disabled>New random draws</button>`,
    `</div>`,
    `<div class="ss-chart" data-part="strips">${strips(v, false)}</div>`,
    `<div class="ss-readout" data-part="readout" aria-live="polite">${readout(v)}</div>`,
    `<div class="ss-chart" data-part="kept">${keptChart(v, false)}</div>`,
    `<p class="ss-event" data-part="kept-text">${keptText(v)}</p>`,
    `<figcaption>Each sampler keeps <i>K</i> of the ${fmt(META.records)} records of a fixed substream (every record of 1 in 4,096 pages, in recorded order, ${fmt(META.views)} views) and estimates the subset's views from them, ${TRIALS} times with independent random draws, in the browser. Each dot is one run. The uniform sample scales its subset total by ${fmt(META.records)}/<i>K</i>; priority sampling counts a kept record as max(<i>w</i>, τ); weighted sampling without replacement counts it as <i>w</i>/(1 − e<sup>−<i>w</i>τ</sup>).</figcaption>`,
    `</figure>`,
  ].join("");
}
