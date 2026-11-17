// Markup for the prefetch distance figure. The build draws the chart and the
// readout for the default distance; the client redraws both from the same
// functions when the slider moves.

import { esc } from "../../shared/format";
import {
  best,
  bufferFloor,
  curve,
  derive,
  distances,
  HINT_INSN,
  HINT_NAME,
  hot,
  LATENCY,
  mowry,
  preset,
  type Preset,
} from "./model";

export interface Props {
  pages?: unknown;
  work?: unknown;
  hints?: unknown;
  distance?: unknown;
}

export const W = 640;
export const H = 250;
const M = { left: 52, right: 14, top: 12, bottom: 38 };
const f = (x: number): string => x.toFixed(1);
const ns = (x: number): string => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));

// x is log2 of the distance; "none" (D = 0) sits one and a half steps left of 1.
const NONE = -1.5;
const X_HI = 12.4;
export const xPos = (d: number): number => {
  const v = d === 0 ? NONE : Math.log2(d);
  return M.left + 6 + ((v - NONE) / (X_HI - NONE)) * (W - M.left - M.right - 12);
};

const Y_TICKS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

export function yRange(p: Preset): [number, number] {
  const vals = p.hints.flatMap((h) => curve(p, h).rows.flatMap((r) => [r[2], r[3]]));
  const lo = Math.min(...vals, bufferFloor(p), hot(p)) * 0.8;
  const hi = Math.max(...vals) * 1.15;
  return [lo, hi];
}

export function chartSvg(p: Preset, d: number): string {
  const [lo, hi] = yRange(p);
  const plotH = H - M.top - M.bottom;
  const y = (v: number) => M.top + (1 - (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * plotH;
  const label = `Nanoseconds per element against prefetch distance, ${p.work} rounds of work per element, ${p.pages === "2m" ? "2 MB" : "4 KB"} pages`;
  const out: string[] = [`<svg viewBox="0 0 ${W} ${H}" class="pd-chart" role="img" aria-label="${esc(label)}">`];
  for (const v of Y_TICKS) {
    if (v < lo || v > hi) continue;
    const yy = f(y(v));
    out.push(`<line class="pd-grid" x1="${M.left}" x2="${W - M.right}" y1="${yy}" y2="${yy}"/>`);
    out.push(`<text class="pd-tick" x="${M.left - 6}" y="${f(y(v) + 4)}" text-anchor="end">${v}</text>`);
  }
  for (const t of [0, 1, 4, 16, 64, 256, 1024, 4096]) {
    const minor = t === 4 || t === 256 ? " pd-minor" : "";
    out.push(`<text class="pd-tick${minor}" x="${f(xPos(t))}" y="${H - M.bottom + 17}" text-anchor="middle">${t === 0 ? "none" : t}</text>`);
  }
  out.push(`<text class="pd-axis" x="${M.left + (W - M.left - M.right) / 2}" y="${H - 3}" text-anchor="middle">prefetch distance D (elements ahead)</text>`);
  const ym = M.top + plotH / 2;
  out.push(`<text class="pd-axis" x="13" y="${f(ym)}" text-anchor="middle" transform="rotate(-90 13 ${f(ym)})">ns per element</text>`);

  // Floors: the compute time with the data in L1, and L / C.
  const floors: [number, string, string][] = [
    [hot(p), "pd-floor-hot", `data in L1 ${ns(hot(p))}`],
    [bufferFloor(p), "pd-floor-fb", `L / 16 = ${ns(bufferFloor(p))}`],
  ];
  // When the two floors are close, the lower one's label goes under its line.
  const lower = floors[0][0] <= floors[1][0] ? 0 : 1;
  const close = Math.abs(y(floors[0][0]) - y(floors[1][0])) < 16;
  floors.forEach(([v, cls, text], i) => {
    if (v < lo || v > hi) return;
    const below = close && i === lower;
    out.push(`<line class="pd-floor ${cls}" x1="${M.left}" x2="${W - M.right}" y1="${f(y(v))}" y2="${f(y(v))}"/>`);
    out.push(`<text class="pd-note" x="${W - M.right - 2}" y="${f(below ? y(v) + 12 : y(v) - 4)}" text-anchor="end">${esc(text)}</text>`);
  });
  // Mowry's distance, where the lead time first covers L.
  const dm = mowry(p);
  if (dm <= 4096) {
    const xx = f(xPos(dm));
    out.push(`<line class="pd-mowry" x1="${xx}" x2="${xx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    // The label sits on the side of the line away from the cursor.
    const left = xPos(d) > xPos(dm);
    out.push(`<text class="pd-note" x="${f(xPos(dm) + (left ? -4 : 4))}" y="${M.top + 11}" text-anchor="${left ? "end" : "start"}">D* = ${dm}</text>`);
  }
  const cx = f(xPos(d));
  out.push(`<line class="pd-cursor" x1="${cx}" x2="${cx}" y1="${M.top}" y2="${H - M.bottom}"/>`);

  // Series, the primary hint drawn last so it sits on top.
  for (const h of [...p.hints].reverse()) {
    const rows = curve(p, h).rows;
    out.push(`<g class="pd-series pd-h${h}">`);
    if (h === p.hints[0]) {
      for (const r of rows) out.push(`<line class="pd-range" x1="${f(xPos(r[0]))}" x2="${f(xPos(r[0]))}" y1="${f(y(r[2]))}" y2="${f(y(r[3]))}"/>`);
    }
    out.push(`<polyline points="${rows.map((r) => `${f(xPos(r[0]))},${f(y(r[1]))}`).join(" ")}"/>`);
    for (const r of rows) {
      const here = r[0] === d ? " pd-here" : "";
      out.push(`<circle class="${here.trim()}" cx="${f(xPos(r[0]))}" cy="${f(y(r[1]))}" r="${here ? 5 : 3}"/>`);
    }
    out.push(`</g>`);
  }
  out.push(`</svg>`);
  return out.join("");
}

export function readoutHtml(p: Preset, d: number): string {
  const L = LATENCY[p.pages];
  const h0 = p.hints[0];
  const x = derive(p, h0, d);
  if (!x) return "";
  const parts: string[] = [];
  if (d === 0) {
    parts.push(`<span>No prefetch: <b>${ns(x.t)} ns</b> per element (${ns(x.lo)} to ${ns(x.hi)})</span>`);
    parts.push(`<span>Little's law: ${f(L)} ÷ ${ns(x.t)} = <b>${f(x.inFlight)}</b> misses in flight from the out-of-order window alone</span>`);
  } else {
    parts.push(`<span>D = ${d}, ${HINT_INSN[h0]}: <b>${ns(x.t)} ns</b> per element (${ns(x.lo)} to ${ns(x.hi)}), <b>${x.speedup.toFixed(2)}×</b> no prefetch</span>`);
    const cover = x.lead / L;
    parts.push(
      `<span>Lead time ${d} × ${ns(x.t)} = <b>${x.lead >= 1000 ? `${(x.lead / 1000).toFixed(1)} µs` : `${x.lead.toFixed(0)} ns`}</b>, ${cover >= 10 ? cover.toFixed(0) : cover.toFixed(1)}× the ${f(L)} ns miss latency</span>`,
    );
    parts.push(`<span>Little's law: ${f(L)} ÷ ${ns(x.t)} = <b>${f(x.inFlight)}</b> misses in flight</span>`);
  }
  const others = p.hints.slice(1).flatMap((h) => {
    const y = derive(p, h, d);
    return y ? [`${HINT_NAME[h]} ${ns(y.t)}`] : [];
  });
  if (d > 0 && others.length) parts.push(`<span>Other hints at D = ${d}: ${others.join(", ")} ns</span>`);
  return parts.join("");
}

export function defaultDistance(p: Preset, asked: unknown): number {
  const ds = distances(p);
  const n = Number(asked);
  if (ds.includes(n)) return n;
  return best(p, p.hints[0])[0];
}

export function render(props: Props = {}): string {
  const p = preset(props);
  const ds = distances(p);
  const d = defaultDistance(p, props.distance);
  const pagesText = p.pages === "2m" ? "2 MB pages" : "4 KB pages";
  const key = p.hints
    .map((h) => `<span><i class="pd-key pd-h${h}"></i>${HINT_INSN[h]}${h === p.hints[0] ? ", median and range" : ""}</span>`)
    .join("");
  return `<figure class="pd" data-pages="${p.pages}" data-work="${p.work}" data-hints="${p.hints.join(",")}">
<label class="pd-slider"><span>Prefetch distance D <output name="d-out">${d === 0 ? "none" : d}</output></span><input type="range" name="d" min="0" max="${ds.length - 1}" step="1" value="${ds.indexOf(d)}" disabled></label>
<div class="pd-plot" data-part="chart">${chartSvg(p, d)}</div>
<p class="pd-keys">${key}<span><i class="pd-key pd-key-floor"></i>floors</span><span><i class="pd-key pd-key-mowry"></i>⌈L / c⌉</span></p>
<p class="pd-readout" data-part="readout" aria-live="polite">${readoutHtml(p, d)}</p>
<figcaption>Measured, not simulated: sum += mix(a[idx[i]], W) with W = ${p.work} rounds of multiply and shift per element and a prefetch of a[idx[i + D]], on a 4 GiB array with ${pagesText} in a KVM guest on an Emerald Rapids Xeon. Each point is the median of 12 runs. L = ${f(LATENCY[p.pages])} ns is the single-chain miss latency measured on the same VM; c is the time per element when the array fits in L1.</figcaption>
</figure>`;
}
