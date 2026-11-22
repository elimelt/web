// Build-time markup and the pure drawing functions of the MinHash and LSH figure.

import { esc, num } from "../../shared/format";
import initialJson from "../../../../../../content/algorithms/probabilistic/minhash-experiments/initial.json";
import metaJson from "../../../../../../content/algorithms/probabilistic/minhash-experiments/meta.json";
import { BINS, K, sCurve, threshold, type Bin } from "./model";

interface Full {
  candidates: number;
  recall08: number;
  recall05: number;
  candGe08: number;
  candLt03: number;
}
interface Meta {
  pairs: number;
  docs: number;
  allPairs: number;
  pairsGe08: number;
  full: Record<string, Full>;
}
export const META = metaJson as Meta;
const INITIAL = initialJson as { b: number; r: number; J: number[]; matches: number[]; candidate: number[]; bins: Bin[] };

export const DEFAULT_B = INITIAL.b;
export const DEFAULT_R = INITIAL.r;

export interface View {
  b: number;
  r: number;
  J: ArrayLike<number>;
  estimate: ArrayLike<number>;
  candidate: ArrayLike<number>;
  bins: Bin[];
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number, d = 1) => `${num(100 * v, d)}%`;

/** Measured candidate fraction per similarity bin against the S-curve 1 - (1 - s^r)^b. */
export function curveChart(v: View, narrow: boolean): string {
  const W = narrow ? 360 : 600;
  const L = { left: narrow ? 40 : 48, right: 14, top: 12 };
  const ph = narrow ? 170 : 190;
  const H = L.top + ph + 34;
  const pw = W - L.left - L.right;
  const x = (s: number) => L.left + s * pw;
  const y = (p: number) => L.top + (1 - p) * ph;
  const parts: string[] = [];
  for (let g = 0; g <= 1.0001; g += 0.25) {
    parts.push(`<line class="ml-grid" x1="${L.left}" x2="${W - L.right}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}"/>`);
    parts.push(`<text class="ml-tick" x="${L.left - 6}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end">${num(g, 2)}</text>`);
  }
  for (let g = 0; g <= 1.0001; g += 0.2) {
    parts.push(`<line class="ml-grid" x1="${x(g).toFixed(1)}" x2="${x(g).toFixed(1)}" y1="${L.top}" y2="${L.top + ph}"/>`);
    parts.push(`<text class="ml-tick" x="${x(g).toFixed(1)}" y="${L.top + ph + 15}" text-anchor="middle">${num(g, 1)}</text>`);
  }
  const th = threshold(v.b, v.r);
  if (th <= 1) {
    parts.push(`<line class="ml-th" x1="${x(th).toFixed(1)}" x2="${x(th).toFixed(1)}" y1="${L.top}" y2="${L.top + ph}"/>`);
    // Left of the threshold the curve is low, so the label sits at the top on
    // that side; for a threshold near 0 it moves to the bottom right instead.
    const left = th >= 0.3;
    parts.push(`<text class="ml-tick ml-th-label" x="${(x(th) + (left ? -5 : 5)).toFixed(1)}" y="${left ? L.top + 12 : L.top + ph - 8}" text-anchor="${left ? "end" : "start"}">(1/b)<tspan dy="-4" font-size="80%">1/r</tspan><tspan dy="4"> = ${num(th, 3)}</tspan></text>`);
  }
  const pts: string[] = [];
  for (let i = 0; i <= 200; i++) {
    const s = i / 200;
    pts.push(`${x(s).toFixed(1)},${y(sCurve(s, v.b, v.r)).toFixed(1)}`);
  }
  parts.push(`<polyline class="ml-curve" points="${pts.join(" ")}"/>`);
  v.bins.forEach((bin, j) => {
    if (!bin.pairs) return;
    const cx = x((j + 0.5) / BINS);
    parts.push(`<circle class="ml-point" cx="${cx.toFixed(1)}" cy="${y(bin.candidates / bin.pairs).toFixed(1)}" r="4"/>`);
  });
  parts.push(`<text class="ml-axis" x="${L.left + pw / 2}" y="${H - 3}" text-anchor="middle">Jaccard similarity of the pair</text>`);
  const aria = `Share of pairs that become candidates in each similarity bin with ${v.b} bands of ${v.r} rows, against the curve 1 - (1 - s^${v.r})^${v.b}.`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

/** MinHash estimate from the b * r hash functions against the exact similarity, candidates highlighted. */
export function scatter(v: View, narrow: boolean): string {
  const W = narrow ? 360 : 600;
  const L = { left: narrow ? 40 : 48, right: 14, top: 10 };
  const ph = narrow ? 200 : 220;
  const H = L.top + ph + 34;
  const pw = W - L.left - L.right;
  const x = (s: number) => L.left + s * pw;
  const y = (p: number) => L.top + (1 - p) * ph;
  const k = v.b * v.r;
  const parts: string[] = [];
  for (let g = 0; g <= 1.0001; g += 0.25) {
    parts.push(`<line class="ml-grid" x1="${L.left}" x2="${W - L.right}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}"/>`);
    parts.push(`<text class="ml-tick" x="${L.left - 6}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end">${num(g, 2)}</text>`);
  }
  for (let g = 0; g <= 1.0001; g += 0.2) {
    parts.push(`<text class="ml-tick" x="${x(g).toFixed(1)}" y="${L.top + ph + 15}" text-anchor="middle">${num(g, 1)}</text>`);
  }
  const band = (sign: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= 100; i++) {
      const s = i / 100;
      const e = Math.min(1, Math.max(0, s + sign * 2 * Math.sqrt((s * (1 - s)) / k)));
      pts.push(`${x(s).toFixed(1)},${y(e).toFixed(1)}`);
    }
    return `<polyline class="ml-band" points="${pts.join(" ")}"/>`;
  };
  parts.push(band(1), band(-1));
  parts.push(`<line class="ml-diag" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"/>`);
  for (let i = 0; i < v.J.length; i++) {
    parts.push(`<circle class="ml-dot ${v.candidate[i] ? "ml-cand" : "ml-not"}" cx="${x(v.J[i]).toFixed(1)}" cy="${y(v.estimate[i]).toFixed(1)}" r="1.8"/>`);
  }
  parts.push(`<text class="ml-axis" x="${L.left + pw / 2}" y="${H - 3}" text-anchor="middle">Jaccard similarity of the pair</text>`);
  const aria = `MinHash estimates from ${k} hash functions against the exact similarity for ${v.J.length} pairs.`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

function count(v: View, test: (s: number) => boolean): { pairs: number; cand: number } {
  let pairs = 0;
  let cand = 0;
  for (let i = 0; i < v.J.length; i++) {
    if (test(v.J[i])) {
      pairs++;
      cand += v.candidate[i] ? 1 : 0;
    }
  }
  return { pairs, cand };
}

export function readout(v: View): string {
  const k = v.b * v.r;
  const hi = count(v, (s) => s >= 0.8);
  const lo = count(v, (s) => s < 0.3);
  let sq = 0;
  for (let i = 0; i < v.J.length; i++) sq += (v.estimate[i] - v.J[i]) ** 2;
  const rmse = Math.sqrt(sq / v.J.length);
  const full = META.full[`${v.b}x${v.r}`];
  const fullText = full
    ? `<p>On the full crawl of ${fmt(META.docs)} pages, these settings made ${fmt(full.candidates)} candidate pairs out of ${fmt(META.allPairs)}, ${pct(full.candidates / META.allPairs, 3)} of all pairs, and found ${pct(full.recall08, 2)} of the ${fmt(META.pairsGe08)} pairs with similarity 0.8 or more.</p>`
    : "";
  return (
    `<p>With ${v.b} band${v.b === 1 ? "" : "s"} of ${v.r} row${v.r === 1 ? "" : "s"}, using ${k} of the ${K} hash functions, ${fmt(count(v, () => true).cand)} of the ${fmt(v.J.length)} pairs are candidates: <strong>${fmt(hi.cand)} of ${fmt(hi.pairs)}</strong> with similarity 0.8 or more and <strong>${fmt(lo.cand)} of ${fmt(lo.pairs)}</strong> below 0.3. ` +
    `The MinHash estimate from the same ${k} functions is off by ${num(rmse, 3)} on average (root mean square).</p>` +
    fullText
  );
}

export function initialView(): View {
  return {
    b: INITIAL.b,
    r: INITIAL.r,
    J: INITIAL.J.map((j) => j / 1e4),
    estimate: INITIAL.matches.map((m) => m / (INITIAL.b * INITIAL.r)),
    candidate: INITIAL.candidate,
    bins: INITIAL.bins.map((bin, j) => ({ ...bin, lo: j / BINS, hi: (j + 1) / BINS })),
  };
}

export function render(props: { base?: string }): string {
  const base = props.base ?? "";
  const v = initialView();
  return [
    `<figure class="ml" data-base="${esc(base)}">`,
    `<div class="ml-controls">`,
    `<label class="ml-slider"><span>Bands <i>b</i> <output name="b-out">${DEFAULT_B}</output></span><input type="range" name="b" min="1" max="${K}" step="1" value="${DEFAULT_B}" disabled></label>`,
    `<label class="ml-slider"><span>Rows per band <i>r</i> <output name="r-out">${DEFAULT_R}</output></span><input type="range" name="r" min="1" max="32" step="1" value="${DEFAULT_R}" disabled></label>`,
    `</div>`,
    `<p class="ml-title">Share of pairs that become candidates, by similarity</p>`,
    `<div class="ml-legend"><span class="ml-key ml-key-curve">1 − (1 − <i>s</i><sup><i>r</i></sup>)<sup><i>b</i></sup></span><span class="ml-key ml-key-point">measured, ${BINS} bins of about 100 pairs</span></div>`,
    `<div class="ml-chart" data-part="curve">${curveChart(v, false)}</div>`,
    `<div class="ml-readout" data-part="readout" aria-live="polite">${readout(v)}</div>`,
    `<p class="ml-title">MinHash estimate from the <span data-part="k">${v.b * v.r}</span> hash functions in use</p>`,
    `<div class="ml-legend"><span class="ml-key ml-key-cand">candidate</span><span class="ml-key ml-key-not">not a candidate</span><span class="ml-key ml-key-band">±2 standard deviations, √(<i>s</i>(1 − <i>s</i>)/<i>k</i>)</span></div>`,
    `<div class="ml-chart" data-part="scatter">${scatter(v, false)}</div>`,
    `<figcaption>Each point is a pair of front pages from the crawl, ${fmt(META.pairs)} pairs in all, 100 drawn from each similarity bin of width 0.05, with no page in two pairs. Their ${K} MinHash agreements were recorded once; the figure groups the first <i>b</i>·<i>r</i> of them into <i>b</i> bands of <i>r</i> and marks a pair as a candidate when all <i>r</i> agree in at least one band. The product <i>b</i>·<i>r</i> is held at ${K} or less.</figcaption>`,
    `</figure>`,
  ].join("");
}
