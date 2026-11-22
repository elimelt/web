// Build-time markup and the pure drawing functions of the quantile figure.

import { esc, num } from "../../shared/format";
import initialJson from "../../../../../../content/algorithms/probabilistic/quantile-experiments/initial.json";
import metaJson from "../../../../../../content/algorithms/probabilistic/quantile-experiments/meta.json";
import { ALPHAS, capacity, KS, type Compaction } from "./model";

interface Meta {
  records: number;
  population: number;
  max: number;
  atMax: number;
}
export const META = metaJson as Meta;
const INITIAL = initialJson as {
  k: number;
  alpha: number;
  qs: number[];
  truth: number[];
  kll: number[];
  dd: number[];
  kllRank: number[];
  ddRank: number[];
  levels: number[];
  compactions: number;
  bins: number;
};

export const DEFAULT_K = 64;
export const DEFAULT_ALPHA = 0.01;
export const GRID_POINTS = 60;

export interface View {
  k: number;
  alpha: number;
  n: number;
  qs: number[];
  truth: number[];
  kll: number[];
  dd: number[];
  kllRank: number[];
  ddRank: number[];
  levels: number[];
  compactions: number;
  bins: number;
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number, d = 1) => `${num(100 * v, d)}%`;

export function relErr(v: View, which: "kll" | "dd"): number[] {
  return v.qs.map((_, i) => Math.abs(v[which][i] - v.truth[i]) / v.truth[i]);
}

/** Quantile label: 0.5, 0.9, 0.99, 0.999. */
function qLabel(q: number): string {
  return String(Number(q.toPrecision(3)));
}

/**
 * Two panels over the same quantile axis (1 - q on a log scale): the relative
 * error of each estimate's value, and its rank error.
 */
export function chart(v: View, narrow: boolean): string {
  const W = narrow ? 360 : 600;
  const L = { left: narrow ? 46 : 56, right: 20, top: 22 };
  const ph = narrow ? 120 : 130;
  const gap = 46;
  const H = L.top + 2 * ph + gap + 34;
  const pw = W - L.left - L.right;
  const s0 = 0.3;
  const s1 = 3;
  const x = (q: number) => L.left + ((-Math.log10(1 - q) - s0) / (s1 - s0)) * pw;
  const relK = relErr(v, "kll");
  const relD = relErr(v, "dd");
  const relMax = Math.max(0.02, v.alpha * 1.5, ...relK.map((e) => Math.min(e, 1)), ...relD);
  const relTop = niceTop(Math.min(relMax, 1));
  const rankMax = Math.max(0.002, ...v.kllRank, ...v.ddRank);
  const rankTop = niceTop(rankMax);
  const parts: string[] = [];
  const panel = (y0: number, top: number, title: string, a: number[], b: number[], guide: number | null) => {
    const y = (e: number) => y0 + ph - (Math.min(e, top) / top) * ph;
    parts.push(`<text class="qs-title" x="${L.left}" y="${y0 - 8}">${title}</text>`);
    for (let i = 0; i <= 4; i++) {
      const val = (top * i) / 4;
      const yy = y(val).toFixed(1);
      parts.push(`<line class="qs-grid" x1="${L.left}" x2="${W - L.right}" y1="${yy}" y2="${yy}"/>`);
      parts.push(`<text class="qs-tick" x="${L.left - 6}" y="${(Number(yy) + 4).toFixed(1)}" text-anchor="end">${pct(val, top < 0.02 ? 2 : top < 0.2 ? 1 : 0)}</text>`);
    }
    for (const q of [0.5, 0.9, 0.99, 0.999]) {
      const xx = x(q).toFixed(1);
      parts.push(`<line class="qs-grid" x1="${xx}" x2="${xx}" y1="${y0}" y2="${y0 + ph}"/>`);
    }
    if (guide !== null && guide <= top) {
      const yy = y(guide).toFixed(1);
      parts.push(`<line class="qs-guide" x1="${L.left}" x2="${W - L.right}" y1="${yy}" y2="${yy}"/>`);
      parts.push(`<text class="qs-tick qs-guide-label" x="${W - L.right}" y="${(Number(yy) - 4).toFixed(1)}" text-anchor="end">α = ${pct(guide, guide < 0.01 ? 1 : 0)}</text>`);
    }
    const line = (vals: number[], cls: string) => {
      const pts = vals.map((e, i) => `${x(v.qs[i]).toFixed(1)},${y(e).toFixed(1)}`).join(" ");
      parts.push(`<polyline class="${cls}" points="${pts}"/>`);
      vals.forEach((e, i) => {
        if (e > top) parts.push(`<path class="${cls}-clip" d="M${x(v.qs[i]).toFixed(1)},${(y0 - 2).toFixed(1)} l-3,5 h6 z"/>`);
      });
    };
    line(b, "qs-dd");
    line(a, "qs-kll");
  };
  panel(L.top, relTop, "Relative error of the value", relK, relD, v.alpha);
  const y2 = L.top + ph + gap;
  panel(y2, rankTop, "Rank error", v.kllRank, v.ddRank, null);
  for (const q of [0.5, 0.9, 0.99, 0.999]) {
    parts.push(`<text class="qs-tick" x="${x(q).toFixed(1)}" y="${y2 + ph + 15}" text-anchor="middle">${qLabel(q)}</text>`);
  }
  parts.push(`<text class="qs-axis" x="${L.left + pw / 2}" y="${H - 4}" text-anchor="middle">quantile q (1 − q on a log scale)</text>`);
  const aria = `Relative error of the value and rank error of a KLL sketch with k = ${v.k} and a DDSketch with alpha = ${v.alpha}, at quantiles from 0.5 to 0.999, after ${fmt(v.n)} values.`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

function niceTop(v: number): number {
  const steps = [1, 2, 2.5, 4, 5, 8, 10];
  const e = Math.floor(Math.log10(v));
  for (const s of steps) if (s * 10 ** e >= v) return s * 10 ** e;
  return 10 ** (e + 1);
}

/** KLL's levels: items held against capacity, highest level on top. */
export function levelsChart(v: View, narrow: boolean): string {
  const W = narrow ? 360 : 600;
  const H = v.levels.length;
  const rowH = 18;
  const left = narrow ? 104 : 150;
  const maxCap = Math.max(...v.levels.map((_, h) => capacity(v.k, h, H)), ...v.levels);
  const scale = (W - left - 60) / maxCap;
  const parts: string[] = [];
  for (let h = H - 1, row = 0; h >= 0; h--, row++) {
    const y = 4 + row * rowH;
    const cap = capacity(v.k, h, H);
    parts.push(`<text class="qs-tick" x="${left - 6}" y="${y + 12}" text-anchor="end">${narrow ? `level ${h} ×${fmt(2 ** h)}` : `level ${h} (weight ${fmt(2 ** h)})`}</text>`);
    parts.push(`<rect class="qs-cap" x="${left}" y="${y + 2}" width="${(cap * scale).toFixed(1)}" height="${rowH - 6}"/>`);
    if (v.levels[h] > 0) parts.push(`<rect class="qs-fill" x="${left}" y="${y + 2}" width="${(v.levels[h] * scale).toFixed(1)}" height="${rowH - 6}"/>`);
    parts.push(`<text class="qs-tick" x="${(left + Math.max(cap, v.levels[h]) * scale + 4).toFixed(1)}" y="${y + 12}">${v.levels[h]}/${cap}</text>`);
  }
  const Hh = 8 + H * rowH;
  const aria = `KLL's ${H} levels: the items each holds against its capacity.`;
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

export function retained(v: View): number {
  return v.levels.reduce((a, b) => a + b, 0);
}

export function readout(v: View): string {
  const at = (q: number) => v.qs.reduce((b, x, i) => (Math.abs(x - q) < Math.abs(v.qs[b] - q) ? i : b), 0);
  const i99 = at(0.99);
  const relK = relErr(v, "kll");
  const relD = relErr(v, "dd");
  const worst = (a: number[]) => Math.max(...a);
  const head = v.n === META.records ? `After all ${fmt(v.n)} values` : `After ${fmt(v.n)} values`;
  return (
    `<p>${head}, KLL with <i>k</i> = ${v.k} keeps ${fmt(retained(v))} values (${fmt(4 * retained(v))} bytes at 4 bytes each) and DDSketch with α = ${v.alpha} keeps ${fmt(v.bins)} buckets (${fmt(8 * v.bins)} bytes at 8 bytes each). ` +
    `At <i>q</i> = 0.99 the true value is ${fmt(v.truth[i99])}; KLL answers ${fmt(v.kll[i99])} (${pct(relK[i99])} off) and DDSketch ${fmt(v.dd[i99])} (${pct(relD[i99])} off).</p>` +
    `<p>Over the plotted quantiles, the largest relative error is <strong>${pct(worst(relK))}</strong> for KLL and <strong>${pct(worst(relD))}</strong> for DDSketch, and the largest rank error is <strong>${pct(worst(v.kllRank), 2)}</strong> for KLL and <strong>${pct(worst(v.ddRank), 2)}</strong> for DDSketch.</p>`
  );
}

export function eventText(last: Compaction | null, compactions: number): string {
  if (!last) return "KLL has not compacted yet: every value so far is stored with weight 1.";
  return `KLL has compacted ${fmt(compactions)} times. The last, after value ${fmt(last.at)}, sorted level ${last.level}'s ${last.size} items${last.size % 2 ? " (the largest stayed behind)" : ""}, kept those at ${last.offset ? "odd" : "even"} positions, and moved them to level ${last.level + 1} with weight ${fmt(2 ** (last.level + 1))}.`;
}

export function positionText(t: number): string {
  return t >= META.records ? `all ${fmt(META.records)} values` : `${fmt(t)} values`;
}

export function initialView(): View {
  return {
    k: INITIAL.k,
    alpha: INITIAL.alpha,
    n: META.records,
    qs: INITIAL.qs,
    truth: INITIAL.truth,
    kll: INITIAL.kll,
    dd: INITIAL.dd,
    kllRank: INITIAL.kllRank,
    ddRank: INITIAL.ddRank,
    levels: INITIAL.levels,
    compactions: INITIAL.compactions,
    bins: INITIAL.bins,
  };
}

export function render(props: { base?: string }): string {
  const base = props.base ?? "";
  const v = initialView();
  const ki = KS.indexOf(DEFAULT_K);
  const ai = ALPHAS.indexOf(DEFAULT_ALPHA);
  return [
    `<figure class="qs" data-base="${esc(base)}">`,
    `<div class="qs-controls">`,
    `<label class="qs-slider"><span>KLL size <i>k</i> <output name="k-out">${DEFAULT_K}</output></span><input type="range" name="k" min="0" max="${KS.length - 1}" step="1" value="${ki}" disabled></label>`,
    `<label class="qs-slider"><span>DDSketch α <output name="alpha-out">${DEFAULT_ALPHA}</output></span><input type="range" name="alpha" min="0" max="${ALPHAS.length - 1}" step="1" value="${ai}" disabled></label>`,
    `</div>`,
    `<div class="qs-controls">`,
    `<label class="qs-slider qs-wide"><span>Position <output name="pos-out">${positionText(META.records)}</output></span><input type="range" name="pos" min="1" max="${META.records}" step="1" value="${META.records}" disabled></label>`,
    `<button type="button" name="compact" disabled>Next compaction</button>`,
    `<button type="button" name="reseed" disabled>New coin flips</button>`,
    `</div>`,
    `<div class="qs-legend"><span class="qs-key qs-key-kll">KLL</span><span class="qs-key qs-key-dd">DDSketch</span><span class="qs-key qs-key-guide">DDSketch's guarantee α</span></div>`,
    `<div class="qs-chart" data-part="chart">${chart(v, false)}</div>`,
    `<div class="qs-readout" data-part="readout" aria-live="polite">${readout(v)}</div>`,
    `<div class="qs-levels" data-part="levels">${levelsChart(v, false)}</div>`,
    `<p class="qs-event" data-part="event">${eventText(null, v.compactions).replace("KLL has not compacted yet: every value so far is stored with weight 1.", `KLL compacted ${fmt(v.compactions)} times over the whole sample.`)}</p>`,
    `<figcaption>Both sketches run in the browser on ${fmt(META.records)} response-start timings drawn uniformly from the ${fmt(META.population)} nonzero values of the web analytics sample, in recorded order. The rank error of an estimate is the distance from <i>q</i> to the range of ranks its value occupies among the values seen. KLL bounds rank error with high probability; DDSketch bounds the relative error of the value. Timings are capped at ${fmt(META.max)}, and ${pct(META.atMax / META.records, 2)} of the sample sits at the cap.</figcaption>`,
    `</figure>`,
  ].join("");
}
