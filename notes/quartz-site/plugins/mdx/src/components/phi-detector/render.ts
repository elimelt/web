// Markup for the heartbeat failure-detector figure. The build renders the
// whole figure from the default settings; the client redraws the same parts
// from the same functions when the reader changes a control.

import { esc, num } from "../../shared/format";
import { TRACE } from "./data";
import { curve, decodeIntervals, grid, KINDS, quality, timeouts, windowStats, type CurvePoint, type Kind, type Quality, type WindowStats } from "./model";

export const NAMES: Record<Kind, string> = {
  phiNormal: "φ, normal model",
  phiExp: "φ, exponential model",
  timeout: "fixed timeout",
};

const COLOR: Record<Kind, string> = { phiNormal: "blue", phiExp: "orange", timeout: "green" };

export const VIEW_MS = 20_000;

/** Slider position 0..100 to a threshold, log-spaced: phi 0.5..20, timeout 100..3000 ms. */
export function thresholdAt(kind: Kind, pos: number): number {
  const [lo, hi] = kind === "timeout" ? [100, 3000] : [0.5, 20];
  const v = lo * (hi / lo) ** (pos / 100);
  return kind === "timeout" ? Math.round(v) : Number(v.toPrecision(2));
}

export function positionOf(kind: Kind, threshold: number): number {
  const [lo, hi] = kind === "timeout" ? [100, 3000] : [0.5, 20];
  return Math.round((100 * Math.log(threshold / lo)) / Math.log(hi / lo));
}

export const fmtThreshold = (kind: Kind, t: number) => (kind === "timeout" ? `${t} ms` : `Φ = ${num(t, t < 1 ? 2 : 1)}`);

export interface State {
  kind: Kind;
  threshold: number;
  window: number;
  /** Start of the 20 s detail view, ms from the start of the trace. */
  view: number;
}

export interface Model {
  arrivals: Float64Array;
  start: number;
  stats: WindowStats;
  curves: Record<Kind, CurvePoint[]>;
}

let arrivalsCache: Float64Array | null = null;
export function arrivals(): Float64Array {
  if (!arrivalsCache) arrivalsCache = decodeIntervals(TRACE.intervals, TRACE.unit);
  return arrivalsCache;
}

export function model(window: number): Model {
  const a = arrivals();
  const start = Math.min(TRACE.judgeFrom, a.length - 2);
  const stats = windowStats(a, window);
  const curves = {} as Record<Kind, CurvePoint[]>;
  for (const k of KINDS) curves[k] = curve(k, a, stats, start, grid(k, TRACE.period));
  return { arrivals: a, start, stats, curves };
}

// ---------- overview strip: every inter-arrival interval of the trace ----------

const OW = 640;
const OH = 92;
const OM = { left: 44, right: 10, top: 8, bottom: 20 };

export function overview(m: Model, tau: Float64Array, view: number): string {
  const a = m.arrivals;
  const t0 = a[0];
  const span = a[a.length - 1] - t0;
  const pw = OW - OM.left - OM.right;
  const ph = OH - OM.top - OM.bottom;
  const ymax = 600;
  const x = (t: number) => OM.left + ((t - t0) / span) * pw;
  const y = (v: number) => OM.top + (1 - Math.min(v, ymax) / ymax) * ph;
  const p: string[] = [];
  const [c0, c1] = TRACE.churn;
  p.push(`<rect class="phd-phase" x="${x(t0 + c0).toFixed(1)}" y="${OM.top}" width="${(x(t0 + c1) - x(t0 + c0)).toFixed(1)}" height="${ph}"/>`);
  p.push(`<text class="phd-tick" x="${((x(t0 + c0) + x(t0 + c1)) / 2).toFixed(1)}" y="${OM.top + 10}" text-anchor="middle">allocation workload on</text>`);
  for (const v of [0, 200, 400, 600]) {
    p.push(`<line class="phd-grid" x1="${OM.left}" x2="${OW - OM.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`);
    p.push(`<text class="phd-tick" x="${OM.left - 5}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`);
  }
  for (let s = 0; s * 1000 <= span; s += 60) {
    const xv = x(t0 + s * 1000);
    p.push(`<text class="phd-tick" x="${xv.toFixed(1)}" y="${OH - 5}" text-anchor="middle">${s / 60} min</text>`);
  }
  let d = "";
  for (let k = 1; k < a.length; k++) {
    const iv = a[k] - a[k - 1];
    d += `M${x(a[k]).toFixed(1)} ${y(0).toFixed(1)}V${y(iv).toFixed(1)}`;
  }
  p.push(`<path class="phd-iv" d="${d}"/>`);
  let md = "";
  for (let k = m.start; k < a.length - 1; k++) {
    if (a[k + 1] - a[k] > tau[k - m.start]) md += `M${x(a[k + 1]).toFixed(1)} ${OM.top - 2}v6`;
  }
  p.push(`<path class="phd-mist" d="${md}"/>`);
  p.push(`<rect class="phd-view" x="${x(t0 + view).toFixed(1)}" y="${OM.top - 3}" width="${((VIEW_MS / span) * pw).toFixed(1)}" height="${ph + 3}"/>`);
  p.push(`<text class="phd-axis" transform="translate(11 ${OM.top + ph / 2}) rotate(-90)" text-anchor="middle">ms</text>`);
  return `<svg class="phd-overview" viewBox="0 0 ${OW} ${OH}" role="img" aria-label="Every inter-arrival interval of the ${Math.round(span / 60000)}-minute trace; the box marks the 20-second detail view.">${p.join("")}</svg>`;
}

// ---------- detail view: time since the last heartbeat against the timeout ----------

const DW = 640;
const DH = 210;
const DM = { left: 44, right: 10, top: 12, bottom: 34 };

export function detail(m: Model, tau: Float64Array, view: number): string {
  const a = m.arrivals;
  const t0 = a[0];
  const v0 = t0 + view;
  const v1 = v0 + VIEW_MS;
  const pw = DW - DM.left - DM.right;
  const ph = DH - DM.top - DM.bottom;
  let lo = 0;
  while (lo < a.length - 1 && a[lo + 1] < v0) lo++;
  let hi = lo;
  while (hi < a.length - 1 && a[hi] < v1) hi++;
  let ymax = 300;
  for (let k = lo; k < hi; k++) {
    ymax = Math.max(ymax, a[k + 1] - a[k]);
    if (k >= m.start) ymax = Math.max(ymax, tau[k - m.start]);
  }
  ymax = Math.min(ymax * 1.08, 2000);
  const x = (t: number) => DM.left + ((Math.min(Math.max(t, v0), v1) - v0) / VIEW_MS) * pw;
  const y = (v: number) => DM.top + (1 - Math.min(v, ymax) / ymax) * ph;
  const p: string[] = [];
  const step = ymax > 1000 ? 500 : ymax > 500 ? 200 : 100;
  for (let v = 0; v <= ymax; v += step) {
    p.push(`<line class="phd-grid" x1="${DM.left}" x2="${DW - DM.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`);
    p.push(`<text class="phd-tick" x="${DM.left - 5}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`);
  }
  for (let s = Math.ceil(view / 5000) * 5; s * 1000 <= view + VIEW_MS; s += 5) {
    const xv = x(t0 + s * 1000);
    p.push(`<text class="phd-tick" x="${xv.toFixed(1)}" y="${DH - DM.bottom + 15}" text-anchor="middle">${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</text>`);
  }
  p.push(`<text class="phd-axis" x="${DM.left + pw / 2}" y="${DH - 4}" text-anchor="middle">trace time (min:s)</text>`);
  p.push(`<text class="phd-axis" transform="translate(12 ${DM.top + ph / 2}) rotate(-90)" text-anchor="middle">ms since last heartbeat</text>`);
  const [c0, c1] = TRACE.churn;
  if (t0 + c1 > v0 && t0 + c0 < v1) {
    p.push(`<rect class="phd-phase" x="${x(t0 + c0).toFixed(1)}" y="${DM.top}" width="${(x(t0 + c1) - x(t0 + c0)).toFixed(1)}" height="${ph}"/>`);
  }
  let saw = "";
  let thr = "";
  let sus = "";
  for (let k = lo; k < hi; k++) {
    const iv = a[k + 1] - a[k];
    const xa = x(a[k]);
    const xb = x(a[k + 1]);
    // elapsed rises linearly from 0 at a[k] to iv at a[k+1]; clip to the view
    const e0 = Math.max(0, v0 - a[k]);
    const e1 = Math.min(iv, v1 - a[k]);
    saw += `M${x(a[k] + e0).toFixed(1)} ${y(e0).toFixed(1)}L${x(a[k] + e1).toFixed(1)} ${y(e1).toFixed(1)}`;
    if (k >= m.start) {
      const t = tau[k - m.start];
      thr += `M${xa.toFixed(1)} ${y(t).toFixed(1)}H${xb.toFixed(1)}`;
      if (iv > t) {
        const sx = x(a[k] + t);
        sus += `<rect class="phd-sus" x="${sx.toFixed(1)}" y="${DM.top}" width="${Math.max(1, xb - sx).toFixed(1)}" height="${ph}"/>`;
      }
    }
  }
  p.push(sus);
  p.push(`<path class="phd-thr" d="${thr}"/>`);
  p.push(`<path class="phd-saw" d="${saw}"/>`);
  return `<svg class="phd-detail" viewBox="0 0 ${DW} ${DH}" role="img" aria-label="Time since the last heartbeat (rising lines) against the detector's timeout (horizontal steps) over 20 seconds of the trace; shaded columns are wrong suspicions.">${p.join("")}</svg>`;
}

// ---------- trade-off: mean timeout against wrong suspicions per hour ----------

const TW = 640;
const TH = 250;
const TM = { left: 52, right: 12, top: 12, bottom: 40 };
const XL = [100, 10000];
const YL = [1, 1e5];

export function tradeoff(m: Model, s: State, q: Quality): string {
  const pw = TW - TM.left - TM.right;
  const ph = TH - TM.top - TM.bottom - 14;
  const x = (v: number) => TM.left + (Math.log10(Math.min(Math.max(v, XL[0]), XL[1]) / XL[0]) / Math.log10(XL[1] / XL[0])) * pw;
  const zeroY = TM.top + ph + 14;
  const y = (v: number) => (v <= 0 ? zeroY : TM.top + (1 - Math.log10(Math.min(Math.max(v, YL[0]), YL[1]) / YL[0]) / Math.log10(YL[1] / YL[0])) * ph);
  const p: string[] = [];
  for (let e = 0; e <= 5; e++) {
    const yv = y(10 ** e);
    p.push(`<line class="phd-grid" x1="${TM.left}" x2="${TW - TM.right}" y1="${yv.toFixed(1)}" y2="${yv.toFixed(1)}"/>`);
    p.push(`<text class="phd-tick" x="${TM.left - 5}" y="${(yv + 4).toFixed(1)}" text-anchor="end">${e < 4 ? 10 ** e : `10${e === 4 ? "⁴" : "⁵"}`}</text>`);
  }
  p.push(`<text class="phd-tick" x="${TM.left - 5}" y="${zeroY + 4}" text-anchor="end">0</text>`);
  p.push(`<line class="phd-grid" x1="${TM.left}" x2="${TW - TM.right}" y1="${zeroY}" y2="${zeroY}"/>`);
  for (const v of [100, 200, 500, 1000, 2000, 5000, 10000]) {
    const xv = x(v);
    p.push(`<line class="phd-grid" x1="${xv.toFixed(1)}" x2="${xv.toFixed(1)}" y1="${TM.top}" y2="${zeroY}"/>`);
    p.push(`<text class="phd-tick" x="${xv.toFixed(1)}" y="${zeroY + 15}" text-anchor="middle">${v >= 1000 ? `${v / 1000} s` : `${v} ms`}</text>`);
  }
  p.push(`<text class="phd-axis" x="${TM.left + pw / 2}" y="${TH - 4}" text-anchor="middle">mean timeout after a heartbeat (log scale)</text>`);
  p.push(`<text class="phd-axis" transform="translate(12 ${TM.top + ph / 2}) rotate(-90)" text-anchor="middle">wrong suspicions per hour</text>`);
  for (const k of KINDS) {
    const pts = m.curves[k].filter((c) => c.q.detection <= XL[1] * 1.2);
    const d = pts.map((c, i) => `${i ? "L" : "M"}${x(c.q.detection).toFixed(1)} ${y(c.q.mistakesPerHour).toFixed(1)}`).join("");
    p.push(`<path class="phd-curve phd-${COLOR[k]}${k === s.kind ? " phd-on" : ""}" d="${d}"/>`);
  }
  p.push(`<circle class="phd-dot phd-${COLOR[s.kind]}" cx="${x(q.detection).toFixed(1)}" cy="${y(q.mistakesPerHour).toFixed(1)}" r="5.5"/>`);
  return `<svg class="phd-tradeoff" viewBox="0 0 ${TW} ${TH}" role="img" aria-label="Wrong suspicions per hour against mean timeout for the three detectors as their thresholds vary; the dot marks the current setting.">${p.join("")}</svg>`;
}

export function readout(m: Model, s: State, q: Quality, tau: Float64Array): string {
  const a = m.arrivals;
  const t0 = a[0];
  const [c0, c1] = TRACE.churn;
  let during = 0;
  for (let k = m.start; k < a.length - 1; k++) {
    if (a[k + 1] - a[k] > tau[k - m.start] && a[k] - t0 >= c0 && a[k] - t0 < c1) during++;
  }
  const minutes = (a[a.length - 1] - a[m.start]) / 60000;
  const mist =
    q.mistakes === 0
      ? `no wrong suspicions in the ${num(minutes, 1)} minutes judged`
      : `<strong>${q.mistakes}</strong> wrong suspicion${q.mistakes === 1 ? "" : "s"} in the ${num(minutes, 1)} minutes judged (${num(q.mistakesPerHour, 0)} per hour), ${during} of them while the workload ran, each lasting ${num(q.mistakeDuration, 0)} ms on average`;
  return `${esc(NAMES[s.kind])} at ${fmtThreshold(s.kind, s.threshold)}${s.kind === "timeout" ? "" : `, window ${s.window}`}: mean timeout <strong>${num(q.detection, 0)} ms</strong> after each heartbeat; ${mist}. The never-crashed sender was trusted ${num(q.accuracy * 100, 3)}% of the time.`;
}

const kindButtons = (s: State) =>
  KINDS.map((k) => `<button type="button" name="kind-${k}" data-kind="${k}" aria-pressed="${k === s.kind}" class="phd-k phd-${COLOR[k]}" disabled>${esc(NAMES[k])}</button>`).join("");

export const DEFAULT_STATE: State = { kind: "phiNormal", threshold: 8, window: 1000, view: TRACE.churn[0] - 8000 };

export function render(): string {
  const s = DEFAULT_STATE;
  const m = model(s.window);
  const tau = timeouts(s.kind, s.threshold, m.stats, m.start);
  const q = quality(m.arrivals, tau, m.start);
  const span = m.arrivals[m.arrivals.length - 1] - m.arrivals[0];
  return [
    `<figure class="phd">`,
    `<div class="phd-kinds" role="group" aria-label="Detector">${kindButtons(s)}</div>`,
    `<div class="phd-controls">`,
    `<label class="phd-slider"><span>Threshold <output name="thr-out">${fmtThreshold(s.kind, s.threshold)}</output></span><input type="range" name="thr" min="0" max="100" step="1" value="${positionOf(s.kind, s.threshold)}" disabled></label>`,
    `<label class="phd-select"><span>Window</span><select name="window" disabled><option value="100">100 intervals</option><option value="1000" selected>1000 intervals</option></select></label>`,
    `</div>`,
    `<div class="phd-plot" data-part="overview">${overview(m, tau, s.view)}</div>`,
    `<label class="phd-slider phd-viewslider"><span>Detail view starts at <output name="view-out">${fmtClock(s.view)}</output></span><input type="range" name="view" min="0" max="${Math.floor((span - VIEW_MS) / 1000)}" step="1" value="${s.view / 1000}" disabled></label>`,
    `<div class="phd-plot" data-part="detail">${detail(m, tau, s.view)}</div>`,
    `<div class="phd-legend" aria-hidden="true">${KINDS.map((k) => `<span class="phd-key phd-${COLOR[k]}">${esc(NAMES[k])}</span>`).join("")}</div>`,
    `<div class="phd-plot" data-part="tradeoff">${tradeoff(m, s, q)}</div>`,
    `<p class="phd-readout" data-part="readout" aria-live="polite">${readout(m, s, q, tau)}</p>`,
    `<figcaption>${esc(TRACE.caption)} Detectors are judged from heartbeat ${TRACE.judgeFrom} onward, after the window has filled. Every suspicion is a mistake, since the sender never crashed; the timeout is the detection time for a crash just after a heartbeat is sent, less that heartbeat's transit time.</figcaption>`,
    `</figure>`,
  ].join("");
}

export const fmtClock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
