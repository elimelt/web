// Markup for the HyperLogLog error-curve figure. The build renders the whole
// figure from the default precision; the client redraws the chart and the
// readout from the same functions when the reader changes it.

import { num } from "../../shared/format";
import { DEFAULT_P, simulate, TRIALS, type Curves } from "./model";

const W = 640;
const H = 300;
const M = { left: 52, right: 14, top: 18, bottom: 40 };

const pct = (x: number, digits = 1) => `${num(x * 100, digits)}%`;

export function yMax(m: number): number {
  const s = 4 * (1.04 / Math.sqrt(m));
  const steps = [0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 1.5];
  return steps.find((v) => v >= s) ?? 1.5;
}

export function chart(c: Curves): string {
  const { m, n } = c;
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const lx0 = 0;
  const lx1 = Math.log10(n[n.length - 1]);
  const ym = yMax(m);
  const x = (v: number) => M.left + ((Math.log10(v) - lx0) / (lx1 - lx0)) * pw;
  const y = (v: number) => M.top + (1 - (Math.max(-ym, Math.min(ym, v)) + ym) / (2 * ym)) * ph;
  const parts: string[] = [];
  // grid and axes
  const yticks = [-ym, -ym / 2, 0, ym / 2, ym];
  for (const t of yticks) {
    parts.push(`<line class="hle-grid${t === 0 ? " hle-zero" : ""}" x1="${M.left}" x2="${W - M.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`);
    parts.push(`<text class="hle-tick" x="${M.left - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t > 0 ? "+" : ""}${num(t * 100, 0)}%</text>`);
  }
  for (let e = 0; e <= Math.floor(lx1); e++) {
    const xv = x(10 ** e);
    parts.push(`<line class="hle-grid" x1="${xv.toFixed(1)}" x2="${xv.toFixed(1)}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    parts.push(`<text class="hle-tick" x="${xv.toFixed(1)}" y="${H - M.bottom + 15}" text-anchor="middle">${e <= 3 ? String(10 ** e) : `10${["⁰", "¹", "²", "³", "⁴", "⁵", "⁶"][e]}`}</text>`);
  }
  parts.push(`<text class="hle-axis" x="${M.left + pw / 2}" y="${H - 6}" text-anchor="middle">distinct keys inserted, n (log scale)</text>`);
  parts.push(`<text class="hle-axis" transform="translate(13 ${M.top + ph / 2}) rotate(-90)" text-anchor="middle">relative error</text>`);
  // regime markers
  for (const [f, label] of [[2.5, "5m/2"], [5, "5m"]] as const) {
    const xv = x(f * m);
    parts.push(`<line class="hle-mark" x1="${xv.toFixed(1)}" x2="${xv.toFixed(1)}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    parts.push(`<text class="hle-mark-label" x="${(xv + 3).toFixed(1)}" y="${M.top + 11}">${label}</text>`);
  }
  // theory band
  const s = 1.04 / Math.sqrt(m);
  for (const v of [s, -s]) parts.push(`<line class="hle-theory" x1="${M.left}" x2="${W - M.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(n[i]).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  // improved estimator: filled 5-95% band
  const e = c.q.ertl;
  const band = path(e.hi) + e.lo.map((v, i) => i).reverse().map((i) => `L${x(n[i]).toFixed(1)} ${y(e.lo[i]).toFixed(1)}`).join("") + "Z";
  parts.push(`<path class="hle-band" d="${band}"/>`);
  // original algorithm: dashed 5% and 95% lines
  parts.push(`<path class="hle-orig hle-orig-q" d="${path(c.q.orig.lo)}"/><path class="hle-orig hle-orig-q" d="${path(c.q.orig.hi)}"/>`);
  parts.push(`<path class="hle-raw" d="${path(c.q.raw.mid)}"/>`);
  parts.push(`<path class="hle-orig" d="${path(c.q.orig.mid)}"/>`);
  parts.push(`<path class="hle-ertl" d="${path(e.mid)}"/>`);
  const label = `Relative error of three HyperLogLog estimators against n for m = ${m} registers, ${c.trials} trials.`;
  return `<svg class="hle-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${parts.join("")}</svg>`;
}

const nearest = (c: Curves, target: number) => {
  let best = 0;
  for (let i = 0; i < c.n.length; i++) if (Math.abs(Math.log(c.n[i] / target)) < Math.abs(Math.log(c.n[best] / target))) best = i;
  return best;
};

export function readout(c: Curves): string {
  const m = c.m;
  const k = nearest(c, 2.5 * m);
  const z = nearest(c, 0.5 * m);
  const f = c.n.length - 1;
  const range = (lo: number, hi: number) => `${pct(lo)} to ${pct(hi)}`;
  return [
    `At n = ${c.n[z].toLocaleString("en-US")}, the raw estimate's median error is <strong>${pct(c.q.raw.mid[z], 0)}</strong>; linear counting and the improved estimator are within ${range(Math.min(c.q.orig.lo[z], c.q.ertl.lo[z]), Math.max(c.q.orig.hi[z], c.q.ertl.hi[z]))}.`,
    `At n = ${c.n[k].toLocaleString("en-US")} (5m/2), 90% of the 2007 algorithm's estimates lie in ${range(c.q.orig.lo[k], c.q.orig.hi[k])}, and of the improved estimator's in ${range(c.q.ertl.lo[k], c.q.ertl.hi[k])}.`,
    `At n = ${c.n[f].toLocaleString("en-US")} the improved estimator's standard error is ${pct(c.sd[f], 2)}; the asymptotic value 1.04/√m is ${pct(1.04 / Math.sqrt(m), 2)}.`,
  ].join(" ");
}

export interface Props {
  p?: number;
  seed?: number;
}

export function render(props: Props): string {
  const p = typeof props.p === "number" ? props.p : DEFAULT_P;
  const seed = typeof props.seed === "number" ? props.seed : 1;
  const c = simulate(p, TRIALS, seed);
  return [
    `<figure class="hle" data-p="${p}" data-seed="${seed}">`,
    `<div class="hle-controls">`,
    `<label class="hle-slider"><span>Precision p <output name="p-out">${p} (m = ${2 ** p} registers)</output></span><input type="range" name="p" min="4" max="10" step="1" value="${p}" disabled></label>`,
    `<button type="button" name="rerun" disabled>New trials</button>`,
    `</div>`,
    `<div class="hle-legend" aria-hidden="true"><span class="hle-key hle-key-raw">raw estimate, median</span><span class="hle-key hle-key-orig">2007 algorithm, median and 5–95%</span><span class="hle-key hle-key-ertl">improved estimator, median and 5–95%</span><span class="hle-key hle-key-theory">±1.04/√m</span></div>`,
    `<div class="hle-plot" data-part="chart">${chart(c)}</div>`,
    `<p class="hle-readout" data-part="readout" aria-live="polite">${readout(c)}</p>`,
    `<figcaption>Simulation: each of ${TRIALS} trials inserts n distinct keys whose 64-bit hash values come from a seeded generator, which is the input HyperLogLog sees from any key set under a good hash. The 2007 algorithm switches to linear counting below 5m/2 (Flajolet et al. 2007, Fig. 3); the improved estimator is that of Ertl (2017).</figcaption>`,
    `</figure>`,
  ].join("");
}
