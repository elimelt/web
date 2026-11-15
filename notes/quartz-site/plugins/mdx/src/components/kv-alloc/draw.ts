// Markup shared by the build (render.ts) and the browser (client.ts): the
// memory map, the stacked memory chart and the two lines of text. Nothing here
// imports the trace, so the browser bundle stays small and fetches the slice.

import { esc } from "../../shared/format";
import { layout, type Kind, type Sample, type Sim, type Summary } from "./model";

export type TraceKey = "conv" | "code";
export const TRACES: TraceKey[] = ["conv", "code"];
export const TRACE_LABELS: Record<TraceKey, string> = { conv: "Conversation", code: "Code" };
export const KIND_LABELS: Record<Kind, string> = { max: "Reserve max", double: "Doubling", paged: "Paged" };

export interface Slices {
  budget: number;
  max_len: number;
  conv: [number, number][];
  code: [number, number][];
}

export interface View {
  trace: TraceKey;
  kind: Kind;
  block: number;
  t: number;
}

// Memory map geometry: one row per ROW_SLOTS slots (4 GiB of Llama-3-8B KV).
const W = 640;
export const ROW_SLOTS = 32768;
const ROW_H = 10;
const GAP = 2;
export const mapHeight = (budget: number) => Math.ceil(budget / ROW_SLOTS) * (ROW_H + GAP) - GAP;

export function mapSvg(sim: Sim | null, budget: number): string {
  const ROWS = Math.ceil(budget / ROW_SLOTS);
  const per = ROW_SLOTS;
  const ext = !!sim?.last && sim.last.external > 0;
  const rows: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    rows.push(`<rect class="kva-free${ext ? " kva-ext" : ""}" x="0" y="${r * (ROW_H + GAP)}" width="${W}" height="${ROW_H}"/>`);
  }
  const segs: string[] = [];
  if (sim) {
    for (const s of layout(sim)) {
      const row = Math.floor(s.addr / per);
      const x = ((s.addr - row * per) / per) * W;
      const w = (s.size / per) * W;
      segs.push(`<rect class="kva-${s.cat}" x="${x.toFixed(2)}" y="${row * (ROW_H + GAP)}" width="${w.toFixed(2)}" height="${ROW_H}"/>`);
    }
  }
  return `<svg class="kva-map" viewBox="0 0 ${W} ${mapHeight(budget)}" role="img" aria-label="Physical KV memory, one row per 4 GiB">${rows.join("")}${segs.join("")}</svg>`;
}

// Chart geometry.
const CH = 150;
const M = { left: 40, right: 8, top: 8, bottom: 24 };
export const CHART_H = CH;

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Stacked memory over the whole replay, with a cursor at iteration t. */
export function chartSvg(samples: Sample[], budget: number, t: number): string {
  const n = samples.length;
  const pw = W - M.left - M.right;
  const ph = CH - M.top - M.bottom;
  const x = (i: number) => M.left + (n > 1 ? (i / (n - 1)) * pw : 0);
  const y = (v: number) => M.top + ph - (v / budget) * ph;
  const stride = Math.max(1, Math.ceil(n / 400));
  const idx: number[] = [];
  for (let i = 0; i < n; i += stride) idx.push(i);
  if (n && idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const layers: [string, (s: Sample) => number][] = [
    ["used", (s) => s.used],
    ["reserved", (s) => s.reserved],
    ["internal", (s) => s.internal],
    ["external", (s) => s.external],
  ];
  const base = new Float64Array(idx.length);
  const paths: string[] = [];
  for (const [cls, f] of layers) {
    const top = idx.map((i, k) => base[k] + f(samples[i]));
    const up = idx.map((i, k) => `${x(i).toFixed(1)},${y(top[k]).toFixed(1)}`);
    const down = idx.map((i, k) => `${x(i).toFixed(1)},${y(base[k]).toFixed(1)}`).reverse();
    paths.push(`<polygon class="kva-${cls}" points="${up.join(" ")} ${down.join(" ")}"/>`);
    top.forEach((v, k) => (base[k] = v));
  }
  const grid = [0, 0.5, 1]
    .map((f) => `<line class="kva-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(f * budget)}" y2="${y(f * budget)}"/><text class="kva-tick" x="${M.left - 6}" y="${y(f * budget) + 4}" text-anchor="end">${pct(f)}</text>`)
    .join("");
  const steadyEnd = samples.findIndex((s) => s.waiting === 0);
  const qe =
    steadyEnd > 0
      ? `<line class="kva-qe" x1="${x(steadyEnd)}" x2="${x(steadyEnd)}" y1="${M.top}" y2="${M.top + ph}"/><text class="kva-tick" x="${x(steadyEnd) + 4}" y="${M.top + 10}">queue empty</text>`
      : "";
  const cx = x(Math.max(0, Math.min(n - 1, t - 1)));
  const axis = `<text class="kva-tick" x="${M.left}" y="${CH - 6}">1</text><text class="kva-tick" x="${W - M.right}" y="${CH - 6}" text-anchor="end">${n.toLocaleString("en-US")}</text><text class="kva-tick" x="${M.left + pw / 2}" y="${CH - 6}" text-anchor="middle">decode iteration</text>`;
  return `<svg class="kva-chart" viewBox="0 0 ${W} ${CH}" role="img" aria-label="Share of the KV budget by kind over the replay">${grid}${paths.join("")}${qe}<line class="kva-cursor" x1="${cx}" x2="${cx}" y1="${M.top - 4}" y2="${M.top + ph + 4}"/>${axis}</svg>`;
}

const nf = (v: number) => Math.round(v).toLocaleString("en-US");

export function nowText(s: Sample | null, t: number, n: number, sim: Sim | null, budget: number): string {
  if (!s || !sim) return "Loading the trace slice…";
  const parts = [
    `<b>Iteration ${nf(t)}</b> of ${nf(n)}: ${nf(s.running)} running, ${nf(s.waiting)} waiting, ${nf(sim.preemptions)} preemption${sim.preemptions === 1 ? "" : "s"} so far.`,
    `Used ${pct(s.used / budget)}, reserved ${pct(s.reserved / budget)}, internal fragmentation ${pct(s.internal / budget)}, external fragmentation ${pct(s.external / budget)}, free ${pct(s.free / budget)}.`,
  ];
  return parts.join(" ");
}

export function summaryText(sum: Summary, kind: Kind, generated: number): string {
  const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;
  const extra: string[] = [];
  if (sum.preemptions) extra.push(`${nf(sum.preemptions)} preemptions recomputed ${nf(sum.recomputed)} tokens (${(sum.recomputed / generated).toFixed(2)} per generated token)`);
  if (kind === "double") extra.push(`growth copied ${nf(sum.copied)} tokens of KV`);
  return `While requests wait (${nf(sum.steadyIterations)} iterations): ${sum.running.toFixed(1)} running on average, ${p1(sum.used)} of the budget holds KV, ${p1(sum.reserved)} is reserved, ${p1(sum.internal)} is internal and ${p1(sum.external)} external fragmentation.${extra.length ? ` Over the replay, ${extra.join("; ")}.` : ""}`;
}

export function legend(): string {
  const item = (cls: string, label: string) => `<span><i class="kva-sw kva-${cls}"></i>${esc(label)}</span>`;
  return [item("used", "used"), item("reserved", "reserved for future tokens"), item("internal", "internal fragmentation"), item("external", "external fragmentation"), item("free", "free")].join("");
}
