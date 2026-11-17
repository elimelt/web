// Markup for the fan-out tail figure: a log-log plot of the fraction of
// requests slower than t, for one leaf, for the root as the independence
// assumption predicts it, and for the root as measured. The build draws the
// figure at its default fan-out; the client redraws it from the same
// functions when the reader moves the slider or switches the leaf
// distribution.

import { esc, num } from "../../shared/format";
import { BINS, cdf, edge, FANOUTS, leafFor, MEASURED, predictedCdf, summarize, type Basis, type Hist } from "./model";

export const W = 640;
export const H = 330;
const M = { left: 56, right: 14, top: 14, bottom: 42 };
const X0 = 20; // us
const X1 = 10000;
const Y0 = 1e-4; // smallest fraction drawn

const lx = (t: number) => M.left + (Math.log10(t / X0) / Math.log10(X1 / X0)) * (W - M.left - M.right);
const ly = (p: number) => M.top + (-Math.log10(Math.max(p, Y0)) / -Math.log10(Y0)) * (H - M.top - M.bottom);

export function us(t: number): string {
  return t >= 1000 ? `${num(t / 1000, t >= 10000 ? 0 : 2)} ms` : `${num(t, 0)} µs`;
}

const pct = (p: number) => (p >= 0.995 ? `${num(p * 100, 1)}%` : `${num(p * 100, p < 0.1 ? 1 : 0)}%`);

/** SVG path of the survival function 1 - F(t), evaluated at every bin edge in range. */
function survival(f: (t: number) => number): string {
  const pts: string[] = [];
  for (let i = 0; i <= BINS; i++) {
    const t = edge(i);
    if (t < X0 || t > X1) continue;
    const s = 1 - f(t);
    if (s < Y0) {
      pts.push(`${pts.length ? "L" : "M"}${lx(t).toFixed(1)} ${ly(Y0).toFixed(1)}`);
      break;
    }
    pts.push(`${pts.length ? "L" : "M"}${lx(t).toFixed(1)} ${ly(s).toFixed(1)}`);
  }
  return pts.join("");
}

export function chart(k: number, basis: Basis): string {
  const s = summarize(k, basis);
  const leaf = leafFor(k, s.basis);
  const alone: Hist = FANOUTS[1].leaf;
  const parts: string[] = [];
  for (const t of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = lx(t).toFixed(1);
    parts.push(`<line class="ft-grid" x1="${x}" x2="${x}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    const minor = t === 20 || t === 200 || t === 2000 || t === 5000 ? " ft-minor" : "";
    parts.push(`<text class="ft-tick${minor}" x="${x}" y="${H - M.bottom + 15}" text-anchor="middle">${t >= 1000 ? `${t / 1000} ms` : t}</text>`);
  }
  for (let e = 0; e <= 4; e++) {
    const y = ly(10 ** -e).toFixed(1);
    parts.push(`<line class="ft-grid" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text class="ft-tick" x="${M.left - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${["1", "0.1", "0.01", "10⁻³", "10⁻⁴"][e]}</text>`);
  }
  for (const [p, label] of [
    [0.5, "median"],
    [0.01, "p99"],
  ] as const) {
    const y = ly(p).toFixed(1);
    parts.push(`<line class="ft-guide" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text class="ft-guide-label" x="${W - M.right - 4}" y="${(+y - 4).toFixed(1)}" text-anchor="end">${label}</text>`);
  }
  const xp = lx(s.leafP99).toFixed(1);
  parts.push(`<line class="ft-guide" x1="${xp}" x2="${xp}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  parts.push(`<text class="ft-guide-label" x="${(+xp - 4).toFixed(1)}" y="${(ly(10 ** -3.5) + 4).toFixed(1)}" text-anchor="end">one leaf's p99</text>`);
  parts.push(`<text class="ft-axis" x="${(M.left + W - M.right) / 2}" y="${H - 6}" text-anchor="middle">latency t (log scale)</text>`);
  const ym = (M.top + H - M.bottom) / 2;
  parts.push(`<text class="ft-axis" x="13" y="${ym}" text-anchor="middle" transform="rotate(-90 13 ${ym})">fraction slower than t</text>`);

  parts.push(`<path class="ft-leaf" d="${survival((t) => cdf(alone, t))}"/>`);
  if (s.basis === "loaded") parts.push(`<path class="ft-leaf ft-leaf-loaded" d="${survival((t) => cdf(leaf, t))}"/>`);
  parts.push(`<path class="ft-pred" d="${survival((t) => predictedCdf(leaf, k, t))}"/>`);
  if (FANOUTS[k]) parts.push(`<path class="ft-meas" d="${survival((t) => cdf(FANOUTS[k].root, t))}"/>`);
  const label = `Fraction of requests slower than t: one leaf, and the root at fan-out ${k}, predicted${FANOUTS[k] ? " and measured" : ""}.`;
  return `<svg class="ft-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

export function readout(k: number, basis: Basis): string {
  const s = summarize(k, basis);
  const from = s.basis === "loaded" ? `leaves measured at fan-out ${k}` : "one leaf measured alone";
  const rows = [
    ["median", us(s.pred.p50), s.meas ? us(s.meas.p50) : "not measured"],
    ["p99", us(s.pred.p99), s.meas ? us(s.meas.p99) : "not measured"],
    [`slower than ${us(s.leafP99)}`, pct(s.pred.slow), s.meas ? pct(s.meas.slow) : "not measured"],
  ];
  return [
    `<table class="ft-table"><thead><tr><th>Root, fan-out ${k}</th><th>Independent (${esc(from)})</th><th>Measured</th></tr></thead><tbody>`,
    ...rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`),
    `</tbody></table>`,
  ].join("");
}

export interface Props {
  k?: number;
}

export function render(props: Props): string {
  const k = typeof props.k === "number" && props.k >= 1 && props.k <= 64 ? Math.round(props.k) : 16;
  const basis: Basis = "alone";
  return [
    `<figure class="ft" data-k="${k}">`,
    `<div class="ft-controls">`,
    `<label class="ft-slider"><span>Fan-out k <output name="k-out">${k}</output></span><input type="range" name="k" min="1" max="64" step="1" value="${k}" disabled></label>`,
    `<div class="ft-basis" role="group" aria-label="Leaf distribution for the prediction">`,
    `<button type="button" name="alone" aria-pressed="true" disabled>leaf measured alone</button>`,
    `<button type="button" name="loaded" aria-pressed="false" disabled>leaf measured at this fan-out</button>`,
    `</div>`,
    `</div>`,
    `<div class="ft-legend" aria-hidden="true"><span class="ft-key ft-key-leaf">one leaf, alone</span><span class="ft-key ft-key-loaded">one leaf at this fan-out</span><span class="ft-key ft-key-pred">root, independent leaves</span><span class="ft-key ft-key-meas">root, measured (k = ${MEASURED.join(", ")})</span></div>`,
    `<div class="ft-plot" data-part="chart">${chart(k, basis)}</div>`,
    `<div class="ft-readout" data-part="readout" aria-live="polite">${readout(k, basis)}</div>`,
    `<figcaption>Recorded data, replayed: 60,000 root requests per fan-out (three runs of 20,000) from a Go client to 64 redis-server processes on one 4-vCPU VM, each request a GET sent to k distinct servers at once. The independent curve is F(t)<sup>k</sup>, computed in the page from the recorded single-leaf distribution; the measured curve is the root's own recorded latency. Measured fan-outs: ${MEASURED.join(", ")}; at other k only the prediction is drawn.</figcaption>`,
    `</figure>`,
  ].join("");
}
