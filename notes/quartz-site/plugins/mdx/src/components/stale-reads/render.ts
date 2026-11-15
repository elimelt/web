// Markup for the stale-read figure. The build runs the same Monte Carlo the
// browser runs, with the same seed, so the page shows the finished chart for
// its preset before any script arrives.

import { esc } from "../../shared/format";
import {
  FAILURE_FRACTIONS,
  HINT_MS,
  OUTAGE_MS,
  PRESETS,
  PROFILE_KEYS,
  PROFILES,
  presetKey,
  run,
  TIMES,
  timeBelow,
  TRIALS,
  wilson,
  type Result,
  type Setting,
} from "./model";

export interface Props {
  preset?: unknown;
}

export const W = 640;
export const H = 250;
export const M = { left: 62, right: 14, top: 12, bottom: 42 };
/** The t = 0 column sits left of the log axis, which starts at the second time. */
const ZERO_GAP = 52;
export const Y_FLOOR = 1e-4;

const X0 = M.left + ZERO_GAP;
const lmin = Math.log10(TIMES[1]);
const lmax = Math.log10(TIMES[TIMES.length - 1]);
export const x = (t: number): number => (t <= 0 ? M.left + 8 : X0 + ((Math.log10(t) - lmin) / (lmax - lmin)) * (W - M.right - X0));
export const y = (p: number): number => {
  const v = Math.log10(Math.max(p, Y_FLOOR));
  return M.top + (-v / -Math.log10(Y_FLOOR)) * (H - M.top - M.bottom);
};

/** Tick labels; the minor ones are hidden at phone width, where the text is larger. */
const X_TICKS: [number, string, boolean][] = [
  [0, "0", false],
  [0.1, "0.1 ms", true],
  [1, "1 ms", false],
  [10, "10 ms", true],
  [100, "0.1 s", false],
  [1000, "1 s", true],
  [10000, "10 s", false],
  [100000, "100 s", true],
];

export const fmtTime = (t: number): string => (t === 0 ? "0" : t < 1 ? `${t} ms` : t < 1000 ? `${t} ms` : `${t / 1000} s`);

export function fmtP(p: number): string {
  if (p === 0) return "0";
  if (p >= 0.1) return `${(p * 100).toFixed(0)}%`;
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`;
  if (p >= 0.001) return `${(p * 100).toFixed(2)}%`;
  return `${(p * 100).toFixed(3)}%`;
}

const fmtMs = (v: number): string => (v >= 100 ? `${v.toFixed(0)} ms` : v >= 10 ? `${v.toFixed(1)} ms` : `${v.toFixed(2)} ms`);

export const label = (st: Setting): string =>
  `N=${st.N} R=${st.R} W=${st.W}, ${PROFILES[st.profile].label}${st.f ? `, nodes down ${st.f * 100}% of the time` : ""}`;

const prob = (res: Result, k: number): number => (res.ok[k] ? res.stale[k] / res.ok[k] : NaN);

function path(res: Result): string {
  const pts = res.times.map((t, k) => `${x(t).toFixed(1)},${y(prob(res, k)).toFixed(1)}`);
  // A break between the t = 0 point and the log axis.
  return `<path class="sr-zero" d="M${pts[0]}L${pts[1]}"/><polyline points="${pts.slice(1).join(" ")}"/>`;
}

export function chart(main: Result, compare: Result | null, tIndex: number): string {
  const out: string[] = [
    `<svg viewBox="0 0 ${W} ${H}" class="sr-chart" role="img" aria-label="Probability that a read is stale against time since the write committed, log scales">`,
  ];
  for (let e = 0; e >= Math.log10(Y_FLOOR); e--) {
    const yy = y(10 ** e).toFixed(1);
    out.push(`<line class="sr-grid" x1="${M.left}" x2="${W - M.right}" y1="${yy}" y2="${yy}"/>`);
    const lab = e === 0 ? "100%" : e === -1 ? "10%" : e === -2 ? "1%" : e === -3 ? "0.1%" : "0.01%";
    out.push(`<text class="sr-tick" x="${M.left - 6}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${lab}</text>`);
  }
  for (const t of [0, 0.1, 1, 10, 100, 1000, 10000, 100000]) {
    const xx = x(t).toFixed(1);
    out.push(`<line class="sr-grid sr-vgrid" x1="${xx}" x2="${xx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    out.push(`<text class="sr-tick" x="${xx}" y="${H - M.bottom + 16}" text-anchor="middle">${esc(fmtTime(t).replace(" ", " "))}</text>`);
  }
  const ym = (M.top + H - M.bottom) / 2;
  out.push(`<text class="sr-axis sr-ylab" x="13" y="${ym}" text-anchor="middle" transform="rotate(-90 13 ${ym})">P(read is stale)</text>`);
  out.push(`<text class="sr-axis" x="${(X0 + W - M.right) / 2}" y="${H - 6}" text-anchor="middle">time from commit to read</text>`);
  const sx = x(TIMES[tIndex]).toFixed(1);
  out.push(`<line class="sr-cursor" x1="${sx}" x2="${sx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  if (compare) out.push(`<g class="sr-series sr-compare">${path(compare)}</g>`);
  out.push(`<g class="sr-series sr-main">${path(main)}`);
  const pm = prob(main, tIndex);
  out.push(`<circle cx="${sx}" cy="${y(pm).toFixed(1)}" r="4"/></g>`);
  out.push(`</svg>`);
  return out.join("");
}

export function legend(main: Setting, compare: Setting | undefined): string {
  return (
    `<li><span class="sr-swatch sr-main"></span>${esc(label(main))}</li>` +
    (compare ? `<li><span class="sr-swatch sr-compare"></span>${esc(label(compare))}</li>` : "")
  );
}

export function readout(st: Setting, res: Result, tIndex: number): string {
  const n = res.ok[tIndex];
  const k = res.stale[tIndex];
  const [lo, hi] = wilson(k, n);
  const t = TIMES[tIndex];
  const below = timeBelow(res);
  const overlap = st.R + st.W > st.N;
  const lines = [
    `<p class="sr-big">${t === 0 ? "Read issued at commit" : `Read ${esc(fmtTime(t))} after commit`}: <b>${fmtP(n ? k / n : NaN)}</b> stale <span class="sr-ci">(${k.toLocaleString("en-US")} of ${n.toLocaleString("en-US")} simulated reads; 95% interval ${fmtP(lo)} to ${fmtP(hi)})</span></p>`,
    `<p>R + W = ${st.R + st.W} ${overlap ? "&gt;" : "≤"} N = ${st.N}: ${overlap ? (st.f ? "strict quorums would intersect, but sloppy ones need not." : "every read quorum shares a replica with every write quorum.") : "a read quorum can miss every replica that has acknowledged."}</p>`,
    `<p>${below < 0 ? "P(stale) does not stay below 0.1% within 100 s" : `P(stale) stays below 0.1% from <b>${below === 0 ? "commit" : esc(fmtTime(below))}</b> on`}. 99.9th percentile latency: write <b>${fmtMs(res.writeP999)}</b>, read <b>${fmtMs(res.readP999)}</b>.${res.writeFailed ? ` ${fmtP(res.writeFailed / res.trials)} of writes found fewer than W nodes up.` : ""}</p>`,
  ];
  return lines.join("");
}

function slider(name: string, text: string, min: number, max: number, value: number, shown: string): string {
  return `<label class="sr-slider"><span>${text} <output name="${name}-out">${esc(shown)}</output></span><input type="range" name="${name}" min="${min}" max="${max}" step="1" value="${value}" disabled></label>`;
}

export function controls(st: Setting, tIndex: number): string {
  const prof = PROFILE_KEYS.map((k) => `<option value="${k}"${k === st.profile ? " selected" : ""}>${esc(PROFILES[k].label)}</option>`).join("");
  const fail = FAILURE_FRACTIONS.map((f) => `<option value="${f}"${f === st.f ? " selected" : ""}>${f ? `${f * 100}% of the time` : "never"}</option>`).join("");
  return [
    slider("N", "Replicas N", 1, 7, st.N, String(st.N)),
    slider("R", "Read quorum R", 1, 7, st.R, String(st.R)),
    slider("W", "Write quorum W", 1, 7, st.W, String(st.W)),
    slider("t", "Read after", 0, TIMES.length - 1, tIndex, fmtTime(TIMES[tIndex])),
    `<label class="sr-select"><span>Latencies</span><select name="profile" disabled>${prof}</select></label>`,
    `<label class="sr-select"><span>Each node down</span><select name="f" disabled>${fail}</select></label>`,
  ].join("");
}

export const caption = `Simulation, not measurement: ${TRIALS.toLocaleString("en-US")} trials per curve, each a write and then a read, with message delays drawn from distributions Bailis et al. (2012) fitted to production latencies at LinkedIn and Yammer. Reads and writes go to the first N reachable nodes of the key's preference list. Values at or below 0.01% are drawn on the bottom line. A failed node stays down ${OUTAGE_MS / 1000} s on average, and its substitute hands the version back about ${HINT_MS / 1000} s after it recovers (assumed values). The model is checked against the Python simulator beside the note and against closed forms.`;

export function render(props: Props = {}): string {
  const key = presetKey(props.preset);
  const p = PRESETS[key];
  const tIndex = TIMES.indexOf(p.t);
  const main = run(p.main);
  const cmp = p.compare ? run(p.compare) : null;
  return `<figure class="sr" data-preset="${key}">
<form class="sr-controls">${controls(p.main, tIndex)}</form>
<div class="sr-plot" data-part="plot">${chart(main, cmp, tIndex)}</div>
<ul class="sr-legend" data-part="legend">${legend(p.main, p.compare)}</ul>
<div class="sr-readout" data-part="readout" aria-live="polite">${readout(p.main, main, tIndex)}</div>
<figcaption>${esc(caption)}</figcaption>
</figure>`;
}
