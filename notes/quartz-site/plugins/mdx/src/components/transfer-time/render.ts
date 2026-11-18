// Markup for the transfer-time figure. The build draws the chart and readout for
// the starting path; the client redraws both from the same functions when the
// reader picks a rate, a round-trip time, a congestion controller or a size.

import { esc, num } from "../../shared/format";
import {
  IW,
  RATES,
  RTTS,
  SIZES,
  bdpBytes,
  flights,
  floorMs,
  idleMs,
  restartWindow,
  windowFor,
  measured,
  modelMs,
  segmentArrivals,
  sizeLabel,
  MSS,
  type Cc,
  type Mode,
  type Path,
  type Point,
} from "./model";

export const W = 640;
export const H = 340;
const M = { left: 56, right: 14, top: 12, bottom: 44 };
const X0 = Math.log10(512);
const X1 = Math.log10(128 << 20);
const Y0 = Math.log10(0.5);
const Y1 = Math.log10(20000);
const plotW = W - M.left - M.right;
const plotH = H - M.top - M.bottom;
const sx = (n: number) => M.left + ((Math.log10(n) - X0) / (X1 - X0)) * plotW;
const sy = (ms: number) => M.top + (1 - (Math.log10(Math.max(ms, 1e-6)) - Y0) / (Y1 - Y0)) * plotH;
const f1 = (v: number) => v.toFixed(1);

export interface State {
  rate: number;
  rtt: number;
  cc: Cc;
  size: number; // index into SIZES
}

const MODES: { mode: Mode; cls: string; label: string }[] = [
  { mode: "fresh", cls: "tt-blue", label: "new connection" },
  { mode: "idle", cls: "tt-orange", label: "open, after 1 s idle" },
  { mode: "warm", cls: "tt-green", label: "open, window already grown" },
  { mode: "udp", cls: "tt-gray", label: "UDP burst, one way" },
];

/** Milliseconds as a tick or readout label. */
export function msLabel(ms: number): string {
  if (ms >= 1000) return `${num(ms / 1000, ms >= 10000 ? 0 : 1)} s`;
  if (ms >= 10) return `${num(ms, 0)} ms`;
  return `${num(ms, ms >= 1 ? 1 : 2)} ms`;
}

/** Starting windows for the open-connection curves: the measured window, and the window after the idle restart. */
export function windows(p: Path, cc: Cc): { warm: number; idle: number } {
  const w = windowFor(p, cc);
  if (!w) return { warm: 1e9, idle: 1e9 };
  return { warm: w.cwnd, idle: restartWindow(w.cwnd, w.rto_ms, idleMs(p), cc) };
}

/** Model curves sampled densely across the size axis. */
export function curves(p: Path, cc: Cc) {
  const ns: number[] = [];
  for (let e = Math.log2(1024); e <= Math.log2(64 << 20) + 1e-9; e += 0.125) ns.push(Math.round(2 ** e));
  const segs = Math.ceil(ns[ns.length - 1] / MSS);
  const w = windows(p, cc);
  const fresh = segmentArrivals(p, IW, "fresh", segs);
  const open = segmentArrivals(p, w.warm, "open", segs);
  const restart = segmentArrivals(p, w.idle, "open", segs);
  return {
    ns,
    floor: ns.map((n) => floorMs(p, n)),
    fresh: ns.map((n) => modelMs(p, n, IW, "fresh", fresh)),
    warm: ns.map((n) => modelMs(p, n, w.warm, "open", open)),
    // BBR keeps its window across idle time, so its idle curve is the warm one.
    idle: w.idle !== w.warm ? ns.map((n) => modelMs(p, n, w.idle, "open", restart)) : null,
  };
}

function line(ns: number[], ms: number[], cls: string): string {
  const d = ns.map((n, i) => `${i ? "L" : "M"}${f1(sx(n))} ${f1(sy(ms[i]))}`).join("");
  return `<path class="${cls}" d="${d}"/>`;
}

function dots(pts: Point[], cls: string, sel: number): string {
  const out = [`<g class="tt-series ${cls}">`];
  for (const q of pts) {
    const x = f1(sx(q.n));
    if (q.max / q.min > 1.02) out.push(`<line class="tt-whisker" x1="${x}" x2="${x}" y1="${f1(sy(q.min))}" y2="${f1(sy(q.max))}"/>`);
    out.push(`<circle cx="${x}" cy="${f1(sy(q.med))}" r="${q.n === sel ? 5 : 3.3}"${q.n === sel ? ' class="tt-sel"' : ""}/>`);
  }
  out.push(`</g>`);
  return out.join("");
}

export function chart(s: State): string {
  const p: Path = { rateMbit: s.rate, rttMs: s.rtt };
  const n = SIZES[s.size];
  const out: string[] = [];
  for (let e = Math.ceil(Y0); e <= Math.floor(Y1); e++) {
    const y = f1(sy(10 ** e));
    out.push(`<line class="tt-grid" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`);
    out.push(`<text class="tt-tick" x="${M.left - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${msLabel(10 ** e)}</text>`);
  }
  for (let k = 10; k <= 26; k += 4) {
    const x = f1(sx(2 ** k));
    out.push(`<line class="tt-grid" x1="${x}" x2="${x}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    out.push(`<text class="tt-tick" x="${x}" y="${H - M.bottom + 17}" text-anchor="middle">${sizeLabel(2 ** k)}</text>`);
  }
  out.push(`<text class="tt-axis" x="${(M.left + W - M.right) / 2}" y="${H - 6}" text-anchor="middle">message size</text>`);
  const ym = (M.top + H - M.bottom) / 2;
  out.push(`<text class="tt-axis tt-yaxis" x="13" y="${ym}" text-anchor="middle" transform="rotate(-90 13 ${ym})">time to last byte</text>`);
  // The bandwidth-delay product: below it the round trips dominate, above it L/R does.
  const bdp = bdpBytes(p);
  if (bdp > 2 ** 9 && bdp < 2 ** 27) {
    const x = f1(sx(bdp));
    out.push(`<line class="tt-bdp" x1="${x}" x2="${x}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    out.push(`<text class="tt-label" x="${(+x + 4).toFixed(1)}" y="${M.top + 12}">BDP ${sizeLabel(Math.round(bdp))}</text>`);
  }
  const c = curves(p, s.cc);
  out.push(line(c.ns, c.floor, "tt-curve tt-floor"));
  out.push(line(c.ns, c.warm, "tt-curve tt-green-line"));
  if (c.idle) out.push(line(c.ns, c.idle, "tt-curve tt-orange-line"));
  out.push(line(c.ns, c.fresh, "tt-curve tt-blue-line"));
  const x = f1(sx(n));
  out.push(`<line class="tt-cursor" x1="${x}" x2="${x}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  for (const m of [...MODES].reverse()) out.push(dots(measured(p, m.mode, s.cc), m.cls, n));
  return `<svg viewBox="0 0 ${W} ${H}" class="tt-chart" role="img" aria-label="${esc(`Time to deliver a message against its size, log-log, at ${s.rate} Mbit/s and ${s.rtt} ms round trip. ${readout(s).replace(/<[^>]+>/g, "")}`)}">${out.join("")}</svg>`;
}

const at = (pts: Point[], n: number) => pts.find((q) => q.n === n);

export function readout(s: State): string {
  const p: Path = { rateMbit: s.rate, rttMs: s.rtt };
  const n = SIZES[s.size];
  const floor = floorMs(p, n);
  const udp = at(measured(p, "udp", s.cc), n);
  const fresh = at(measured(p, "fresh", s.cc), n);
  const warm = at(measured(p, "warm", s.cc), n);
  const idle = at(measured(p, "idle", s.cc), n);
  const head = `<strong>${sizeLabel(n)}</strong> at ${s.rate} Mbit/s, ${s.rtt} ms round trip (BDP ${sizeLabel(Math.round(bdpBytes(p)))}).`;
  if (!fresh) return `${head} Not measured: the transfer would take more than 4 s at this rate. The lines are the model.`;
  const eff = (n * 8) / (fresh.med * 1e3); // Mbit/s
  const parts = [
    head,
    `One-way floor d + L/R: ${msLabel(floor)}${udp ? ` (UDP burst measured ${msLabel(udp.med)})` : ""}.`,
    `New connection: <strong>${msLabel(fresh.med)}</strong> measured, ${msLabel(modelMs(p, n, IW, "fresh"))} in the model (${flights(n, IW)} flight${flights(n, IW) > 1 ? "s" : ""} after the handshake), an effective <strong>${num(eff, eff < 10 ? 2 : 1)} Mbit/s</strong>, ${num((eff / s.rate) * 100, eff / s.rate < 0.1 ? 1 : 0)}% of the link.`,
  ];
  if (warm) parts.push(`Open connection: ${msLabel(warm.med)}${idle ? `; after 1 s idle: ${msLabel(idle.med)}` : ""}.`);
  return parts.join(" ");
}

// ---------- figure ----------

export interface Props {
  rate?: unknown;
  rtt?: unknown;
  cc?: unknown;
  size?: unknown;
}

export function initial(props: Props = {}): State {
  const rate = RATES.includes(Number(props.rate)) ? Number(props.rate) : 100;
  const rtt = RTTS.includes(Number(props.rtt)) ? Number(props.rtt) : 20;
  const cc: Cc = props.cc === "cubic" ? "cubic" : "bbr";
  const si = SIZES.indexOf(Number(props.size));
  return { rate, rtt, cc, size: si >= 0 ? si : SIZES.indexOf(65536) };
}

function group(name: string, label: string, values: (number | string)[], cur: number | string, fmt: (v: number | string) => string): string {
  return `<div class="tt-group" role="group" aria-label="${esc(label)}"><span class="tt-glabel">${esc(label)}</span>${values
    .map((v) => `<button type="button" name="${name}-${v}" data-${name}="${v}" aria-pressed="${v === cur}" disabled>${esc(fmt(v))}</button>`)
    .join("")}</div>`;
}

export function legend(cc: Cc): string {
  return `<div class="tt-legend" aria-hidden="true">${MODES.map(
    (m) => `<span class="${m.cls}-key">● ${esc(m.label)}</span>`,
  ).join("")}<span class="tt-key-line">lines: model${cc === "bbr" ? " (BBR keeps its window when idle)" : ""}</span></div>`;
}

export function render(props: Props = {}): string {
  const s = initial(props);
  const controls = `<div class="tt-controls">
${group("rate", "link rate", RATES, s.rate, (v) => `${v} Mbit/s`)}
${group("rtt", "round trip", RTTS, s.rtt, (v) => `${v} ms`)}
${group("cc", "sender", ["bbr", "cubic"], s.cc, (v) => String(v).toUpperCase())}
<label class="tt-slider"><span>message size <output name="size-out">${sizeLabel(SIZES[s.size])}</output></span><input type="range" name="size" min="0" max="${SIZES.length - 1}" step="1" value="${s.size}" aria-label="message size, in powers of four" disabled></label>
</div>`;
  return `<figure class="tt" data-rate="${s.rate}" data-rtt="${s.rtt}" data-cc="${s.cc}" data-size="${s.size}">
${controls}
<div data-part="legend">${legend(s.cc)}</div>
<div class="tt-plot" data-part="chart">${chart(s)}</div>
<p class="tt-readout" data-part="readout" aria-live="polite">${readout(s)}</p>
<figcaption>Dots: median of 5 runs on the Linux TCP stack across a user-space emulated link, whiskers min to max. Lines: the packet-level slow-start model in the text, computed in the browser; open connections start from the window measured on the connection. The model omits the 4 MiB send-buffer limit that slows large transfers at 1 Gbit/s and 100 ms. Dashed gray: the one-way floor d + L/R.</figcaption>
</figure>`;
}
