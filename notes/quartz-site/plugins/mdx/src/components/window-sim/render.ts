// Markup for the window-sim figure. The build renders the whole figure from a
// preset, so the page shows finished charts before any script runs; the
// browser module re-runs the model and redraws the output parts from these
// same functions at the figure's real width.

import { MSS, simulate, summarize, type Result, type Summary } from "./model";
import {
  BUFS, CHUNKS, DURATIONS, PRESETS, RATES, READS, RTTS, fmtBytes, fmtMbps, fmtMs, fmtRate, presetById,
  toParams, type State,
} from "./state";

export const DEFAULT_WIDTH = 680;
const SEQ_H = 300;
const BUF_H = 150;
const M = { left: 58, right: 14, top: 14, bottom: 34 };

export interface View {
  t0: number; // ms
  t1: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

function ticks(lo: number, hi: number, target: number): number[] {
  const step = niceStep(hi - lo || 1, target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

const byteTick = (b: number, span: number): string => {
  if (span >= 4 * 1024 * 1024) return `${+(b / (1024 * 1024)).toFixed(1)} MiB`;
  if (span >= 4 * 1024) return `${+(b / 1024).toFixed(span >= 40 * 1024 ? 0 : 1)} KiB`;
  return `${Math.round(b)} B`;
};
const timeTick = (ms: number, span: number): string =>
  span >= 2000 ? `${+(ms / 1000).toFixed(2)} s` : `${+ms.toFixed(span < 20 ? 1 : 0)} ms`;

function axes(w: number, h: number, x: (v: number) => number, y: (v: number) => number, view: View,
  ylo: number, yhi: number, ylabel: string, ytarget: number): string {
  const parts: string[] = [];
  const tspan = view.t1 - view.t0;
  for (const v of ticks(ylo, yhi, ytarget)) {
    parts.push(`<line class="ws-grid" x1="${M.left}" x2="${w - M.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`,
      `<text class="ws-tick" x="${M.left - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${byteTick(v, yhi - ylo)}</text>`);
  }
  const xt = ticks(view.t0, view.t1, Math.max(3, Math.floor((w - M.left - M.right) / 90)));
  for (const v of xt) {
    parts.push(`<line class="ws-grid" x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${M.top}" y2="${h - M.bottom}"/>`,
      `<text class="ws-tick" x="${x(v).toFixed(1)}" y="${h - M.bottom + 16}" text-anchor="middle">${timeTick(v, tspan)}</text>`);
  }
  parts.push(`<text class="ws-axis" x="${w - M.right}" y="${h - 4}" text-anchor="end">time →</text>`,
    `<text class="ws-axis" x="${M.left + 4}" y="${M.top - 3}">↑ ${ylabel}</text>`);
  return parts.join("");
}

/** Step line through (t, v) points, clipped to the view and thinned to about one point per pixel. */
function stepPath(points: { t: number; v: number }[], x: (t: number) => number, y: (v: number) => number, view: View): string {
  let d = "";
  let lastV: number | null = null;
  let lastPx = -Infinity;
  let prev: { t: number; v: number } | null = null;
  for (const p of points) {
    if (p.t < view.t0) {
      prev = p;
      continue;
    }
    if (p.t > view.t1) break;
    if (lastV === null) {
      const start = prev ? prev.v : p.v;
      d += `M${x(view.t0).toFixed(1)} ${y(start).toFixed(1)}`;
      lastV = start;
    }
    const px = x(p.t);
    if (p.v !== lastV) {
      d += `H${px.toFixed(1)}V${y(p.v).toFixed(1)}`;
      lastV = p.v;
      lastPx = px;
    } else if (px - lastPx > 1) {
      lastPx = px;
    }
  }
  if (lastV === null && prev) {
    d = `M${x(view.t0).toFixed(1)} ${y(prev.v).toFixed(1)}`;
    lastV = prev.v;
  }
  if (lastV !== null) d += `H${x(view.t1).toFixed(1)}`;
  return d;
}

export interface Geometry {
  width: number;
  x: (t: number) => number;
  y: (seq: number) => number;
  view: View;
}

export function seqGeometry(r: Result, view: View, width: number): Geometry & { ylo: number; yhi: number } {
  // Fit the y range to everything sent or allowed inside the time window.
  let ylo = Infinity;
  let yhi = -Infinity;
  for (const tx of r.txs) {
    if (tx.t < view.t0 || tx.t > view.t1) continue;
    ylo = Math.min(ylo, tx.seq);
    yhi = Math.max(yhi, tx.seq + tx.len);
  }
  let lastBefore: number | null = null;
  for (const a of r.acks) {
    if (a.t < view.t0) {
      lastBefore = a.right;
      continue;
    }
    if (a.t > view.t1) break;
    yhi = Math.max(yhi, a.right);
    ylo = Math.min(ylo, a.ack);
  }
  if (lastBefore !== null) yhi = Math.max(yhi, lastBefore);
  if (view.t0 <= 0) {
    ylo = 0;
    yhi = Math.max(yhi, r.params.bufBytes);
  }
  if (!Number.isFinite(ylo)) {
    ylo = 0;
    yhi = r.params.bufBytes;
  }
  const pad = (yhi - ylo) * 0.04 || 1;
  ylo = Math.max(0, ylo - pad);
  yhi += pad;
  const plotW = width - M.left - M.right;
  const plotH = SEQ_H - M.top - M.bottom;
  const x = (t: number) => M.left + ((t - view.t0) / (view.t1 - view.t0)) * plotW;
  const y = (v: number) => M.top + (1 - (v - ylo) / (yhi - ylo)) * plotH;
  return { width, x, y, view, ylo, yhi };
}

export function seqChart(r: Result, view: View, width: number, zoomBox: [number, number] | null = null): string {
  const g = seqGeometry(r, view, width);
  const { x, y } = g;
  const parts: string[] = [axes(width, SEQ_H, x, y, view, g.ylo, g.yhi, "sequence number (bytes)", 6)];
  const clip = `<clipPath id="CLIPID"><rect x="${M.left}" y="${M.top}" width="${width - M.left - M.right}" height="${SEQ_H - M.top - M.bottom}"/></clipPath>`;
  parts.push(clip, `<g clip-path="url(#CLIPID)">`);

  // Allowed region: from the cumulative ACK up to the advertised right edge.
  parts.push(`<path class="ws-right" d="${stepPath(r.acks.map((a) => ({ t: a.t, v: a.right })), x, y, view)}"/>`);
  parts.push(`<path class="ws-ack" d="${stepPath(r.acks.map((a) => ({ t: a.t, v: a.ack })), x, y, view)}"/>`);
  parts.push(`<path class="ws-read" d="${stepPath(r.rcv.map((s) => ({ t: s.t, v: s.read })), x, y, view)}"/>`);

  // New data: one vertical tick per segment, merged per pixel column when dense.
  const cols = new Map<number, [number, number]>();
  let d = "";
  let dense = 0;
  for (const tx of r.txs) if (tx.kind === "new" && tx.t >= view.t0 && tx.t <= view.t1) dense++;
  const merge = dense > (width - M.left - M.right) / 2;
  for (const tx of r.txs) {
    if (tx.kind !== "new" || tx.lost || tx.t < view.t0 || tx.t > view.t1) continue;
    if (merge) {
      const col = Math.round(x(tx.t));
      const c = cols.get(col);
      if (c) {
        c[0] = Math.min(c[0], tx.seq);
        c[1] = Math.max(c[1], tx.seq + tx.len);
      } else cols.set(col, [tx.seq, tx.seq + tx.len]);
    } else {
      const px = x(tx.t).toFixed(1);
      const y0 = y(tx.seq);
      const y1 = Math.min(y(tx.seq + tx.len), y0 - 1.5);
      d += `M${px} ${y0.toFixed(1)}V${y1.toFixed(1)}`;
    }
  }
  for (const [col, [lo, hi]] of cols) {
    const y0 = y(lo);
    d += `M${col} ${y0.toFixed(1)}V${Math.min(y(hi), y0 - 1.5).toFixed(1)}`;
  }
  parts.push(`<path class="ws-seg" d="${d}"/>`);

  let rtx = "";
  let lost = "";
  let probes = "";
  for (const tx of r.txs) {
    if (tx.t < view.t0 || tx.t > view.t1) continue;
    const px = x(tx.t);
    if (tx.kind === "probe") {
      probes += `<circle class="ws-probe" cx="${px.toFixed(1)}" cy="${y(tx.seq + 1).toFixed(1)}" r="4"><title>Zero-window probe at ${fmtMs(tx.t)}</title></circle>`;
    } else if (tx.lost) {
      const cy = y(tx.seq + tx.len / 2);
      lost += `<path class="ws-lost" d="M${(px - 4).toFixed(1)} ${(cy - 4).toFixed(1)}l8 8m0 -8l-8 8"><title>Lost: bytes ${tx.seq}–${tx.seq + tx.len} sent at ${fmtMs(tx.t)}</title></path>`;
    } else if (tx.kind === "rtx") {
      const y0 = y(tx.seq);
      rtx += `M${px.toFixed(1)} ${y0.toFixed(1)}V${Math.min(y(tx.seq + tx.len), y0 - 3).toFixed(1)}`;
    }
  }
  parts.push(`<path class="ws-rtx" d="${rtx}"/>`, lost, probes);
  for (const u of r.updates) {
    if (u.t < view.t0 || u.t > view.t1) continue;
    parts.push(`<line class="ws-update${u.lost ? " ws-update-lost" : ""}" x1="${x(u.t).toFixed(1)}" x2="${x(u.t).toFixed(1)}" y1="${M.top}" y2="${SEQ_H - M.bottom}"><title>Window update ${u.lost ? "lost" : "sent"} at ${fmtMs(u.t)}</title></line>`);
  }
  if (zoomBox) {
    const [a, b] = zoomBox;
    parts.push(`<rect class="ws-brush" x="${Math.min(a, b)}" y="${M.top}" width="${Math.abs(b - a)}" height="${SEQ_H - M.top - M.bottom}"/>`);
  }
  parts.push(`</g>`);
  const label = `Time-sequence plot: data segments sent, the cumulative ACK, the advertised right edge of the window, and the bytes the application has read, from ${fmtMs(view.t0)} to ${fmtMs(view.t1)}.`;
  return `<svg class="ws-chart" viewBox="0 0 ${width} ${SEQ_H}" width="${width}" height="${SEQ_H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

export function bufChart(r: Result, view: View, width: number): string {
  const cap = r.params.bufBytes;
  const plotW = width - M.left - M.right;
  const plotH = BUF_H - M.top - M.bottom;
  const x = (t: number) => M.left + ((t - view.t0) / (view.t1 - view.t0)) * plotW;
  const y = (v: number) => M.top + (1 - v / cap) * plotH;
  const parts: string[] = [axes(width, BUF_H, x, y, view, 0, cap, "receive buffer", 3)];
  parts.push(`<line class="ws-cap" x1="${M.left}" x2="${width - M.right}" y1="${y(cap)}" y2="${y(cap)}"/>`);
  const held = stepPath(r.rcv.map((s) => ({ t: s.t, v: s.buffered })), x, y, view);
  if (held) parts.push(`<path class="ws-held" d="${held}V${y(0).toFixed(1)}H${x(view.t0).toFixed(1)}Z"/>`);
  parts.push(`<path class="ws-offer" d="${stepPath(r.rcv.map((s) => ({ t: s.t, v: Math.max(0, s.right - s.rcvNxt) })), x, y, view)}"/>`);
  const label = `Receiver buffer: bytes held waiting for the application, and the window the receiver last offered, from ${fmtMs(view.t0)} to ${fmtMs(view.t1)}.`;
  return `<svg class="ws-chart" viewBox="0 0 ${width} ${BUF_H}" width="${width}" height="${BUF_H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

export function readout(r: Result, s: Summary): string {
  const p = r.params;
  const limitText = { link: "the link", window: "the window", reader: "the reader" }[s.predicted.limit];
  const fresh = r.txs.filter((t) => t.kind === "new");
  const lines: string[] = [];
  lines.push(`<strong>${fmtMbps(s.goodputMbps)} Mbit/s</strong> reached the application over the second half of the run. ` +
    `The steady-state limit is ${fmtMbps(s.predicted.mbps)} Mbit/s, set by ${limitText}` +
    (s.predicted.limit === "window" ? `: ${fmtBytes(p.bufBytes)} per ${fmtMs(p.rttMs)} round trip.` : "."));
  const parts = [`${fresh.length.toLocaleString("en-US")} new segments, averaging ${Math.round(s.meanSegment)} bytes of data`];
  if (s.meanSegment < MSS * 0.9 && fresh.length) parts[0] += ` (${Math.round(s.overhead * 100)}% header overhead)`;
  if (r.retransmits) parts.push(`${r.retransmits} retransmitted`);
  lines.push(parts.join(", ") + ".");
  if (r.probes.length) {
    lines.push(`${r.probes.length} zero-window probe${r.probes.length > 1 ? "s" : ""} at ${r.probes.map(fmtMs).join(", ")}.`);
  }
  const lostUpdates = r.updates.filter((u) => u.lost).length;
  if (r.updates.length) {
    lines.push(`${r.updates.length} window update${r.updates.length > 1 ? "s" : ""} sent after reads${lostUpdates ? `, ${lostUpdates} lost` : ""}.`);
  }
  return lines.map((l) => `<span>${l}</span>`).join(" ");
}

const slider = (name: string, label: string, max: number, value: number, out: string) =>
  `<label class="ws-slider"><span>${label} <output name="${name}-out">${out}</output></span><input type="range" name="${name}" min="0" max="${max}" step="1" value="${value}" disabled></label>`;
const toggle = (name: string, label: string, checked: boolean) =>
  `<label class="ws-toggle"><input type="checkbox" name="${name}"${checked ? " checked" : ""} disabled> ${label}</label>`;

export function outputs(s: State): Record<string, string> {
  return {
    "rate-out": `${RATES[s.rate]} Mbit/s`,
    "rtt-out": `${RTTS[s.rtt]} ms`,
    "buf-out": fmtBytes(BUFS[s.buf] * 1024),
    "read-out": fmtRate(READS[s.read]),
    "chunk-out": fmtBytes(CHUNKS[s.chunk]),
    "duration-out": fmtMs(DURATIONS[s.duration]),
  };
}

export function bdpText(s: State): string {
  const bdp = (RATES[s.rate] * 1e6 * RTTS[s.rtt]) / 1e3 / 8;
  const buf = BUFS[s.buf] * 1024;
  return `Bandwidth-delay product ${fmtBytes(bdp)}; the buffer is ${buf >= bdp ? `${+(buf / bdp).toFixed(1)}×` : `${Math.round((100 * buf) / bdp)}% of`} that.`;
}

export interface Props {
  preset?: string;
}

let rendered = 0;

/** The whole figure, rendered at build time from a preset. */
export function render(props: Props): string {
  const preset = presetById(props.preset);
  const s = preset.state;
  const r = simulate(toParams(s));
  const sum = summarize(r);
  const view = { t0: 0, t1: r.params.durationMs };
  const o = outputs(s);
  const uid = `ws-${preset.id}-${++rendered}`;
  return [
    `<figure class="ws" data-preset="${preset.id}">`,
    `<form class="ws-form">`,
    `<div class="ws-presets" role="group" aria-label="Scenarios">`,
    ...PRESETS.map((p) => `<button type="button" name="preset" value="${p.id}" aria-pressed="${p.id === preset.id}" disabled>${p.label}</button>`),
    `</div>`,
    `<p class="ws-note" data-part="note">${preset.note}</p>`,
    `<div class="ws-controls">`,
    `<fieldset><legend>Path</legend>`,
    slider("rate", "Bottleneck rate", RATES.length - 1, s.rate, o["rate-out"]),
    slider("rtt", "Round-trip time", RTTS.length - 1, s.rtt, o["rtt-out"]),
    `</fieldset>`,
    `<fieldset><legend>Receiver</legend>`,
    slider("buf", "Receive buffer", BUFS.length - 1, s.buf, o["buf-out"]),
    slider("read", "Application reads", READS.length - 1, s.read, o["read-out"]),
    slider("chunk", "Bytes per read", CHUNKS.length - 1, s.chunk, o["chunk-out"]),
    `</fieldset>`,
    `<fieldset><legend>Run</legend>`,
    slider("duration", "Simulated time", DURATIONS.length - 1, s.duration, o["duration-out"]),
    toggle("pause", "Reader pauses for the middle third", s.pause),
    toggle("sws", "Silly window avoidance", s.sws),
    toggle("loseUpdate", "Lose the first window update", s.loseUpdate),
    `</fieldset>`,
    `</div>`,
    `<p class="ws-bdp" data-part="bdp">${bdpText(s)}</p>`,
    `</form>`,
    `<div class="ws-legend" aria-hidden="true"><span class="ws-key ws-key-seg">data sent</span><span class="ws-key ws-key-ack">ACKed</span><span class="ws-key ws-key-right">window edge</span><span class="ws-key ws-key-read">read by app</span><span class="ws-key ws-key-rtx">retransmit</span><span class="ws-key ws-key-probe">probe</span><span class="ws-key ws-key-update">window update</span></div>`,
    `<div class="ws-plot" data-part="seq">${seqChart(r, view, DEFAULT_WIDTH).replace(/CLIPID/g, `${uid}-clip`)}</div>`,
    `<div class="ws-plot-actions"><span class="ws-hint">Drag across the plot to zoom. Click a segment to lose it.</span><button type="button" name="unzoom" disabled hidden>Show the whole run</button><button type="button" name="clear-drops" disabled${s.drops.length ? "" : " hidden"}>Stop losing segments</button></div>`,
    `<div class="ws-legend" aria-hidden="true"><span class="ws-key ws-key-held">held for the application</span><span class="ws-key ws-key-offer">window offered</span></div>`,
    `<div class="ws-plot" data-part="buf">${bufChart(r, view, DEFAULT_WIDTH)}</div>`,
    `<p class="ws-readout" data-part="readout" aria-live="polite">${readout(r, sum)}</p>`,
    `<figcaption>Simulated, not measured: a discrete-event model of one bulk transfer with no congestion control, so the receiver's window is the only limit besides the link. ` +
      `The rules it follows and the ones it leaves out are listed in the model's source, <a href="https://github.com/elimelt/web/blob/main/notes/quartz-site/plugins/mdx/src/components/window-sim/model.ts">model.ts</a>.</figcaption>`,
    `</figure>`,
  ].join("");
}
