// Markup for the overload-lab figure. The build runs the simulations for the
// default policy and load and renders the finished charts, so the page shows
// real results before any script loads; the client redraws the same parts
// with the same functions.

import { esc } from "../../shared/format";
import { MEASURED, SPIKE, type MeasuredPoint } from "./measured";
import { DEFAULTS, POLICIES, POLICY_KEYS, simulate, type Params, type PolicyKey, type Result } from "./model";

export const RATES: number[] = MEASURED.rates;
export const CURVE_RATES = [200, 500, 800, 1100, 1400, 1600, 1750, 1900, 2100, 2400, 2700, 3000, 3500, 4000];
export const CAPACITY = DEFAULTS.cores / DEFAULTS.meanService;

export interface State {
  policy: PolicyKey;
  rate: number;
  retries: number;
  spike: boolean;
}

// The measured spike: 3,500 requests/s from 4 s to 6 s on top of the base rate.
export const SPIKE_AT = 4;
export const SPIKE_FOR = 2;
export const SPIKE_RATE = 3500;
export const SPIKE_BASE = 1400;

/** Simulation parameters for a state. The load curve is always steady; the detail run includes the spike if chosen. */
export const params = (s: State, rate = s.rate, duration = 12, spike = false): Params => ({
  ...DEFAULTS,
  policy: s.policy,
  rate,
  retries: s.retries,
  duration,
  ...(spike ? { spikeAt: SPIKE_AT, spikeFor: SPIKE_FOR, spikeRate: SPIKE_RATE } : {}),
});

/** Measured per-second goodput and attempts for the chosen state, if that run was made. */
export function measuredSeries(s: State): { goodput: number[][]; attempts: number[][] } | undefined {
  if (s.spike) return s.rate === SPIKE_BASE ? SPIKE[String(s.retries)]?.[s.policy] : undefined;
  if (s.retries !== 0) return undefined;
  const m = measuredAt(s.policy, s.rate);
  return m ? { goodput: m.series, attempts: [] } : undefined;
}

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

export const measuredAt = (policy: PolicyKey, rate: number): MeasuredPoint | undefined => MEASURED.policies[policy]?.[String(rate)];

const int = (v: number) => Math.round(v).toLocaleString("en-US");

// ---- goodput against offered load -----------------------------------------------

const W = 640;
const H = 270;
const M = { left: 52, right: 14, top: 14, bottom: 40 };
const XMAX = 4200;
const YMAX = 2200;
const pw = W - M.left - M.right;
const ph = H - M.top - M.bottom;
const x = (v: number) => M.left + (Math.min(v, XMAX) / XMAX) * pw;
const y = (v: number) => M.top + (1 - Math.min(v, YMAX) / YMAX) * ph;
const f1 = (v: number) => v.toFixed(1);

export function curveChart(s: State, curve: Result[]): string {
  const parts: string[] = [];
  for (let v = 0; v <= YMAX; v += 500) {
    parts.push(`<line class="ovl-grid" x1="${M.left}" x2="${W - M.right}" y1="${f1(y(v))}" y2="${f1(y(v))}"/>`);
    parts.push(`<text class="ovl-tick" x="${M.left - 6}" y="${f1(y(v) + 4)}" text-anchor="end">${int(v)}</text>`);
  }
  for (let v = 0; v <= 4000; v += 1000) parts.push(`<text class="ovl-tick" x="${f1(x(v))}" y="${H - M.bottom + 15}" text-anchor="middle">${int(v)}</text>`);
  parts.push(
    `<text class="ovl-tick" x="${M.left + pw / 2}" y="${H - 4}" text-anchor="middle">offered load (requests/s)</text>`,
    `<text class="ovl-tick" transform="translate(12 ${M.top + ph / 2}) rotate(-90)" text-anchor="middle">goodput (requests/s)</text>`,
    `<line class="ovl-ideal" x1="${x(0)}" y1="${y(0)}" x2="${f1(x(CAPACITY))}" y2="${f1(y(CAPACITY))}"/>`,
    `<line class="ovl-ideal" x1="${f1(x(CAPACITY))}" y1="${f1(y(CAPACITY))}" x2="${x(XMAX)}" y2="${f1(y(CAPACITY))}"/>`,
    `<text class="ovl-tick ovl-ideal-label" x="${x(XMAX) - 4}" y="${f1(y(CAPACITY) - 6)}" text-anchor="end">capacity ≈ ${int(CAPACITY)}</text>`,
    `<line class="ovl-axis" x1="${M.left}" x2="${M.left}" y1="${M.top}" y2="${H - M.bottom}"/>`,
    `<line class="ovl-axis" x1="${M.left}" x2="${W - M.right}" y1="${H - M.bottom}" y2="${H - M.bottom}"/>`,
  );
  // Other policies' measurements, faint, for comparison.
  if (s.retries === 0) {
    for (const p of POLICY_KEYS) {
      if (p === s.policy) continue;
      const pts = RATES.map((r) => measuredAt(p, r)).map((m, i) => (m ? `${f1(x(RATES[i]))} ${f1(y(median(m.goodput)))}` : "")).filter(Boolean);
      if (pts.length > 1) parts.push(`<path class="ovl-other ovl-p-${p}" d="M${pts.join("L")}"><title>${esc(POLICIES[p].label)}, measured</title></path>`);
    }
  }
  // The chosen policy, simulated.
  if (curve.length > 1) {
    parts.push(`<path class="ovl-sim" d="M${curve.map((c) => `${f1(x(c.params.rate))} ${f1(y(c.goodput))}`).join("L")}"/>`);
  }
  // The chosen policy, measured: median and the range over seeds.
  if (s.retries === 0) {
    for (const r of RATES) {
      const m = measuredAt(s.policy, r);
      if (!m) continue;
      const lo = Math.min(...m.goodput);
      const hi = Math.max(...m.goodput);
      const mid = median(m.goodput);
      if (hi - lo > 1) parts.push(`<line class="ovl-bar" x1="${f1(x(r))}" x2="${f1(x(r))}" y1="${f1(y(lo))}" y2="${f1(y(hi))}"/>`);
      parts.push(`<circle class="ovl-pt${r === s.rate ? " ovl-pt-now" : ""}" cx="${f1(x(r))}" cy="${f1(y(mid))}" r="${r === s.rate ? 5 : 3.5}"><title>${int(r)} offered: ${int(mid)} goodput (seeds ${int(lo)} to ${int(hi)})</title></circle>`);
    }
  }
  parts.push(`<line class="ovl-now" x1="${f1(x(s.rate))}" x2="${f1(x(s.rate))}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  const m = s.retries === 0 ? measuredAt(s.policy, s.rate) : undefined;
  const label = `Goodput against offered load, ${POLICIES[s.policy].short}${m ? `: ${int(median(m.goodput))} requests/s measured at ${int(s.rate)} offered` : ""}.`;
  return `<svg class="ovl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

// ---- goodput over time at the chosen load --------------------------------------------

const TW = 640;
const TH = 190;
const TM = { left: 52, right: 14, top: 12, bottom: 34 };
const tpw = TW - TM.left - TM.right;
const tph = TH - TM.top - TM.bottom;

export function timeChart(s: State, run: Result): string {
  const dur = run.params.duration;
  const tx = (t: number) => TM.left + (t / dur) * tpw;
  const ty = (v: number) => TM.top + (1 - Math.min(v, YMAX) / YMAX) * tph;
  const parts: string[] = [];
  for (let v = 0; v <= 2000; v += 1000) {
    parts.push(`<line class="ovl-grid" x1="${TM.left}" x2="${TW - TM.right}" y1="${f1(ty(v))}" y2="${f1(ty(v))}"/>`);
    parts.push(`<text class="ovl-tick" x="${TM.left - 6}" y="${f1(ty(v) + 4)}" text-anchor="end">${int(v)}</text>`);
  }
  if (s.spike) {
    parts.push(`<rect class="ovl-spike" x="${f1(tx(SPIKE_AT))}" y="${TM.top}" width="${f1(tx(SPIKE_FOR) - tx(0))}" height="${tph}"/>`);
    parts.push(`<text class="ovl-tick" x="${f1(tx(SPIKE_AT + SPIKE_FOR / 2))}" y="${TM.top + 12}" text-anchor="middle">spike</text>`);
  }
  for (let t = 0; t <= dur; t += 2) parts.push(`<text class="ovl-tick" x="${f1(tx(t))}" y="${TH - TM.bottom + 15}" text-anchor="middle">${t}</text>`);
  parts.push(
    `<text class="ovl-tick" x="${TM.left + tpw / 2}" y="${TH - 4}" text-anchor="middle">seconds since load started</text>`,
    `<line class="ovl-ideal" x1="${TM.left}" x2="${TW - TM.right}" y1="${f1(ty(Math.min(s.rate, CAPACITY)))}" y2="${f1(ty(Math.min(s.rate, CAPACITY)))}"><title>min(offered, capacity)</title></line>`,
    `<line class="ovl-axis" x1="${TM.left}" x2="${TM.left}" y1="${TM.top}" y2="${TH - TM.bottom}"/>`,
  );
  // Simulated goodput per bucket, by arrival time; the last deadline's worth
  // of arrivals is cut, since their outcome falls past the end of the run.
  const cut = dur - Math.min(run.params.deadline * (run.params.retries + 1), 1);
  const pts = run.series.filter((b) => b.t + run.params.bucket <= cut).map((b) => `${f1(tx(b.t + run.params.bucket / 2))} ${f1(ty(b.goodput))}`);
  if (pts.length > 1) parts.push(`<path class="ovl-sim" d="M${pts.join("L")}"/>`);
  const ms = measuredSeries(s);
  if (ms) {
    const secs = ms.goodput[0].length;
    for (let i = 0; i < secs - 1; i++) {
      const vals = ms.goodput.map((ser) => ser[i]);
      const mid = median(vals);
      parts.push(`<rect class="ovl-step" x="${f1(tx(i) + 2)}" y="${f1(ty(mid))}" width="${f1(tx(1) - tx(0) - 4)}" height="${f1(ty(0) - ty(mid))}"><title>second ${i}: ${int(mid)} measured (seeds ${int(Math.min(...vals))} to ${int(Math.max(...vals))})</title></rect>`);
    }
  }
  const label = `Goodput over time at ${int(s.rate)} requests/s offered, ${POLICIES[s.policy].short}.`;
  return `<svg class="ovl-time" viewBox="0 0 ${TW} ${TH}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

// ---- readout --------------------------------------------------------------------

const after = (xs: number[], from: number) => {
  const tail = xs.slice(from);
  return tail.reduce((a, b) => a + b, 0) / Math.max(tail.length, 1);
};

export function readout(s: State, run: Result): string {
  const retryText = s.retries ? `, ${s.retries} immediate retries per failed attempt` : "";
  const head = `${int(s.rate)} requests/s offered (${(s.rate / CAPACITY).toFixed(2)}× capacity)${retryText}.`;
  if (s.spike) {
    // Average over seconds 9 to the end of the run: 3 s after the spike ends.
    const from = SPIKE_AT + SPIKE_FOR + 3;
    const bucketsFrom = Math.round(from / run.params.bucket);
    const cut = Math.round((run.params.duration - Math.min(run.params.deadline * (run.params.retries + 1), 1)) / run.params.bucket);
    const tail = run.series.slice(bucketsFrom, cut);
    const simGood = after(tail.map((b) => b.goodput), 0);
    const simAtt = after(tail.map((b) => b.attempts), 0);
    const sim = `In the simulation, from ${from} s on the server receives ${int(simAtt)} attempts/s and delivers ${int(simGood)} requests/s of goodput.`;
    const ms = measuredSeries(s);
    if (!ms) return `${head} The load steps to ${int(SPIKE_RATE)} requests/s from ${SPIKE_AT} s to ${SPIKE_AT + SPIKE_FOR} s. The Go server was measured with this spike only at ${int(SPIKE_BASE)} requests/s, with 2 retries for every policy and with none for the server without admission control. ${sim}`;
    const g = median(ms.goodput.map((ser) => after(ser.slice(0, -1), from)));
    const a = median(ms.attempts.map((ser) => after(ser.slice(0, -1), from)));
    return `${head} The load steps to ${int(SPIKE_RATE)} requests/s from ${SPIKE_AT} s to ${SPIKE_AT + SPIKE_FOR} s and returns to ${int(s.rate)}. From ${from} s on, the Go server received <strong>${int(a)}</strong> attempts/s and delivered <strong>${int(g)}</strong> requests/s of goodput (median of 3 runs). ${sim}`;
  }
  const sim = `The simulation gives ${int(run.goodput)} requests/s of goodput, ${int(run.shed)} shed and ${int(run.timedOut)} timed out${run.wasted > 0.005 ? `; ${Math.round(run.wasted * 100)}% of the requests the server finished were for callers that had already given up` : ""}${s.retries ? `, with ${(run.attempts / Math.max(run.offered, 1)).toFixed(1)} attempts per caller` : ""}.`;
  const m = s.retries === 0 ? measuredAt(s.policy, s.rate) : undefined;
  if (!m) return `${head} The Go server was measured at steady load without retries, so only the simulation is shown. ${sim}`;
  const p99 = m.p99.filter((v) => v >= 0);
  const p99Text = p99.length ? `, p99 latency ${median(p99).toFixed(0)} ms` : "";
  return `${head} The Go server delivered <strong>${int(median(m.goodput))}</strong> requests/s of goodput (median of 3 runs; range ${int(Math.min(...m.goodput))} to ${int(Math.max(...m.goodput))}), shed ${int(median(m.shed))} and let ${int(median(m.timeout))} time out${p99Text}. ${sim}`;
}

// ---- whole figure ------------------------------------------------------------------

export interface Props {
  policy?: string;
  rate?: number;
}

export function stateFrom(props: Props): State {
  const policy = (props.policy && props.policy in POLICIES ? props.policy : "none") as PolicyKey;
  const rate = RATES.includes(Number(props.rate)) ? Number(props.rate) : 2400;
  return { policy, rate, retries: 0, spike: false };
}

export const curve = (s: State, seed = 1): Result[] => CURVE_RATES.map((r) => simulate(params(s, r, 8), seed));
export const detailRun = (s: State, seed = 1): Result => simulate(params(s, s.rate, s.spike ? 16 : 12, s.spike), seed);

export function render(props: Props): string {
  const s = stateFrom(props);
  const run = detailRun(s);
  const idx = RATES.indexOf(s.rate);
  const options = POLICY_KEYS.map((k) => `<option value="${k}"${k === s.policy ? " selected" : ""}>${esc(POLICIES[k].label)}</option>`).join("");
  return [
    `<figure class="ovl" data-state="${esc(JSON.stringify(s))}">`,
    `<form class="ovl-controls">`,
    `<label class="ovl-select ovl-policy"><span>Policy</span><select name="policy" disabled>${options}</select></label>`,
    `<label class="ovl-select"><span>Client retries</span><select name="retries" disabled><option value="0" selected>none</option><option value="2">2, immediate</option></select></label>`,
    `<label class="ovl-select"><span>Load</span><select name="spike" disabled><option value="0" selected>steady</option><option value="1">spike to ${int(SPIKE_RATE)}/s at ${SPIKE_AT} s to ${SPIKE_AT + SPIKE_FOR} s</option></select></label>`,
    `<label class="ovl-slider"><span>Offered load <output name="rate-out">${int(s.rate)} req/s</output></span><input type="range" name="rate" min="0" max="${RATES.length - 1}" step="1" value="${idx}" disabled></label>`,
    `</form>`,
    `<div class="ovl-legend" aria-hidden="true"><span class="ovl-key ovl-key-pt">● measured (Go server, 3 runs)</span><span class="ovl-key ovl-key-sim">— simulated</span><span class="ovl-key ovl-key-other">— other policies, measured</span></div>`,
    `<div class="ovl-plot" data-part="curve">${curveChart(s, curve(s))}</div>`,
    `<div class="ovl-subhead">Goodput over time at the chosen load: bars are measured seconds, the line is the simulation in 250 ms steps</div>`,
    `<div class="ovl-plot" data-part="time">${timeChart(s, run)}</div>`,
    `<p class="ovl-readout" data-part="readout" aria-live="polite">${readout(s, run)}</p>`,
    `<figcaption>Goodput is the rate of requests answered within the client's 100 ms deadline. Points and bars are measurements of a Go HTTP/2 server on 2 pinned cores, each request burning an exponentially distributed ~1 ms of CPU, under open-loop Poisson load from a separate process. Lines come from a discrete-event simulation of the same policies on a 2-core processor-sharing server, run in the page.</figcaption>`,
    `</figure>`,
  ].join("");
}
