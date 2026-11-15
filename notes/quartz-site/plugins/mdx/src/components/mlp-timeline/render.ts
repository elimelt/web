// Markup for the MLP timeline figure. The build renders the default scenario
// in full; the client redraws the timeline, readout and chart from the same
// functions whenever a slider moves.

import { esc } from "../../shared/format";
import { clamp, closedForm, DEFAULTS, LIMITS, MEASURED, simulate, type Result } from "./model";

export interface Params {
  chains: number;
  latency: number;
  buffers: number;
}

interface Props {
  chains?: unknown;
  latency?: unknown;
  buffers?: unknown;
}

const f = (x: number): string => x.toFixed(1);

// Timeline geometry: a fixed 1,200 ns window, so a longer latency shows fewer
// misses per chain.
export const WINDOW_NS = 1200;
const TW = 640;
const TH = 200;
const TM = { left: 54, right: 12, top: 8, bottom: 30 };

export function timelineSvg(p: Params, r: Result): string {
  const plotW = TW - TM.left - TM.right;
  const plotH = TH - TM.top - TM.bottom;
  const x = (t: number) => TM.left + (Math.min(t, WINDOW_NS) / WINDOW_NS) * plotW;
  const rowH = plotH / p.chains;
  const barH = Math.max(1.2, Math.min(12, rowH * 0.72));
  const out: string[] = [
    `<svg viewBox="0 0 ${TW} ${TH}" class="mt-timeline" role="img" aria-label="${esc(`Timeline of ${p.chains} chains sharing ${p.buffers} fill buffers, each miss taking ${p.latency} ns`)}">`,
  ];
  for (let t = 0; t <= WINDOW_NS; t += 200) {
    const xx = f(x(t));
    out.push(`<line class="mt-grid" x1="${xx}" x2="${xx}" y1="${TM.top}" y2="${TH - TM.bottom}"/>`);
    out.push(`<text class="mt-tick" x="${xx}" y="${TH - TM.bottom + 15}" text-anchor="middle">${t}</text>`);
  }
  out.push(`<text class="mt-axis" x="${TM.left + plotW / 2}" y="${TH - 2}" text-anchor="middle">time (ns)</text>`);
  const ym = TM.top + plotH / 2;
  out.push(`<text class="mt-axis" x="14" y="${f(ym)}" text-anchor="middle" transform="rotate(-90 14 ${f(ym)})">chain</text>`);
  if (p.chains <= 16) {
    for (let c = 0; c < p.chains; c++) {
      const yy = TM.top + (c + 0.5) * rowH + 4;
      const dense = p.chains > 8 && c > 0 && c < p.chains - 1 ? " mt-dense" : "";
      out.push(`<text class="mt-tick${dense}" x="${TM.left - 6}" y="${f(yy)}" text-anchor="end">${c + 1}</text>`);
    }
  } else {
    out.push(`<text class="mt-tick" x="${TM.left - 6}" y="${f(TM.top + 0.5 * rowH + 4)}" text-anchor="end">1</text>`);
    out.push(`<text class="mt-tick" x="${TM.left - 6}" y="${f(TM.top + (p.chains - 0.5) * rowH + 4)}" text-anchor="end">${p.chains}</text>`);
  }
  for (const m of r.misses) {
    if (m.ready >= WINDOW_NS) continue;
    const y0 = TM.top + m.chain * rowH + (rowH - barH) / 2;
    if (m.start > m.ready) {
      out.push(`<rect class="mt-wait" x="${f(x(m.ready))}" y="${f(y0)}" width="${f(Math.max(0.5, x(m.start) - x(m.ready)))}" height="${f(barH)}"/>`);
    }
    if (m.start < WINDOW_NS) {
      // A small gap at each end keeps back-to-back misses visibly separate.
      const x0 = x(m.start) + 0.6;
      const x1 = x(m.end) - 0.6;
      out.push(`<rect class="mt-miss" x="${f(x0)}" y="${f(y0)}" width="${f(Math.max(0.5, x1 - x0))}" height="${f(barH)}"/>`);
    }
  }
  out.push(`</svg>`);
  return out.join("");
}

// Chart geometry: ns per access against chain count, log scale.
const CW = 640;
const CH = 230;
const CM = { left: 54, right: 12, top: 10, bottom: 36 };
const Y_LO = 5;
const Y_HI = 400;

export function chartSvg(p: Params): string {
  const plotW = CW - CM.left - CM.right;
  const plotH = CH - CM.top - CM.bottom;
  const [kmin, kmax] = LIMITS.chains;
  const x = (k: number) => CM.left + 8 + ((k - kmin) / (kmax - kmin)) * (plotW - 16);
  const lo = Math.log10(Y_LO);
  const hi = Math.log10(Y_HI);
  const y = (v: number) => CM.top + (1 - (Math.log10(Math.min(Y_HI, Math.max(Y_LO, v))) - lo) / (hi - lo)) * plotH;
  const out: string[] = [
    `<svg viewBox="0 0 ${CW} ${CH}" class="mt-chart" role="img" aria-label="Nanoseconds per access against chain count: the queue model and the measured points">`,
  ];
  for (const v of [5, 10, 20, 50, 100, 200, 400]) {
    const yy = f(y(v));
    const minor = v === 10 || v === 100 ? "" : " mt-minor";
    out.push(`<line class="mt-grid" x1="${CM.left}" x2="${CW - CM.right}" y1="${yy}" y2="${yy}"/>`);
    out.push(`<text class="mt-tick${minor}" x="${CM.left - 6}" y="${f(y(v) + 4)}" text-anchor="end">${v}</text>`);
  }
  for (const k of [1, 4, 8, 12, 16, 20, 24, 28, 32]) {
    const minor = k % 8 === 4 ? " mt-minor" : "";
    out.push(`<text class="mt-tick${minor}" x="${f(x(k))}" y="${CH - CM.bottom + 18}" text-anchor="middle">${k}</text>`);
  }
  out.push(`<text class="mt-axis" x="${CM.left + plotW / 2}" y="${CH - 3}" text-anchor="middle">independent chains</text>`);
  const ym = CM.top + plotH / 2;
  out.push(`<text class="mt-axis" x="14" y="${f(ym)}" text-anchor="middle" transform="rotate(-90 14 ${f(ym)})">ns per access</text>`);
  const cx = f(x(p.chains));
  out.push(`<line class="mt-cursor" x1="${cx}" x2="${cx}" y1="${CM.top}" y2="${CH - CM.bottom}"/>`);
  const floor = p.latency / p.buffers;
  out.push(`<line class="mt-floor" x1="${CM.left}" x2="${CW - CM.right}" y1="${f(y(floor))}" y2="${f(y(floor))}"/>`);
  out.push(`<g class="mt-measured">`);
  for (const m of MEASURED) {
    const xx = f(x(m.chains));
    out.push(`<line x1="${xx}" x2="${xx}" y1="${f(y(m.min))}" y2="${f(y(m.max))}"/>`);
    out.push(`<circle cx="${xx}" cy="${f(y(m.median))}" r="3.2"/>`);
  }
  out.push(`</g>`);
  const pts: string[] = [];
  for (let k = kmin; k <= kmax; k++) pts.push(`${f(x(k))},${f(y(closedForm(k, p.buffers, p.latency)))}`);
  out.push(`<polyline class="mt-model" points="${pts.join(" ")}"/>`);
  out.push(`<circle class="mt-here" cx="${cx}" cy="${f(y(closedForm(p.chains, p.buffers, p.latency)))}" r="4.5"/>`);
  out.push(`</svg>`);
  return out.join("");
}

export function readoutHtml(p: Params, r: Result): string {
  const little = p.latency / r.timePerAccess;
  const wait = r.meanWait;
  return `<span><b>${f(r.timePerAccess)} ns</b> per access</span>` +
    `<span><b>${f(r.inFlight)}</b> misses in flight on average</span>` +
    `<span>Little's law: ${p.latency} ns ÷ ${f(r.timePerAccess)} ns = <b>${f(little)}</b></span>` +
    `<span>${wait > 0.05 ? `<b>${Math.round(wait)} ns</b> waiting for a buffer per load` : "no load waits for a buffer"}</span>`;
}

export function params(props: Props): Params {
  return {
    chains: clamp(Number(props.chains ?? DEFAULTS.chains), LIMITS.chains),
    latency: clamp(Number(props.latency ?? DEFAULTS.latency), LIMITS.latency),
    buffers: clamp(Number(props.buffers ?? DEFAULTS.buffers), LIMITS.buffers),
  };
}

const slider = (name: keyof Params, label: string, value: number, unit = ""): string => {
  const [lo, hi] = LIMITS[name];
  return `<label class="mt-slider"><span>${label} <output name="${name}-out">${value}${unit}</output></span><input type="range" name="${name}" min="${lo}" max="${hi}" step="1" value="${value}" disabled></label>`;
};

export function render(props: Props = {}): string {
  const p = params(props);
  const r = simulate(p.chains, p.buffers, p.latency);
  return `<figure class="mt">
<div class="mt-controls">
${slider("chains", "Chains k", p.chains)}
${slider("latency", "Miss latency L", p.latency, " ns")}
${slider("buffers", "Fill buffers C", p.buffers)}
</div>
<p class="mt-label">Simulated misses over the first ${WINDOW_NS.toLocaleString("en-US")} ns, one row per chain</p>
<div class="mt-plot" data-part="timeline">${timelineSvg(p, r)}</div>
<p class="mt-key"><span><i class="mt-key-miss"></i>miss in flight, holding a fill buffer</span><span><i class="mt-key-wait"></i>load ready, waiting for a free buffer</span></p>
<p class="mt-readout" data-part="readout" aria-live="polite">${readoutHtml(p, r)}</p>
<p class="mt-label">Nanoseconds per access against the number of chains (log scale)</p>
<div class="mt-plot" data-part="chart">${chartSvg(p)}</div>
<p class="mt-key"><span><i class="mt-key-model"></i>model, L / min(k, C)</span><span><i class="mt-key-measured"></i>measured on the VM, median and range</span><span><i class="mt-key-floor"></i>floor L / C</span></p>
<figcaption>Simulation: k pointer chases share C fill buffers; each chain issues its next load when the previous one returns, and every miss takes L ns. Time per access and misses in flight are measured over the second half of 2,400 simulated accesses. The points are the measured times on the cloud VM (2 MB pages, 4 GiB array, 12 runs per point); its single-chain median is ${MEASURED_LATENCY_LABEL} and Intel documents 16 fill buffers for this core.</figcaption>
</figure>`;
}

const MEASURED_LATENCY_LABEL = `${MEASURED.find((m) => m.chains === 1)?.median.toFixed(0) ?? "?"} ns`;
