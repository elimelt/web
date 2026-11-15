// Markup for the slowdown-by-size chart. One copy shows a few policies at one
// load; buttons switch the load. The y axis is fixed per copy.

import { esc } from "../../shared/format";
import { BUCKETS, ceiling, LOADS, NAMES, POLICIES, series } from "./model";

export interface Props {
  policies?: string;
  rho?: number;
  caption?: string;
}

export interface State {
  policies: string[];
  load: string;
  top: number;
}

export function stateFrom(props: Props): State {
  const policies = (props.policies ?? "fifo,ps,srpt")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => POLICIES.includes(p))
    .slice(0, 5);
  const want = typeof props.rho === "number" ? String(props.rho) : LOADS[LOADS.length - 1];
  const load = LOADS.includes(want) ? want : LOADS[LOADS.length - 1];
  const list = policies.length ? policies : ["ps"];
  return { policies: list, load, top: ceiling(list) };
}

const W = 640;
const H = 270;
const M = { left: 52, right: 12, top: 12, bottom: 44 };
const COLORS = ["var(--fig-blue)", "var(--fig-orange)", "var(--fig-green)", "var(--fig-purple)", "var(--fig-red)"];

const sig = (v: number): string => (v >= 100 ? Math.round(v).toLocaleString("en-US") : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const secs = (v: number): string => (v < 1 ? `${+(v * 1000).toPrecision(2)} ms` : `${+v.toPrecision(2)} s`);
const short = (v: number): string => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}k` : String(v));

export function chartSvg(s: State): string {
  const n = BUCKETS.length;
  const x = (i: number) => M.left + ((i + 0.5) / n) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - Math.log10(Math.max(v, 1)) / Math.log10(s.top)) * (H - M.top - M.bottom);
  const parts: string[] = [];
  // Grid and y labels at powers of ten.
  for (let e = 0; 10 ** e <= s.top; e++) {
    const v = 10 ** e;
    parts.push(`<line class="sb-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(v)}" y2="${y(v)}"/>`);
    parts.push(`<text class="sb-ylab" x="${M.left - 6}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`);
  }
  // x labels: the bucket's upper size percentile.
  BUCKETS.forEach((b, i) => {
    const thin = ![1, 3, 5, 7, 9, 11, 12].includes(i) ? " sb-thin" : "";
    parts.push(`<text class="sb-xlab${thin}" x="${x(i)}" y="${H - M.bottom + 16}" text-anchor="middle">${b.pct[1]}</text>`);
  });
  parts.push(`<text class="sb-axis" x="${(M.left + W - M.right) / 2}" y="${H - 6}" text-anchor="middle">job size percentile (bucket's upper edge; larger jobs to the right)</text>`);
  parts.push(`<text class="sb-axis" transform="translate(13 ${(M.top + H - M.bottom) / 2}) rotate(-90)" text-anchor="middle">mean slowdown</text>`);
  // The processor-sharing reference: every size has slowdown 1/(1 - rho).
  const fair = 1 / (1 - Number(s.load));
  parts.push(`<line class="sb-fair" x1="${M.left}" x2="${W - M.right}" y1="${y(fair)}" y2="${y(fair)}"/>`);
  parts.push(`<text class="sb-fairlab" x="${W - M.right - 4}" y="${y(fair) - 5}" text-anchor="end">1/(1−ρ) = ${sig(fair)}</text>`);
  s.policies.forEach((p, k) => {
    const d = series(s.load, p)!;
    const pts = d.map(([m], i) => `${x(i).toFixed(1)},${y(m).toFixed(1)}`).join(" ");
    const bars = d
      .map(([, lo, hi], i) => (hi / lo > 1.05 ? `<line x1="${x(i)}" x2="${x(i)}" y1="${y(lo)}" y2="${y(hi)}"/>` : ""))
      .join("");
    const dots = d
      .map(([m, lo, hi], i) => {
        const b = BUCKETS[i];
        const t = `${NAMES[p]}: jobs ${secs(b.size[0])} to ${secs(b.size[1])} (size percentile ${b.pct[0]} to ${b.pct[1]}), mean slowdown ${sig(m)} (seeds ${sig(lo)} to ${sig(hi)})`;
        return `<circle cx="${x(i).toFixed(1)}" cy="${y(m).toFixed(1)}" r="3.2"><title>${esc(t)}</title></circle>`;
      })
      .join("");
    parts.push(`<g class="sb-series" style="--c:${COLORS[k]}"><polyline points="${pts}"/><g class="sb-err">${bars}</g>${dots}</g>`);
  });
  return `<svg class="sb-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mean slowdown by job size at load ${s.load}">${parts.join("")}</svg>`;
}

export function legendHtml(s: State): string {
  return s.policies
    .map((p, k) => `<span class="sb-key"><i style="background:${COLORS[k]}"></i>${esc(NAMES[p])}</span>`)
    .join("");
}

export function render(props: Props): string {
  const s = stateFrom(props);
  const buttons = LOADS.map(
    (l) => `<button type="button" name="load" value="${l}" aria-pressed="${l === s.load}" disabled>ρ = ${l}</button>`,
  ).join("");
  return `<figure class="sb" data-state="${esc(JSON.stringify(s))}">
<div class="sb-top"><div class="sb-loads" role="group" aria-label="Load">${buttons}</div><div class="sb-legend">${legendHtml(s)}</div></div>
<div data-part="chart">${chartSvg(s)}</div>
${props.caption ? `<figcaption>${esc(props.caption)}</figcaption>` : ""}
</figure>`;
}
