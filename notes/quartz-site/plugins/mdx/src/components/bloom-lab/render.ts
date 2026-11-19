// Markup for the Bloom filter figure. The build renders the default settings;
// the client redraws from the same functions as the measured points arrive.

import { esc, num } from "../../shared/format";
import { build, fprStandard, has, KMAX, LAYOUTS, probes, sweep, theory, wilson, type Filter, type Layout, type Point } from "./model";

export const DEFAULT_LAYOUT: Layout = "blocked512";
export const DEFAULT_B = 10;
export const DEFAULT_K = 7;
export const BMIN = 4;
export const BMAX = 20;

/** The small filter drawn bit by bit: 32 words of 64 bits. */
export const SMALL = 2048;

const W = 600;
const YMIN = -5;
const pctf = (p: number) => (p >= 0.1 ? `${num(p * 100, 1)}%` : p >= 0.001 ? `${num(p * 100, 2)}%` : `${num(p * 100, 4)}%`);
const label = (l: Layout) => LAYOUTS.find((x) => x.id === l)!.label;

export function chart(layout: Layout, b: number, k: number, pts: (Point | undefined)[]): string {
  const L = { left: 52, right: 14, top: 14, bottom: 40 };
  const H = 250;
  const pw = W - L.left - L.right;
  const ph = H - L.top - L.bottom;
  const x = (kk: number) => L.left + ((kk - 0.5) / KMAX) * pw;
  const y = (p: number) => L.top + (-Math.log10(Math.max(p, 10 ** YMIN)) / -YMIN) * ph;
  const parts: string[] = [];
  for (let e = 0; e >= YMIN; e--) {
    parts.push(`<line class="bl-grid" x1="${L.left}" x2="${W - L.right}" y1="${y(10 ** e).toFixed(1)}" y2="${y(10 ** e).toFixed(1)}"/>`);
    const t = e === 0 ? "1" : e >= -2 ? `${num(100 * 10 ** e, 0)}%` : `10<tspan dy="-5" font-size="0.75em">${num(e, 0)}</tspan>`;
    parts.push(`<text class="bl-tick" x="${L.left - 6}" y="${(y(10 ** e) + 4).toFixed(1)}" text-anchor="end">${t}</text>`);
  }
  for (let kk = 1; kk <= KMAX; kk++) {
    if (kk === 1 || kk % 3 === 0 || kk === k)
      parts.push(`<text class="bl-tick${kk === k ? " bl-cur" : ""}" x="${x(kk).toFixed(1)}" y="${H - L.bottom + 16}" text-anchor="middle">${kk}</text>`);
  }
  parts.push(`<rect class="bl-sel" x="${(x(k) - pw / KMAX / 2).toFixed(1)}" y="${L.top}" width="${(pw / KMAX).toFixed(1)}" height="${ph}"/>`);
  const path = (f: (kk: number) => number) => {
    const d: string[] = [];
    for (let kk = 1; kk <= KMAX; kk++) d.push(`${kk === 1 ? "M" : "L"}${x(kk).toFixed(1)},${y(f(kk)).toFixed(1)}`);
    return d.join("");
  };
  parts.push(`<path class="bl-std" d="${path((kk) => fprStandard(b, kk))}"/>`);
  const blocked = LAYOUTS.find((l) => l.id === layout)!.block > 0;
  if (blocked) parts.push(`<path class="bl-blk" d="${path((kk) => theory(layout, b, kk))}"/>`);
  for (const p of pts) {
    if (!p) continue;
    const [lo, hi] = wilson(p.fp, p.q);
    const cx = x(p.k).toFixed(1);
    if (p.fp > 0) parts.push(`<line class="bl-ci" x1="${cx}" x2="${cx}" y1="${y(hi).toFixed(1)}" y2="${y(lo).toFixed(1)}"/>`);
    if (p.fp === 0) parts.push(`<path class="bl-zero" d="M${(x(p.k) - 4).toFixed(1)},${(y(0) - 7).toFixed(1)}l4,6l4,-6"/>`);
    else parts.push(`<circle class="bl-dot${p.k === k ? " bl-dot-cur" : ""}" cx="${cx}" cy="${y(p.fp / p.q).toFixed(1)}" r="${p.k === k ? 4.2 : 3.2}"/>`);
  }
  parts.push(`<text class="bl-axis" x="${L.left + pw / 2}" y="${H - 6}" text-anchor="middle">hash functions per key, k</text>`);
  parts.push(`<text class="bl-axis" transform="translate(13 ${L.top + ph / 2}) rotate(-90)" text-anchor="middle">false-positive rate</text>`);
  const aria = `False-positive rate against k at ${b} bits per key: the standard formula${blocked ? ", the blocked formula" : ""} and the rates measured on a simulated ${label(layout).toLowerCase()} filter.`;
  return `<svg class="bl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

export interface Probe {
  pos: number;
  set: boolean;
  checked: boolean;
}

/** The small filter and the probes of the query-th absent key. */
export function smallFilter(layout: Layout, b: number, k: number, seed: number, query: number): { f: Filter; probes: Probe[]; hit: boolean } {
  const n = Math.round(SMALL / b);
  const f = build(layout, SMALL, n, k, (seed * 7919 + 17) >>> 0);
  const p = new Int32Array(KMAX);
  const x = n + query;
  const hit = has(f, x, p);
  probes(layout, SMALL, k, f.sd, x, p);
  const out: Probe[] = [];
  let open = true;
  for (let i = 0; i < k; i++) {
    const set = ((f.bits[p[i] >>> 5] >>> (p[i] & 31)) & 1) === 1;
    out.push({ pos: p[i], set, checked: open });
    if (!set) open = false;
  }
  return { f, probes: out, hit };
}

export function bitmap(layout: Layout, s: ReturnType<typeof smallFilter>): string {
  const cols = 64;
  const rows = SMALL / cols;
  const c = 8.6;
  const L = { left: (W - cols * c) / 2, top: 4 };
  const H = L.top + rows * c + 6;
  const parts: string[] = [];
  parts.push(`<rect class="bl-bg" x="${L.left}" y="${L.top}" width="${cols * c}" height="${rows * c}"/>`);
  for (let i = 0; i < SMALL; i++) {
    if ((s.f.bits[i >>> 5] >>> (i & 31)) & 1) {
      parts.push(`<rect class="bl-one" x="${(L.left + (i % cols) * c + 0.6).toFixed(1)}" y="${(L.top + Math.floor(i / cols) * c + 0.6).toFixed(1)}" width="${(c - 1.2).toFixed(1)}" height="${(c - 1.2).toFixed(1)}"/>`);
    }
  }
  const lineEvery = layout === "blocked512" ? 8 : layout === "blocked64" ? 1 : 0;
  for (let r = 0; r <= rows; r++) {
    const strong = lineEvery && r % lineEvery === 0;
    if (strong || r === 0 || r === rows)
      parts.push(`<line class="bl-blockline" x1="${L.left}" x2="${L.left + cols * c}" y1="${(L.top + r * c).toFixed(1)}" y2="${(L.top + r * c).toFixed(1)}"/>`);
  }
  if (layout === "partitioned") {
    const w = Math.floor(SMALL / s.probes.length);
    for (let i = 1; i < s.probes.length; i++) {
      const pos = i * w;
      const xx = L.left + (pos % cols) * c;
      const yy = L.top + Math.floor(pos / cols) * c;
      parts.push(`<path class="bl-blockline" d="M${xx.toFixed(1)},${(yy + c).toFixed(1)}V${yy.toFixed(1)}H${(L.left + cols * c).toFixed(1)}M${L.left},${(yy + c).toFixed(1)}H${xx.toFixed(1)}"/>`);
    }
  }
  for (const p of s.probes) {
    const cx = L.left + (p.pos % cols) * c + c / 2;
    const cy = L.top + Math.floor(p.pos / cols) * c + c / 2;
    const cls = !p.checked ? "bl-probe-skip" : p.set ? "bl-probe-hit" : "bl-probe-miss";
    parts.push(`<circle class="${cls}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(c * 0.95).toFixed(1)}"/>`);
  }
  const aria = `The ${SMALL} bits of a small ${label(layout).toLowerCase()} filter, one 64-bit word per row, with the bits probed by one absent key circled.`;
  return `<svg class="bl-chart bl-map" viewBox="0 0 ${W} ${H.toFixed(0)}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

export function probeText(s: ReturnType<typeof smallFilter>): string {
  const lines = new Set(s.probes.map((p) => p.pos >>> 9)).size;
  const words = new Set(s.probes.map((p) => p.pos >>> 6)).size;
  const checked = s.probes.filter((p) => p.checked).length;
  const where = `Its ${s.probes.length} probe${s.probes.length > 1 ? "s" : ""} fall in ${words} of the 32 words and ${lines} of the 4 cache lines.`;
  const verdict = s.hit
    ? `All ${s.probes.length} bits are set, so the filter answers "maybe present" for a key it never saw: a false positive.`
    : `The lookup stops at probe ${checked}, the first bit that is 0.`;
  return `${where} ${verdict}`;
}

export function readout(layout: Layout, b: number, k: number, p: Point | undefined): string {
  const std = fprStandard(b, k);
  const blocked = LAYOUTS.find((l) => l.id === layout)!.block > 0;
  if (!p) return `Measuring k = ${k}…`;
  const [lo, hi] = wilson(p.fp, p.q);
  const rate = p.fp / p.q;
  const parts = [
    `At ${b} bits per key and k = ${k}, ${p.fp.toLocaleString("en-US")} of ${p.q.toLocaleString("en-US")} absent keys pass the filter: <strong>${pctf(rate)}</strong> (95% interval ${pctf(lo)} to ${pctf(hi)}).`,
    blocked
      ? `The standard formula gives ${pctf(std)} and the blocked formula ${pctf(theory(layout, b, k))}.`
      : `The standard formula gives ${pctf(std)}.`,
    `${num(p.fill * 100, 1)}% of the bits are set, and that fraction to the power k is ${pctf(p.fill ** k)}.`,
  ];
  return parts.join(" ");
}

export interface Props {
  seed?: number;
}

export function render(props: Props): string {
  const seed = typeof props.seed === "number" ? props.seed : 1;
  const pts = sweep(DEFAULT_LAYOUT, DEFAULT_B, seed);
  const s = smallFilter(DEFAULT_LAYOUT, DEFAULT_B, DEFAULT_K, seed, 0);
  const opts = LAYOUTS.map((o) => `<option value="${o.id}"${o.id === DEFAULT_LAYOUT ? " selected" : ""}>${esc(o.label)}</option>`).join("");
  return [
    `<figure class="bl" data-seed="${seed}">`,
    `<div class="bl-controls">`,
    `<label class="bl-select"><span>Layout</span><select name="layout" disabled>${opts}</select></label>`,
    `<label class="bl-slider"><span>Bits per key <output name="b-out">${DEFAULT_B}</output></span><input type="range" name="b" min="${BMIN}" max="${BMAX}" step="1" value="${DEFAULT_B}" disabled></label>`,
    `<label class="bl-slider"><span>Hash functions k <output name="k-out">${DEFAULT_K}</output></span><input type="range" name="k" min="1" max="${KMAX}" step="1" value="${DEFAULT_K}" disabled></label>`,
    `<button type="button" name="rerun" disabled>New seeds</button>`,
    `</div>`,
    `<div class="bl-legend" aria-hidden="true"><span class="bl-key bl-key-dot">measured, with 95% interval</span><span class="bl-key bl-key-std">(1 − e<sup>−k/b</sup>)<sup>k</sup></span><span class="bl-key bl-key-blk" data-part="blk-key"${LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT)!.block ? "" : " hidden"}>blocked formula</span></div>`,
    `<div class="bl-plot" data-part="chart">${chart(DEFAULT_LAYOUT, DEFAULT_B, DEFAULT_K, pts)}</div>`,
    `<p class="bl-readout" data-part="readout" aria-live="polite">${readout(DEFAULT_LAYOUT, DEFAULT_B, DEFAULT_K, pts[DEFAULT_K - 1])}</p>`,
    `<div class="bl-controls bl-sub"><span class="bl-subhead">One lookup in a ${SMALL}-bit filter with the same settings</span><button type="button" name="next" disabled>Another key</button></div>`,
    `<div class="bl-legend" aria-hidden="true"><span class="bl-key bl-key-one">bit set to 1</span><span class="bl-key bl-key-hit">probe finds 1</span><span class="bl-key bl-key-miss">probe finds 0</span><span class="bl-key bl-key-skip">not read</span></div>`,
    `<div class="bl-plot" data-part="map">${bitmap(DEFAULT_LAYOUT, s)}</div>`,
    `<p class="bl-readout" data-part="probes" aria-live="polite">${probeText(s)}</p>`,
    `<figcaption>Simulation in the browser. Each measured point builds a filter of 2<sup>20</sup> bits holding 2<sup>20</sup>/b integer keys and queries 2<sup>19</sup> integers that were not inserted; the hashes are seeded 32-bit mixing functions, not the pageview data. The blocked formula is the Poisson-weighted rate of Putze, Sanders and Singler with each block's fill treated exactly. A downward caret marks a point with no false positives. The lower panel draws a ${SMALL}-bit filter one 64-bit word per row; a cache line is 8 rows.</figcaption>`,
    `</figure>`,
  ].join("");
}
