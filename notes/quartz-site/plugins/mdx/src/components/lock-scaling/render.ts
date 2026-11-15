// Markup for the lock throughput charts. Every point comes from the recorded
// benchmark summary; the build draws the whole chart, and the client only
// moves the highlighted thread count and rewrites the readout.

import { esc } from "../../shared/format";
import { CORES, LABELS, PRESETS, presetKey, point, value, type Lock, type Preset } from "./model";

export interface Props {
  preset?: unknown;
}

export const W = 640;
export const H = 260;
export const M = { left: 58, right: 16, top: 12, bottom: 40 };

const log = Math.log10;

/** Compact count: 1.2M, 340k, 18M. */
export function short(v: number): string {
  const fmt = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ""));
  if (v >= 1e9) return `${fmt(v / 1e9)}G`;
  if (v >= 1e6) return `${fmt(v / 1e6)}M`;
  if (v >= 1e3) return `${fmt(v / 1e3)}k`;
  return v.toFixed(0);
}

export interface Scales {
  x: (t: number) => number;
  y: (v: number) => number;
  yTicks: number[];
}

export function scales(p: Preset): Scales {
  const tmin = p.threads[0];
  const tmax = p.threads[p.threads.length - 1];
  const span = Math.max(1, tmax - tmin);
  const x = (t: number) => M.left + 10 + ((t - tmin) / span) * (W - M.left - M.right - 20);
  const plotH = H - M.top - M.bottom;
  if (p.metric === "share") {
    // From a tenth or more below the lowest share up to 1 (perfectly fair).
    const lowest = Math.min(...p.locks.flatMap((l) => p.threads.map((t) => point(l, t).share)));
    const lo = Math.max(0, Math.floor((lowest - 0.05) * 10) / 10);
    const yTicks: number[] = [];
    for (let i = Math.round(lo * 10); i <= 10; i++) yTicks.push(i / 10);
    return { x, y: (v) => M.top + ((1 - v) / (1 - lo)) * plotH, yTicks };
  }
  const vals = p.locks.flatMap((l) => p.threads.flatMap((t) => [point(l, t).min, point(l, t).max]));
  const lo = Math.floor(log(Math.max(1, Math.min(...vals))));
  const hi = Math.ceil(log(Math.max(...vals)));
  const y = (v: number) => M.top + (1 - (log(Math.max(v, 1)) - lo) / Math.max(1, hi - lo)) * plotH;
  const yTicks: number[] = [];
  for (let e = lo; e <= hi; e++) yTicks.push(10 ** e);
  return { x, y, yTicks };
}

export function chart(key: string, selected: number): string {
  const p = PRESETS[key];
  const { x, y, yTicks } = scales(p);
  const out: string[] = [
    `<svg viewBox="0 0 ${W} ${H}" class="ls-chart" role="img" aria-label="${esc(p.metric === "share" ? "Slowest thread's share against thread count" : "Lock acquisitions per second against thread count")}">`,
  ];
  const tmax = p.threads[p.threads.length - 1];
  if (tmax > CORES) {
    const x0 = (x(CORES) + x(p.threads[p.threads.indexOf(CORES) + 1])) / 2;
    out.push(`<rect class="ls-over" x="${x0.toFixed(1)}" y="${M.top}" width="${(W - M.right - x0).toFixed(1)}" height="${H - M.top - M.bottom}"/>`);
    out.push(`<text class="ls-note" x="${(x0 + 6).toFixed(1)}" y="${M.top + 14}">more threads than cores</text>`);
  }
  for (const v of yTicks) {
    const yy = y(v).toFixed(1);
    out.push(`<line class="ls-grid" x1="${M.left}" x2="${W - M.right}" y1="${yy}" y2="${yy}"/>`);
    const label = p.metric === "share" ? v.toFixed(1) : short(v);
    out.push(`<text class="ls-tick" x="${M.left - 6}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${label}</text>`);
  }
  for (const t of p.threads) {
    out.push(`<text class="ls-tick" x="${x(t).toFixed(1)}" y="${H - M.bottom + 17}" text-anchor="middle">${t}</text>`);
  }
  out.push(`<text class="ls-axis" x="${(M.left + W - M.right) / 2}" y="${H - 5}" text-anchor="middle">threads</text>`);
  const yLabel = p.metric === "share" ? "slowest thread's share" : "acquisitions per second";
  const ym = (M.top + H - M.bottom) / 2;
  out.push(`<text class="ls-axis" x="13" y="${ym}" text-anchor="middle" transform="rotate(-90 13 ${ym})">${yLabel}</text>`);
  const sx = x(selected).toFixed(1);
  out.push(`<line class="ls-cursor" data-part="cursor" x1="${sx}" x2="${sx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  for (const lock of p.locks) {
    const pts = p.threads.map((t) => `${x(t).toFixed(1)},${y(value(point(lock, t), p.metric)).toFixed(1)}`).join(" ");
    out.push(`<g class="ls-series ls-${lock}">`);
    if (p.metric === "throughput") {
      for (const t of p.threads) {
        const q = point(lock, t);
        out.push(`<line class="ls-whisker" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${y(q.min).toFixed(1)}" y2="${y(q.max).toFixed(1)}"/>`);
      }
    }
    out.push(`<polyline points="${pts}"/>`);
    for (const t of p.threads) {
      out.push(`<circle cx="${x(t).toFixed(1)}" cy="${y(value(point(lock, t), p.metric)).toFixed(1)}" r="3"/>`);
    }
    out.push(`</g>`);
  }
  out.push(`</svg>`);
  return out.join("");
}

/** The values at one thread count, one row per lock, best first. */
export function readout(key: string, threads: number): string {
  const p = PRESETS[key];
  const rows = [...p.locks]
    .sort((a, b) => value(point(b, threads), p.metric) - value(point(a, threads), p.metric))
    .map((lock) => {
      const q = point(lock, threads);
      const v = p.metric === "share" ? q.share.toFixed(2) : `${short(q.median)}/s`;
      return `<li><span class="ls-swatch ls-${lock}"></span><span class="ls-name">${esc(LABELS[lock])}</span><b>${v}</b></li>`;
    })
    .join("");
  return `<div class="ls-at">At <b>${threads}</b> thread${threads === 1 ? "" : "s"}</div><ul class="ls-rows">${rows}</ul>`;
}

export const startThreads = (key: string): number => {
  const t = PRESETS[key].threads;
  return t[t.length - 1];
};

export function render(props: Props = {}): string {
  const key = presetKey(props.preset);
  const p = PRESETS[key];
  const t = startThreads(key);
  return `<figure class="ls" data-preset="${key}">
<div class="ls-plot" data-part="plot" tabindex="0" aria-label="Chart. Use the left and right arrow keys, or point at the chart, to read a thread count.">${chart(key, t)}</div>
<div class="ls-readout" data-part="readout" aria-live="polite">${readout(key, t)}</div>
<figcaption>${esc(p.caption)}</figcaption>
</figure>`;
}
