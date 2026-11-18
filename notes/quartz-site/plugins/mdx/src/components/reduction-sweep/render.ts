// Markup for the reductions size-sweep figure. The build draws the default
// preset; the client redraws the chart and readout with the same functions
// when the reader changes the preset, the series, the dispatch cost or the
// size under the pointer.

import { esc } from "../../shared/format";
import {
  bestSingleSeries,
  breakEven,
  DISPATCH_US,
  elemsPerCycle,
  gbs,
  GiB,
  KiB,
  LEVELS,
  MiB,
  ns,
  nsMax,
  nsMin,
  predicted,
  PRESET_IDS,
  PRESETS,
  series,
  SIZES,
  sizeLabel,
  SLIDER_MAX,
  usLabel,
  usToSlider,
  VARIANTS,
  type PresetId,
} from "./model";

export interface Props {
  preset?: unknown;
}

export interface State {
  preset: PresetId | null;
  shown: Set<string>;
  model: boolean;
  dUs: number;
  cursor: number; // index into SIZES
}

export function initialState(preset: PresetId = "chain"): State {
  const p = PRESETS[preset];
  return { preset, shown: new Set(p.shown), model: p.model, dUs: DISPATCH_US.spawn, cursor: SIZES.length - 2 };
}

interface Geo {
  W: number;
  H: number;
  M: { left: number; right: number; top: number; bottom: number };
}
export const WIDE: Geo = { W: 640, H: 300, M: { left: 46, right: 12, top: 24, bottom: 38 } };
export const NARROW: Geo = { W: 400, H: 340, M: { left: 34, right: 8, top: 24, bottom: 38 } };
const Y_LO = 0.15;
const Y_HI = 450;
const Y_TICKS = [0.3, 1, 3, 10, 30, 100, 300];
const X_TICKS = [16 * KiB, 256 * KiB, 4 * MiB, 64 * MiB, 1 * GiB];
const f = (x: number): string => x.toFixed(1);

export const xPos = (g: Geo, bytes: number): number => {
  const lo = Math.log2(SIZES[0]);
  const hi = Math.log2(SIZES[SIZES.length - 1]);
  return g.M.left + 4 + ((Math.log2(bytes) - lo) / (hi - lo)) * (g.W - g.M.left - g.M.right - 8);
};
export const yPos = (g: Geo, gb: number): number => {
  const v = Math.min(Math.max(gb, Y_LO), Y_HI);
  return g.M.top + (1 - (Math.log10(v) - Math.log10(Y_LO)) / (Math.log10(Y_HI) - Math.log10(Y_LO))) * (g.H - g.M.top - g.M.bottom);
};

/** Index of the measured size nearest to an x coordinate in the chart. */
export function nearestIndex(g: Geo, x: number): number {
  let best = 0;
  for (let i = 1; i < SIZES.length; i++) if (Math.abs(xPos(g, SIZES[i]) - x) < Math.abs(xPos(g, SIZES[best]) - x)) best = i;
  return best;
}

const fmtGbs = (x: number): string => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const fmtNs = (x: number): string => (x >= 10 ? x.toFixed(1) : x.toFixed(3));

/** The dispatch-model curve: predicted all_pool time with dispatch cost dUs. */
export function modelPoints(dUs: number): number[] {
  return SIZES.map((b, i) => predicted(ns("all_pool", i), b, dUs));
}

export function chartSvg(s: State, narrow: boolean): string {
  const g = narrow ? NARROW : WIDE;
  const plotB = g.H - g.M.bottom;
  const shownLabels = VARIANTS.filter((v) => s.shown.has(v.id)).map((v) => v.label);
  const label = `Throughput in GB/s against array size for ${shownLabels.join(", ") || "no variants"}${s.model ? `, with the dispatch model at ${usLabel(s.dUs)}` : ""}`;
  const out: string[] = [`<svg viewBox="0 0 ${g.W} ${g.H}" class="rs-chart" role="img" aria-label="${esc(label)}">`];

  // Cache levels as bands, labelled at the top.
  const edges = [SIZES[0], ...LEVELS.map((l) => l.bytes), SIZES[SIZES.length - 1]];
  const names = ["L1", "L2", "L3", "DRAM"];
  for (let k = 0; k < 4; k++) {
    const x0 = Math.max(xPos(g, edges[k]), g.M.left);
    const x1 = xPos(g, edges[k + 1]);
    if (k % 2 === 1) out.push(`<rect class="rs-band" x="${f(x0)}" y="${g.M.top}" width="${f(x1 - x0)}" height="${f(plotB - g.M.top)}"/>`);
    out.push(`<text class="rs-level" x="${f((x0 + x1) / 2)}" y="${g.M.top - 8}" text-anchor="middle">${names[k]}</text>`);
  }
  for (const v of Y_TICKS) {
    const yy = f(yPos(g, v));
    out.push(`<line class="rs-grid" x1="${g.M.left}" x2="${g.W - g.M.right}" y1="${yy}" y2="${yy}"/>`);
    out.push(`<text class="rs-tick" x="${g.M.left - 5}" y="${f(yPos(g, v) + 4)}" text-anchor="end">${v}</text>`);
  }
  for (const b of X_TICKS) {
    const minor = narrow && (b === 256 * KiB || b === 64 * MiB) ? " rs-minor" : "";
    out.push(`<text class="rs-tick${minor}" x="${f(xPos(g, b))}" y="${plotB + 16}" text-anchor="middle">${sizeLabel(b)}</text>`);
  }
  out.push(`<text class="rs-axis" x="${f(g.M.left + (g.W - g.M.left - g.M.right) / 2)}" y="${g.H - 4}" text-anchor="middle">array size</text>`);
  const ym = (g.M.top + plotB) / 2;
  out.push(`<text class="rs-axis" x="11" y="${f(ym)}" text-anchor="middle" transform="rotate(-90 11 ${f(ym)})">GB/s</text>`);

  // Spread bands first, then lines, so every line sits above every band.
  const shown = VARIANTS.filter((v) => s.shown.has(v.id));
  for (const v of shown) {
    const top = SIZES.map((b, i) => `${f(xPos(g, b))},${f(yPos(g, gbs(nsMin(v.id, i))))}`);
    const bot = SIZES.map((b, i) => `${f(xPos(g, b))},${f(yPos(g, gbs(nsMax(v.id, i))))}`).reverse();
    out.push(`<polygon class="rs-spread rs-v-${v.id}" points="${[...top, ...bot].join(" ")}"/>`);
  }
  for (const v of shown) {
    const pts = SIZES.map((b, i) => `${f(xPos(g, b))},${f(yPos(g, gbs(ns(v.id, i))))}`).join(" ");
    out.push(`<polyline class="rs-line rs-v-${v.id}" points="${pts}"/>`);
  }

  if (s.model) {
    const m = modelPoints(s.dUs);
    const pts = SIZES.map((b, i) => `${f(xPos(g, b))},${f(yPos(g, gbs(m[i])))}`).join(" ");
    out.push(`<polyline class="rs-model" points="${pts}"/>`);
    const be = breakEven(bestSingleSeries(), series("all_pool"), SIZES, s.dUs);
    if (be !== null) {
      const xx = f(xPos(g, be));
      out.push(`<line class="rs-even" x1="${xx}" x2="${xx}" y1="${g.M.top}" y2="${plotB}"/>`);
    }
  }

  const cx = f(xPos(g, SIZES[s.cursor]));
  out.push(`<line class="rs-cursor" x1="${cx}" x2="${cx}" y1="${g.M.top}" y2="${plotB}"/>`);
  for (const v of shown) {
    out.push(`<circle class="rs-dot rs-v-${v.id}" cx="${cx}" cy="${f(yPos(g, gbs(ns(v.id, s.cursor))))}" r="3"/>`);
  }
  // A transparent overlay takes the pointer anywhere in the plot.
  out.push(`<rect class="rs-hit" data-part="hit" x="${g.M.left}" y="${g.M.top}" width="${g.W - g.M.left - g.M.right}" height="${plotB - g.M.top}"/>`);
  out.push(`</svg>`);
  return out.join("");
}

export function readoutHtml(s: State): string {
  const i = s.cursor;
  const rows = VARIANTS.filter((v) => s.shown.has(v.id))
    .map((v) => ({ v, n: ns(v.id, i) }))
    .sort((a, b) => a.n - b.n)
    .map(
      ({ v, n }) =>
        `<tr><td><span class="rs-key rs-v-${v.id}"></span>${esc(v.label)}</td><td>${fmtGbs(gbs(n))}</td><td>${fmtNs(n)}</td><td>${elemsPerCycle(n) >= 0.1 ? elemsPerCycle(n).toFixed(2) : elemsPerCycle(n).toFixed(3)}</td></tr>`,
    );
  let model = "";
  if (s.model) {
    const be = breakEven(bestSingleSeries(), series("all_pool"), SIZES, s.dUs);
    const pred = predicted(ns("all_pool", i), SIZES[i], s.dUs);
    model =
      `<p class="rs-note">At ${usLabel(s.dUs)} per parallel call, the dashed curve predicts ${fmtNs(pred)} ns per element for the 4-thread all kernel on a ${sizeLabel(SIZES[i])} array, ` +
      (be === null
        ? `and 4 threads are not faster than the fastest single thread at any size up to 4 GiB.</p>`
        : `and 4 threads are faster than every single-thread variant from about ${sizeLabel(be)} upward (dotted line).</p>`);
  }
  const body = rows.length
    ? `<table class="rs-table"><thead><tr><th>${sizeLabel(SIZES[i])}</th><th>GB/s</th><th>ns/elem</th><th>elem/cycle</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
    : `<p class="rs-note">No variant selected.</p>`;
  return body + model;
}

function presetButtons(s: State): string {
  return PRESET_IDS.map(
    (id) => `<button type="button" name="preset-${id}" aria-pressed="${s.preset === id}" disabled>${esc(PRESETS[id].label)}</button>`,
  ).join("");
}

function variantButtons(s: State): string {
  const group = (g: string, title: string) =>
    `<div class="rs-group"><span class="rs-glabel">${title}</span>` +
    VARIANTS.filter((v) => v.group === g)
      .map(
        (v) =>
          `<button type="button" name="v-${v.id}" aria-pressed="${s.shown.has(v.id)}" disabled><span class="rs-key rs-v-${v.id}"></span>${esc(v.label)}</button>`,
      )
      .join("") +
    `</div>`;
  return group("scalar", "1 thread, scalar") + group("vector", "1 thread, vector") + group("threads", "4 threads");
}

function dispatchControls(s: State): string {
  const quick = [
    ["poolHot", "spinning pool", DISPATCH_US.poolHot],
    ["spawn", "pthread_create", DISPATCH_US.spawn],
    ["poolCold", "sleeping pool", DISPATCH_US.poolCold],
  ] as const;
  return (
    `<div class="rs-dispatch" data-part="dispatch"${s.model ? "" : " hidden"}>` +
    `<label class="rs-slider"><span>Dispatch cost per parallel call <output name="d-out">${usLabel(s.dUs)}</output></span>` +
    `<input type="range" name="dispatch" min="0" max="${SLIDER_MAX}" step="1" value="${usToSlider(s.dUs)}" disabled></label>` +
    `<div class="rs-quick">` +
    quick.map(([k, l, us]) => `<button type="button" name="d-${k}" disabled>${l}, ${usLabel(us)}</button>`).join("") +
    `</div></div>`
  );
}

export function figureHtml(s: State): string {
  return `<figure class="rs">
<div class="rs-presets">${presetButtons(s)}<button type="button" name="model" aria-pressed="${s.model}" disabled>Dispatch model</button></div>
<div class="rs-variants">${variantButtons(s)}</div>
${dispatchControls(s)}
<div data-part="chart">${chartSvg(s, false)}</div>
<div data-part="readout" class="rs-readout" aria-live="polite">${readoutHtml(s)}</div>
<figcaption>Medians of five runs on a 4-vCPU Emerald Rapids KVM guest (gcc 13.3 and clang 18, 2 MiB pages); shading spans the slowest and fastest run. Point at the chart to read a size. The dispatch model takes the measured pooled curve (all, pool), removes the pool's own ${usLabel(DISPATCH_US.poolHot)} hand-off and adds the chosen cost per call; at ${usLabel(DISPATCH_US.spawn)}, the measured cost of creating and joining four threads, it should land on the measured spawn curve.</figcaption>
</figure>`;
}

export function render(props: Props): string {
  const p = typeof props.preset === "string" && props.preset in PRESETS ? (props.preset as PresetId) : "chain";
  return figureHtml(initialState(p));
}

