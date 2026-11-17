// Markup for the scaling-fit figure. The build renders the whole figure for
// the default dataset; the client redraws the chart and the readout from the
// same functions when the reader picks another dataset or fit range.

import { esc, num } from "../../shared/format";
import { DATASETS, DEFAULT_KEY } from "./data";
import { fitUpTo, karpFlatt, medians, nPeak, shape, type Dataset, type Fit } from "./model";

export interface Props {
  dataset?: unknown;
}

const W = 640;
const H = 300;
const M = { left: 46, right: 14, top: 14, bottom: 40 };

export const datasetFor = (key: unknown): Dataset => DATASETS.find((d) => d.key === key) ?? (DATASETS.find((d) => d.key === DEFAULT_KEY) as Dataset);

/** Distinct N values of a dataset, for the fit-range slider. */
export const levels = (d: Dataset): number[] => medians(d).map((m) => m.n);

const niceStep = (span: number, target: number): number => {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
};

export function fmtSig(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "∞";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    return `${num(v / 10 ** e, digits - 1)}×10<sup>${String(e).replace("-", "−")}</sup>`;
  }
  return num(v, Math.max(0, digits - 1 - Math.floor(Math.log10(a))));
}

export interface View {
  d: Dataset;
  nMax: number;
  amdahl: Fit;
  usl: Fit;
  base: number; // median throughput at N = 1, the speedup baseline
}

export function view(d: Dataset, nMax: number): View {
  const { amdahl, usl } = fitUpTo(d, nMax);
  const base = medians(d)[0].x;
  return { d, nMax, amdahl, usl, base };
}

export function chart(v: View): string {
  const { d, nMax, amdahl, usl, base } = v;
  const pts = medians(d);
  const xMax = d.extrapolate;
  const curve = (f: Fit, n: number) => (f.gamma * shape(n, f.sigma, f.kappa)) / base;
  const samples: number[] = [];
  for (let i = 0; i <= 160; i++) samples.push(1 + ((xMax - 1) * i) / 160);
  const yTop = Math.max(...pts.map((p) => p.hi / base), ...samples.map((n) => Math.max(curve(amdahl, n), curve(usl, n)))) * 1.08;
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const x = (n: number) => M.left + (n / xMax) * pw;
  const y = (s: number) => M.top + (1 - Math.min(s, yTop) / yTop) * ph;
  const out: string[] = [`<svg viewBox="0 0 ${W} ${H}" class="sf-chart" role="img" aria-label="${esc(`Measured speedup and fitted curves for ${d.label}`)}">`];
  const ys = niceStep(yTop, 5);
  for (let t = 0; t <= yTop + 1e-9; t += ys) {
    out.push(`<line class="sf-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`);
    out.push(`<text class="sf-tick" x="${M.left - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${+t.toFixed(2)}</text>`);
  }
  const xs = niceStep(xMax, 8);
  for (let t = 0; t <= xMax + 1e-9; t += xs) {
    out.push(`<text class="sf-tick" x="${x(t).toFixed(1)}" y="${H - M.bottom + 16}" text-anchor="middle">${t}</text>`);
  }
  out.push(`<text class="sf-axis" x="${M.left + pw / 2}" y="${H - 5}" text-anchor="middle">${esc(d.xLabel)}, N</text>`);
  out.push(`<text class="sf-axis" transform="translate(12 ${M.top + ph / 2}) rotate(-90)" text-anchor="middle">speedup over N = 1</text>`);
  // shaded region beyond the fitted range
  const xr = x(nMax);
  out.push(`<rect class="sf-held" x="${xr.toFixed(1)}" y="${M.top}" width="${(W - M.right - xr).toFixed(1)}" height="${ph}"/>`);
  out.push(`<text class="sf-note" x="${(xr + 5).toFixed(1)}" y="${M.top + 13}">${nMax < pts[pts.length - 1].n ? "held out" : "extrapolated"}</text>`);
  // ideal linear speedup
  const lin = Math.min(xMax, yTop);
  out.push(`<line class="sf-linear" x1="${x(1).toFixed(1)}" y1="${y(1).toFixed(1)}" x2="${x(lin).toFixed(1)}" y2="${y(lin).toFixed(1)}"/>`);
  const path = (f: Fit) => samples.map((n, i) => `${i ? "L" : "M"}${x(n).toFixed(1)} ${y(curve(f, n)).toFixed(1)}`).join("");
  out.push(`<path class="sf-amdahl" d="${path(amdahl)}"/>`);
  out.push(`<path class="sf-usl" d="${path(usl)}"/>`);
  for (const p of pts) {
    const cx = x(p.n).toFixed(1);
    if (p.hi > p.lo) out.push(`<line class="sf-whisker" x1="${cx}" x2="${cx}" y1="${y(p.lo / base).toFixed(1)}" y2="${y(p.hi / base).toFixed(1)}"/>`);
    out.push(`<circle class="${p.n <= nMax ? "sf-pt" : "sf-pt sf-out"}" cx="${cx}" cy="${y(p.x / base).toFixed(1)}" r="3.6"/>`);
  }
  out.push(`</svg>`);
  return out.join("");
}

export function readout(v: View): string {
  const { d, nMax, amdahl, usl, base } = v;
  const pts = medians(d);
    const pred = (f: Fit, n: number) => (f.gamma * shape(n, f.sigma, f.kappa)) / base;
  const np = nPeak(usl.sigma, usl.kappa);
  const rows = [
    `<tr><th scope="row"><span class="sf-key sf-key-amdahl"></span>Amdahl (κ = 0)</th><td>${fmtSig(amdahl.sigma)}</td><td>0</td><td>${amdahl.sigma > 0 ? fmtSig(amdahl.gamma / amdahl.sigma / base) + "×" : "none"}</td></tr>`,
    `<tr><th scope="row"><span class="sf-key sf-key-usl"></span>USL</th><td>${fmtSig(usl.sigma)}</td><td>${fmtSig(usl.kappa)}</td><td>${Number.isFinite(np) ? `${fmtSig(pred(usl, np))}× at N ≈ ${np < 100 ? num(np, 1) : num(np, 0)}` : usl.sigma > 0 ? fmtSig(usl.gamma / usl.sigma / base) + "×" : "none"}</td></tr>`,
  ].join("");
  const kf = pts
    .filter((p) => p.n > 1)
    .map((p) => `<td class="${p.n <= nMax ? "" : "sf-dim"}"><span>N = ${p.n}</span>${num(karpFlatt(p.x / base, p.n), 3)}</td>`)
    .join("");
  return (
    `<table class="sf-table"><thead><tr><th scope="col">fit to N ≤ ${nMax}</th><th scope="col">σ</th><th scope="col">κ</th><th scope="col">limit of the fit</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="sf-kf"><div class="sf-kf-label">Karp–Flatt serial fraction e from the measured medians</div><table class="sf-table sf-kf-table"><tbody><tr>${kf}</tr></tbody></table></div>` +
    `<p class="sf-source">${esc(d.source)}</p>`
  );
}

export function render(props: Props): string {
  const d = datasetFor(props.dataset);
  const lv = levels(d);
  const nMax = lv[lv.length - 1];
  const v = view(d, nMax);
  const choices = DATASETS.map(
    (s) => `<button type="button" name="ds-${esc(s.key)}" data-key="${esc(s.key)}" aria-pressed="${s.key === d.key}" disabled>${esc(s.label)}</button>`,
  ).join("");
  return `<figure class="sf" data-dataset="${esc(d.key)}">
<div class="sf-choices" role="group" aria-label="Dataset">${choices}</div>
<label class="sf-slider"><span>Fit to the points with N ≤ <output name="nmax-out">${nMax}</output></span><input type="range" name="nmax" min="2" max="${lv.length - 1}" step="1" value="${lv.length - 1}" disabled></label>
<div class="sf-legend"><span class="sf-key sf-key-pt">measured median (min–max)</span><span class="sf-key sf-key-amdahl">Amdahl fit</span><span class="sf-key sf-key-usl">USL fit</span><span class="sf-key sf-key-linear">linear</span></div>
<div data-part="chart">${chart(v)}</div>
<div data-part="readout">${readout(v)}</div>
<figcaption>Both models are fitted by least squares to every run's throughput at the N values left of the shaded region, in the browser. Points in the shaded region are not used in the fit. The USL has three parameters, so the smallest fit range holds three distinct values of N, which the USL then passes through exactly.</figcaption>
</figure>`;
}
