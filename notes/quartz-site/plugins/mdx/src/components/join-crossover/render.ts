// Markup for the join crossover charts. The build draws the whole figure from
// the recorded summary; the client redraws it when the reader changes the
// table, the layout or random_page_cost, and moves the highlighted k.

import { esc, num } from "../../shared/format";
import {
  LABELS,
  LAYOUTS,
  METHODS,
  PRESETS,
  RPCS,
  SCALES,
  estimate,
  fastest,
  ioModel,
  ks,
  pick,
  presetKey,
  switchPoints,
  timed,
  type Layout,
  type Method,
  type View,
} from "./model";

export interface Props {
  preset?: unknown;
}

export const W = 640;
export const H = 300;
/** Plot area; the two strips sit below it, above the x labels. */
export const M = { left: 62, right: 14, top: 12, bottom: 90 };
const STRIP = 13;

const log = Math.log10;

export function short(v: number): string {
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
  return `${+v.toFixed(v < 10 ? 1 : 0)}`;
}

export function ms(v: number): string {
  if (v >= 1000) return `${num(v / 1000, v >= 10000 ? 1 : 2)} s`;
  if (v >= 10) return `${num(v, 0)} ms`;
  return `${num(v, v >= 1 ? 1 : 2)} ms`;
}

export const SCALE_LABEL = (s: string) => `${short(+s)} orders`;
export const LAYOUT_LABEL: Record<Layout, string> = { rand: "random order", clu: "clustered by cust_id" };

/** The value one series draws at k, with its whisker, or undefined where it has none. */
function value(v: View, m: Method, k: number): { y: number; lo?: number; hi?: number } | undefined {
  if (v.y === "cost") return { y: estimate(v.rpc, v.scale, v.layout, k)[m] };
  const p = timed(v.scale, v.layout, m, k);
  return p && { y: p.median, lo: p.min, hi: p.max };
}

export function scales(v: View) {
  const pts = ks(v.scale, v.layout);
  const kmin = pts[0];
  const kmax = pts[pts.length - 1];
  const x = (k: number) => M.left + 8 + ((log(k) - log(kmin)) / (log(kmax) - log(kmin))) * (W - M.left - M.right - 16);
  const vals: number[] = [];
  for (const m of METHODS)
    for (const k of pts) {
      const q = value(v, m, k);
      if (q) vals.push(q.lo ?? q.y, q.hi ?? q.y);
    }
  const lo = Math.floor(log(Math.min(...vals)));
  const hi = Math.ceil(log(Math.max(...vals)));
  const plotH = H - M.top - M.bottom;
  const y = (val: number) => M.top + (1 - (log(val) - lo) / Math.max(1, hi - lo)) * plotH;
  const yTicks: number[] = [];
  for (let e = lo; e <= hi; e++) yTicks.push(10 ** e);
  const xTicks = pts.filter((k) => Number.isInteger(log(k)) || k === kmax);
  return { x, y, yTicks, xTicks, pts };
}

const yTick = (v: View, t: number) =>
  v.y === "cost" ? short(t) : t >= 1000 ? `${short(t / 1000)} s` : `${t >= 1 ? t : t.toFixed(t >= 0.1 ? 1 : 2)} ms`;

export function chart(v: View, selected: number): string {
  const { x, y, yTicks, xTicks, pts } = scales(v);
  const plotBottom = H - M.bottom;
  const out: string[] = [
    `<svg viewBox="0 0 ${W} ${H}" class="jx-chart" role="img" aria-label="${esc(
      v.y === "cost" ? "Planner's estimated cost of each join method against k" : "Measured time of each join method against k",
    )}">`,
  ];
  for (const t of yTicks) {
    const yy = y(t).toFixed(1);
    out.push(`<line class="jx-grid" x1="${M.left}" x2="${W - M.right}" y1="${yy}" y2="${yy}"/>`);
    out.push(`<text class="jx-tick" x="${M.left - 6}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${yTick(v, t)}</text>`);
  }
  const ym = (M.top + plotBottom) / 2;
  out.push(
    `<text class="jx-axis jx-ytitle" x="13" y="${ym}" text-anchor="middle" transform="rotate(-90 13 ${ym})">${
      v.y === "cost" ? "estimated cost" : "execution time"
    }</text>`,
  );
  const sx = x(selected).toFixed(1);
  out.push(`<line class="jx-cursor" x1="${sx}" x2="${sx}" y1="${M.top}" y2="${plotBottom + 2 * STRIP + 10}"/>`);
  for (const m of METHODS) {
    out.push(`<g class="jx-series jx-${m}">`);
    const drawn = pts.map((k) => [k, value(v, m, k)] as const).filter(([, q]) => q);
    for (const [k, q] of drawn)
      if (q!.lo !== undefined && q!.hi! / q!.lo > 1.05)
        out.push(`<line class="jx-whisker" x1="${x(k).toFixed(1)}" x2="${x(k).toFixed(1)}" y1="${y(q!.lo).toFixed(1)}" y2="${y(q!.hi!).toFixed(1)}"/>`);
    out.push(`<polyline points="${drawn.map(([k, q]) => `${x(k).toFixed(1)},${y(q!.y).toFixed(1)}`).join(" ")}"/>`);
    for (const [k, q] of drawn) out.push(`<circle cx="${x(k).toFixed(1)}" cy="${y(q!.y).toFixed(1)}" r="2.8"/>`);
    out.push(`</g>`);
  }
  // Two strips: the measured-fastest method and the planner's pick, one cell per k.
  const edges = pts.map((k, i) => {
    const a = i === 0 ? x(k) - 8 : (x(pts[i - 1]) + x(k)) / 2;
    const b = i === pts.length - 1 ? x(k) + 8 : (x(k) + x(pts[i + 1])) / 2;
    return [a, b];
  });
  const strips: [string, (k: number) => Method][] = [
    ["fastest", (k) => fastest(v.scale, v.layout, k).method],
    ["planner", (k) => pick(v.rpc, v.scale, v.layout, k).method],
  ];
  strips.forEach(([label, f], row) => {
    const top = plotBottom + 8 + row * (STRIP + 5);
    out.push(`<text class="jx-strip-label" x="0" y="${top + STRIP - 2}">${esc(label)}</text>`);
    pts.forEach((k, i) => {
      const [a, b] = edges[i];
      out.push(`<rect class="jx-cell jx-${f(k)}" x="${a.toFixed(1)}" y="${top}" width="${(b - a - 1).toFixed(1)}" height="${STRIP}"/>`);
    });
  });
  const labelY = plotBottom + 8 + 2 * (STRIP + 5) + 14;
  for (const k of xTicks)
    out.push(`<text class="jx-tick" x="${x(k).toFixed(1)}" y="${labelY}" text-anchor="middle">${short(k)}</text>`);
  out.push(
    `<text class="jx-axis" x="${(M.left + W - M.right) / 2}" y="${H - 5}" text-anchor="middle">k, customers kept by the filter (outer rows)</text>`,
  );
  out.push(`</svg>`);
  return out.join("");
}

const sw = (m: Method) => `<span class="jx-swatch jx-${m}"></span>`;

export function readout(v: View, k: number): string {
  const f = fastest(v.scale, v.layout, k);
  const p = pick(v.rpc, v.scale, v.layout, k);
  const rows = METHODS.map((m) => {
    const t = timed(v.scale, v.layout, m, k);
    const c = estimate(v.rpc, v.scale, v.layout, k)[m];
    const time = t ? ms(t.median) : "not run (over 20 s)";
    const main = v.y === "cost" ? `${short(c)} <small>${time}</small>` : `${time} <small>cost ${short(c)}</small>`;
    return `<li>${sw(m)}<span class="jx-name">${LABELS[m]}</span><b>${main}</b></li>`;
  }).join("");
  const ratio = p.ms / f.ms;
  const verdict =
    p.method === f.method
      ? `The planner picks ${LABELS[p.method]}, the fastest here.`
      : `The planner picks ${LABELS[p.method]} (${ms(p.ms)}), ${num(ratio, ratio < 10 ? 1 : 0)}× the time of ${LABELS[f.method]}.`;
  return `<div class="jx-at">At k = <b>${k.toLocaleString("en-US")}</b> customers</div><ul class="jx-rows">${rows}</ul><p class="jx-verdict">${esc(verdict)}</p>`;
}

export function summaryLine(v: View): string {
  const s = switchPoints(v);
  const fmt = (k?: number) => (k === undefined ? "never in this range" : `at k ≈ ${short(k)}`);
  const io = ioModel(v.scale, v.layout).crossover;
  return `Hash join overtakes nested loop ${fmt(s.measured)} when measured, ${fmt(s.planner)} in PostgreSQL's estimates${
    v.rpc === "4" ? "" : ` (random_page_cost ${v.rpc})`
  }, and at k ≈ ${short(io)} in the page-I/O model.`;
}

export const startK = (v: View): number => {
  const s = switchPoints(v).measured;
  const pts = ks(v.scale, v.layout);
  if (s === undefined) return pts[Math.floor(pts.length / 2)];
  return pts.reduce((a, b) => (Math.abs(log(b) - log(s)) < Math.abs(log(a) - log(s)) ? b : a));
};

function seg(name: string, items: [string, string][], current: string, label: string): string {
  return `<div class="jx-seg" role="group" aria-label="${esc(label)}">${items
    .map(([value, text]) => `<button type="button" name="${name}" value="${esc(value)}" aria-pressed="${value === current}" disabled>${esc(text)}</button>`)
    .join("")}</div>`;
}

export function controls(key: string, v: View): string {
  const p = PRESETS[key];
  const groups: string[] = [];
  if (p.controls.includes("scale")) groups.push(seg("scale", SCALES.map((s) => [s, SCALE_LABEL(s)]), v.scale, "Table size"));
  if (p.controls.includes("layout")) groups.push(seg("layout", LAYOUTS.map((l) => [l, LAYOUT_LABEL[l]]), v.layout, "Physical order of orders"));
  if (p.controls.includes("rpc"))
    groups.push(seg("rpc", RPCS.map((r) => [r, `random_page_cost ${r}${r === "4" ? " (default)" : ""}`]), v.rpc, "random_page_cost"));
  return groups.join("");
}

export const viewOf = (key: string): View => {
  const { scale, layout, rpc, y } = PRESETS[key];
  return { scale, layout, rpc, y };
};

export function render(props: Props = {}): string {
  const key = presetKey(props.preset);
  const v = viewOf(key);
  const k = startK(v);
  return `<figure class="jx" data-preset="${key}">
<div class="jx-bar">${controls(key, v)}</div>
<p class="jx-summary" data-part="summary">${esc(summaryLine(v))}</p>
<div class="jx-plot" data-part="plot" tabindex="0" aria-label="Chart. Use the left and right arrow keys, or point at the chart, to read one value of k.">${chart(v, k)}</div>
<div class="jx-readout" data-part="readout" aria-live="polite">${readout(v, k)}</div>
<figcaption>${esc(PRESETS[key].caption)}</figcaption>
</figure>`;
}
