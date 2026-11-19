// Markup for the hash-family figure. The build renders the figure for the
// default key set and n; the client redraws the two charts and the readout
// from the same functions.

import { esc, num } from "../../shared/format";
import { FAMILIES, floorTest, KEYSETS, M, modelHist, simulate, TRIALS, type Family, type KeySet, type Result } from "./model";

export const DEFAULT_KS: KeySet = "dense";
export const DEFAULT_LOGN = 16;
export const DEFAULT_SHOW: Family = "ms";

const W = 600;
const SE = 1.04 / Math.sqrt(M);
const pct = (x: number, d = 1) => `${x > 0 ? "+" : ""}${num(x * 100, d)}%`;

/** Ratio axis: log2(estimate / n) from -2 to +2. */
const LMIN = -2;
const LMAX = 2;

export function strip(r: Result): string {
  const L = { left: 132, right: 56, top: 22, row: 26, bottom: 34 };
  const H = L.top + L.row * r.rows.length + L.bottom;
  const pw = W - L.left - L.right;
  const x = (e: number) => {
    const l = Math.log2(Math.max(1e-9, 1 + e));
    return L.left + ((Math.max(LMIN, Math.min(LMAX, l)) - LMIN) / (LMAX - LMIN)) * pw;
  };
  const parts: string[] = [];
  const yb = H - L.bottom;
  parts.push(`<rect class="hfam-band" x="${x(-SE * 2).toFixed(1)}" y="${L.top - 6}" width="${(x(SE * 2) - x(-SE * 2)).toFixed(1)}" height="${(yb - L.top + 6).toFixed(1)}"/>`);
  for (const [ratio, label] of [[0.25, "¼"], [0.5, "½"], [1, "1"], [2, "2"], [4, "4"]] as const) {
    const xv = x(ratio - 1);
    parts.push(`<line class="hfam-grid${ratio === 1 ? " hfam-one" : ""}" x1="${xv.toFixed(1)}" x2="${xv.toFixed(1)}" y1="${L.top - 6}" y2="${yb}"/>`);
    parts.push(`<text class="hfam-tick" x="${xv.toFixed(1)}" y="${yb + 15}" text-anchor="middle">${label}</text>`);
  }
  parts.push(`<text class="hfam-axis" x="${L.left + pw / 2}" y="${H - 4}" text-anchor="middle">estimate ÷ n (log scale)</text>`);
  parts.push(`<text class="hfam-axis" x="${W - 4}" y="${L.top - 8}" text-anchor="end">rms error</text>`);
  r.rows.forEach((row, i) => {
    const yc = L.top + L.row * i + L.row / 2;
    const name = FAMILIES.find((f) => f.id === row.family)!.short;
    parts.push(`<text class="hfam-label" x="${L.left - 8}" y="${(yc + 4).toFixed(1)}" text-anchor="end">${esc(name)}</text>`);
    parts.push(`<line class="hfam-rule" x1="${L.left}" x2="${W - L.right}" y1="${yc.toFixed(1)}" y2="${yc.toFixed(1)}"/>`);
    row.errors.forEach((e, t) => {
      const jitter = ((t * 7) % 9 - 4) * 1.6;
      const out = Math.log2(Math.max(1e-9, 1 + e)) < LMIN || Math.log2(1 + e) > LMAX;
      parts.push(`<circle class="hfam-dot${out ? " hfam-clip" : ""}" cx="${x(e).toFixed(1)}" cy="${(yc + jitter).toFixed(1)}" r="2.6"/>`);
    });
    parts.push(`<line class="hfam-med" x1="${x(row.median).toFixed(1)}" x2="${x(row.median).toFixed(1)}" y1="${(yc - 9).toFixed(1)}" y2="${(yc + 9).toFixed(1)}"/>`);
    const bad = row.rms > 2 * SE;
    parts.push(`<text class="hfam-rms${bad ? " hfam-bad" : ""}" x="${W - 4}" y="${(yc + 4).toFixed(1)}" text-anchor="end">${num(row.rms * 100, row.rms < 0.1 ? 1 : 0)}%</text>`);
  });
  const label = `Relative error of HyperLogLog with ${M} registers under seven hash families, ${TRIALS} seeds each, for n = ${r.n} keys.`;
  return `<svg class="hfam-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${parts.join("")}</svg>`;
}

export function histogram(r: Result, show: Family): string {
  const row = r.rows.find((x) => x.family === show)!;
  const model = modelHist(r.n);
  const L = { left: 46, right: 12, top: 14, bottom: 38 };
  const H = 200;
  let k0 = model.length - 1;
  let k1 = 0;
  for (let k = 0; k < model.length; k++) {
    if (model[k] > 0.002 || row.hist[k] > 0.002) {
      k0 = Math.min(k0, k);
      k1 = Math.max(k1, k);
    }
  }
  const pw = W - L.left - L.right;
  const ph = H - L.top - L.bottom;
  const ymax = Math.max(0.5, ...row.hist.slice(k0, k1 + 1), ...model.slice(k0, k1 + 1));
  const ytop = Math.ceil(ymax * 10) / 10;
  const bw = pw / (k1 - k0 + 1);
  const xc = (k: number) => L.left + (k - k0 + 0.5) * bw;
  const y = (v: number) => L.top + (1 - v / ytop) * ph;
  const parts: string[] = [];
  for (let t = 0; t <= ytop + 1e-9; t += ytop > 0.5 ? 0.2 : 0.1) {
    parts.push(`<line class="hfam-grid" x1="${L.left}" x2="${W - L.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`);
    parts.push(`<text class="hfam-tick" x="${L.left - 5}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${num(t, 1)}</text>`);
  }
  for (let k = k0; k <= k1; k++) {
    const h = row.hist[k];
    parts.push(`<rect class="hfam-bar" x="${(xc(k) - bw * 0.36).toFixed(1)}" y="${y(h).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${(y(0) - y(h)).toFixed(1)}"/>`);
    parts.push(`<circle class="hfam-model" cx="${xc(k).toFixed(1)}" cy="${y(model[k]).toFixed(1)}" r="3.4"/>`);
    parts.push(`<text class="hfam-tick" x="${xc(k).toFixed(1)}" y="${H - L.bottom + 15}" text-anchor="middle">${k}</text>`);
  }
  parts.push(`<text class="hfam-axis" x="${L.left + pw / 2}" y="${H - 6}" text-anchor="middle">register value</text>`);
  parts.push(`<text class="hfam-axis" transform="translate(12 ${L.top + ph / 2}) rotate(-90)" text-anchor="middle">fraction</text>`);
  const label = `Register values for the median seed under ${FAMILIES.find((f) => f.id === show)!.long}, against the distribution under a random hash.`;
  return `<svg class="hfam-chart hfam-hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

export function readout(r: Result, show: Family): string {
  const row = r.rows.find((x) => x.family === show)!;
  const fam = FAMILIES.find((f) => f.id === show)!.long;
  const { k, p } = floorTest(r.n);
  const floored = row.mins.filter((x) => x >= k).length;
  const odds = p < 1e-6 ? `about one in ${Math.round(1 / p / 1e6).toLocaleString("en-US")} million` : `about one in ${Math.round(1 / p).toLocaleString("en-US")}`;
  const good = r.rows.filter((x) => x.rms <= 2 * SE).map((x) => FAMILIES.find((f) => f.id === x.family)!.label);
  return [
    `With ${fam}, the median estimate over ${TRIALS} seeds is off by <strong>${pct(row.median)}</strong> and the rms error is ${num(row.rms * 100, 1)}%, against 1.04/√m = ${num(SE * 100, 2)}%.`,
    `A random hash leaves all ${M} registers at ${k} or above with probability ${odds}; ${floored} of the ${TRIALS} seeds here do.`,
    good.length === r.rows.length
      ? "Every family is within twice the random-hash error on this key set."
      : `Within twice the random-hash error: ${good.length ? good.join(", ") : "none"}.`,
  ].join(" ");
}

export interface Props {
  seed?: number;
}

export function render(props: Props): string {
  const seed = typeof props.seed === "number" ? props.seed : 1;
  const n = 2 ** DEFAULT_LOGN;
  const r = simulate(DEFAULT_KS, n, seed);
  const opts = (items: { id: string; label: string }[], sel: string) =>
    items.map((o) => `<option value="${o.id}"${o.id === sel ? " selected" : ""}>${esc(o.label)}</option>`).join("");
  return [
    `<figure class="hfam" data-seed="${seed}">`,
    `<div class="hfam-controls">`,
    `<label class="hfam-select"><span>Keys</span><select name="ks" disabled>${opts(KEYSETS, DEFAULT_KS)}</select></label>`,
    `<label class="hfam-slider"><span>Number of keys n <output name="n-out">${n.toLocaleString("en-US")}</output></span><input type="range" name="logn" min="12" max="18" step="1" value="${DEFAULT_LOGN}" disabled></label>`,
    `<button type="button" name="rerun" disabled>New seeds</button>`,
    `</div>`,
    `<div class="hfam-legend" aria-hidden="true"><span class="hfam-key hfam-key-dot">one seed</span><span class="hfam-key hfam-key-med">median</span><span class="hfam-key hfam-key-band">±2 × 1.04/√m</span></div>`,
    `<div class="hfam-plot" data-part="strip">${strip(r)}</div>`,
    `<div class="hfam-controls hfam-sub"><label class="hfam-select"><span>Register values under</span><select name="show" disabled>${opts(FAMILIES, DEFAULT_SHOW)}</select></label>`,
    `<div class="hfam-legend" aria-hidden="true"><span class="hfam-key hfam-key-bar">seed with the median estimate</span><span class="hfam-key hfam-key-model">random hash</span></div></div>`,
    `<div class="hfam-plot" data-part="hist">${histogram(r, DEFAULT_SHOW)}</div>`,
    `<p class="hfam-readout" data-part="readout" aria-live="polite">${readout(r, DEFAULT_SHOW)}</p>`,
    `<figcaption>Simulation in the browser: 32-bit versions of the hash families feed a HyperLogLog sketch with m = ${M} registers and Ertl's estimator, ${TRIALS} independent seeds per family. The keys are integers, not the pageview data; scrambled IDs are 0, …, n − 1 passed through a fixed invertible mixing function.</figcaption>`,
    `</figure>`,
  ].join("");
}
