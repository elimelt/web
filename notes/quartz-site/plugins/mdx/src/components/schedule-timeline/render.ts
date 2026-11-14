// Markup for the schedule timeline. Each copy of the figure shows one small
// scenario (the jobs, the policies to compare, and at most one control), so a
// note can place several copies next to the paragraphs they illustrate. The
// build renders the finished figure; client.ts only redraws the chart when the
// control moves.

import { esc, num } from "../../shared/format";
import { LETTERS, meanResponse, parseJobs, POLICIES, simulate, type Job, type Params, type Policy } from "./model";

export const CONTROLS = ["none", "swap", "arrival", "quantum", "boost"] as const;
export type Control = (typeof CONTROLS)[number];

export interface Props {
  jobs?: string;
  policies?: string;
  control?: string;
  quantum?: number;
  q0?: number;
  levels?: number;
  boost?: number;
  /** For control="arrival": the index of the job whose arrival the slider moves. */
  job?: number;
  min?: number;
  max?: number;
  step?: number;
  caption?: string;
}

/** Everything a copy of the figure needs; it rides on the figure as JSON. */
export interface State {
  jobs: Job[];
  policies: Policy[];
  control: Control;
  params: Params;
  /** The back-to-back order for control="swap". */
  order: number[];
  job: number;
  min: number;
  max: number;
  step: number;
  /** The time axis is fixed for the figure so it doesn't jump as a control moves. */
  horizon: number;
  /** The last swap, for the readout. */
  swapped?: { first: number; second: number; before: number; after: number };
}

const NAMES: Record<Policy, string> = {
  order: "Order",
  fifo: "FIFO",
  sjf: "SJF",
  srpt: "SRPT",
  rr: "RR",
  ps: "PS",
  mlfq: "MLFQ",
};

const fmt = (v: number): string => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)).replace("-", "−") : num(v, 2).replace(/0$/, ""));

export function stateFrom(props: Props): State {
  const jobs = parseJobs(props.jobs ?? "0:8, 0:4, 0:1").slice(0, LETTERS.length);
  const policies = (props.policies ?? "fifo,sjf")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Policy => (POLICIES as readonly string[]).includes(s));
  const control = (CONTROLS as readonly string[]).includes(props.control ?? "") ? (props.control as Control) : "none";
  const params: Params = {
    quantum: typeof props.quantum === "number" && props.quantum > 0 ? props.quantum : 1,
    q0: typeof props.q0 === "number" && props.q0 > 0 ? props.q0 : 1,
    levels: typeof props.levels === "number" && props.levels >= 1 ? Math.min(Math.floor(props.levels), 8) : 3,
    boost: typeof props.boost === "number" && props.boost >= 0 ? props.boost : 0,
  };
  const job = typeof props.job === "number" && props.job >= 0 && props.job < jobs.length ? props.job : jobs.length - 1;
  const max = typeof props.max === "number" ? props.max : control === "quantum" ? 8 : control === "boost" ? 10 : 8;
  const min = typeof props.min === "number" ? props.min : control === "quantum" ? 0.5 : 0;
  const step = typeof props.step === "number" && props.step > 0 ? props.step : control === "quantum" ? 0.5 : 1;
  const total = jobs.reduce((t, j) => t + j.size, 0);
  const latest = Math.max(0, ...jobs.map((j) => j.arrival), control === "arrival" ? max : 0);
  return {
    jobs,
    policies: policies.length ? policies : ["fifo"],
    control,
    params,
    order: jobs.map((_, i) => i),
    job,
    min,
    max,
    step,
    horizon: Math.ceil(latest + total),
  };
}

function niceStep(span: number): number {
  for (const s of [1, 2, 5, 10, 20, 50]) if (span / s <= 10) return s;
  return 100;
}

function rowName(policy: Policy, s: State): string {
  if (policy === "rr") return `RR, q = ${fmt(s.params.quantum)}`;
  return NAMES[policy];
}

/** The rows, the arrival marks and the axis. */
export function chartHtml(s: State, interactive: boolean): string {
  const pct = (t: number) => `${((t / s.horizon) * 100).toFixed(3)}%`;
  const rows: string[] = [];
  const late = s.jobs.some((j) => j.arrival > 0);
  if (late) {
    const marks = s.jobs
      .map((j, i) => `<span class="st-arrive st-c${i % 5}" style="left:${pct(j.arrival)}" title="${LETTERS[i]} arrives at ${fmt(j.arrival)}">${LETTERS[i]}</span>`)
      .join("");
    rows.push(`<div class="st-row st-arrivals"><span class="st-name">Arrive</span><div class="st-track">${marks}</div><span class="st-stat"></span></div>`);
  }
  for (const policy of s.policies) {
    const sched = simulate(policy, s.jobs, s.params, s.order);
    const pieces = sched.pieces
      .map((p) => {
        const w = p.end - p.start;
        const label = w / s.horizon >= 0.035 ? LETTERS[p.job] + (p.level !== undefined && w / s.horizon >= 0.07 ? `<sub>Q${p.level}</sub>` : "") : "";
        const style = `left:${pct(p.start)};width:${pct(w)};top:${((p.lane / p.lanes) * 100).toFixed(2)}%;height:${(100 / p.lanes).toFixed(2)}%`;
        const title = `${LETTERS[p.job]} runs ${fmt(p.start)} to ${fmt(p.end)}${p.lanes > 1 ? ` at 1/${p.lanes} speed` : ""}${p.level !== undefined ? ` in queue ${p.level}` : ""}`;
        if (s.control === "swap" && policy === "order") {
          const pos = s.order.indexOf(p.job);
          const last = pos === s.order.length - 1;
          const aria = last ? `${LETTERS[p.job]}, size ${fmt(s.jobs[p.job].size)}` : `Swap ${LETTERS[p.job]} with ${LETTERS[s.order[pos + 1]]}`;
          return `<button type="button" class="st-seg st-c${p.job % 5}" style="${style}" data-pos="${pos}" aria-label="${esc(aria)}" title="${esc(title)}"${interactive && !last ? "" : " disabled"}>${label}</button>`;
        }
        return `<span class="st-seg st-c${p.job % 5}${p.lanes > 1 ? " st-shared" : ""}" style="${style}" title="${esc(title)}">${label}</span>`;
      })
      .join("");
    const ends = sched.done.map((d, i) => `<span class="st-done" style="left:${pct(d)}" title="${LETTERS[i]} done at ${fmt(d)}"></span>`).join("");
    const stat =
      s.control === "swap" && policy === "order"
        ? `ΣC = ${fmt(sched.done.reduce((a, b) => a + b, 0))}`
        : `mean ${fmt(Math.round(meanResponse(s.jobs, sched) * 100) / 100)}`;
    rows.push(`<div class="st-row"><span class="st-name">${esc(rowName(policy, s))}</span><div class="st-track">${pieces}${ends}</div><span class="st-stat">${stat}</span></div>`);
  }
  const step = niceStep(s.horizon);
  const ticks: string[] = [];
  for (let t = 0; t <= s.horizon + 1e-9; t += step) ticks.push(`<span style="left:${pct(t)}">${t}</span>`);
  rows.push(`<div class="st-row st-axis"><span class="st-name"></span><div class="st-track">${ticks.join("")}</div><span class="st-stat"></span></div>`);
  return rows.join("");
}

export function readoutText(s: State): string {
  if (s.control === "swap") {
    if (!s.swapped) return "Click a job to swap it with the job after it.";
    const { first, second, before, after } = s.swapped;
    const p1 = s.jobs[first].size;
    const p2 = s.jobs[second].size;
    const d = after - before;
    return `Moving ${LETTERS[second]} (size ${fmt(p2)}) ahead of ${LETTERS[first]} (size ${fmt(p1)}) changed ΣC from ${fmt(before)} to ${fmt(after)}: ${fmt(p2)} − ${fmt(p1)} = ${fmt(d)}.`;
  }
  return "";
}

function controlHtml(s: State, interactive: boolean): string {
  const dis = interactive ? "" : " disabled";
  if (s.control === "swap") return `<button type="button" name="reset"${dis}>Reset order</button>`;
  if (s.control === "none") return "";
  const value = s.control === "arrival" ? s.jobs[s.job].arrival : s.control === "quantum" ? s.params.quantum : s.params.boost;
  const label = s.control === "arrival" ? `${LETTERS[s.job]} arrives at` : s.control === "quantum" ? "Quantum" : "Boost every";
  const shown = s.control === "boost" && value === 0 ? "never" : fmt(value);
  return `<label class="st-slider"><span>${label} <output name="value">${shown}</output></span><input type="range" name="value" min="${s.min}" max="${s.max}" step="${s.step}" value="${value}"${dis}></label>`;
}

export function render(props: Props): string {
  const s = stateFrom(props);
  const controls = controlHtml(s, false);
  const readout = readoutText(s);
  return `<figure class="st" data-state="${esc(JSON.stringify(s))}">
<div class="st-controls"${controls ? "" : " hidden"}>${controls}</div>
<div class="st-chart" data-part="chart">${chartHtml(s, false)}</div>
<p class="st-readout" data-part="readout" aria-live="polite"${readout ? "" : " hidden"}>${esc(readout)}</p>
${props.caption ? `<figcaption>${esc(props.caption)}</figcaption>` : ""}
</figure>`;
}
