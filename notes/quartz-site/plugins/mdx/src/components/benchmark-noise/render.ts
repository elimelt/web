// Markup for the benchmark-noise figure. The build renders the whole figure
// from the default state, so the page shows a finished chart before any
// script runs; the client module then redraws the output parts from the same
// functions as the reader changes the controls.

import { analyze, BASE_NS, defaultState, repeat, verdict, type Analysis, type State } from "./model";

const fmt = (value: number, digits = 1): string => value.toFixed(digits).replace("-", "−");
const pct = (fraction: number, digits = 1): string => `${fmt(fraction * 100, digits)}%`;
const ns = (value: number): string => fmt(value, 1);
export const speedupLabel = (fraction: number): string => `${+(fraction * 100).toFixed(1)}%`;

const W = 640;
const H = 236;
const M = { left: 48, right: 12, top: 36, bottom: 36 };

export function chart(state: State, analysis: Analysis): string {
  const n = state.runs;
  const trueB = BASE_NS * (1 - state.speedup);
  const lo = Math.min(90, Math.floor((trueB * 0.97) / 5) * 5);
  const hi = 130;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (order: number) => M.left + ((order + 0.5) / (2 * n)) * plotW;
  const y = (value: number) => M.top + (1 - (value - lo) / (hi - lo)) * plotH;
  const mid = M.left + plotW / 2;
  const r = n > 25 ? 3 : n > 10 ? 4 : 5;
  const parts: string[] = [];

  for (let tick = Math.ceil(lo / 10) * 10; tick <= hi; tick += 10) {
    parts.push(
      `<line class="bn-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(tick)}" y2="${y(tick)}"/>`,
      `<text class="bn-tick" x="${M.left - 6}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`,
    );
  }
  parts.push(
    `<text class="bn-tick" x="${M.left - 6}" y="${M.top - 18}" text-anchor="end">ns/op</text>`,
    `<line class="bn-divider" x1="${mid}" x2="${mid}" y1="${M.top - 4}" y2="${H - M.bottom}"/>`,
    `<text class="bn-label" x="${M.left + plotW / 4}" y="${M.top - 10}" text-anchor="middle">A runs</text>`,
    `<text class="bn-label" x="${M.left + (3 * plotW) / 4}" y="${M.top - 10}" text-anchor="middle">B runs</text>`,
    `<text class="bn-tick" x="${mid}" y="${H - 8}" text-anchor="middle">runs in the order they were timed</text>`,
  );

  const level = (cls: string, x1: number, x2: number, value: number) =>
    `<line class="${cls}" x1="${x1 + 4}" x2="${x2 - 4}" y1="${y(value)}" y2="${y(value)}"/>`;
  parts.push(
    level("bn-true", M.left, mid, BASE_NS),
    level("bn-true", mid, W - M.right, trueB),
    level("bn-median bn-a", M.left, mid, Math.min(analysis.medianA, hi)),
    level("bn-median bn-b", mid, W - M.right, Math.min(analysis.medianB, hi)),
  );

  for (const sample of analysis.samples) {
    const cx = x(sample.order);
    const cls = sample.version === "A" ? "bn-a" : "bn-b";
    if (sample.ns > hi) {
      const top = M.top + 1;
      parts.push(
        `<path class="bn-point ${cls}" d="M${cx - r} ${top + 2 * r}L${cx} ${top}L${cx + r} ${top + 2 * r}Z"><title>${sample.version}: ${ns(sample.ns)} ns/op, off the chart</title></path>`,
      );
    } else if (sample.version === "A") {
      parts.push(`<circle class="bn-point ${cls}" cx="${cx}" cy="${y(sample.ns)}" r="${r}"/>`);
    } else {
      const cy = y(sample.ns);
      parts.push(`<rect class="bn-point ${cls}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}"/>`);
    }
  }

  const label = `${n} timed runs of A, then ${n} of B. Median A ${ns(analysis.medianA)} ns/op, median B ${ns(analysis.medianB)} ns/op; the true values are ${ns(BASE_NS)} and ${ns(trueB)}.`;
  return `<svg class="bn-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${parts.join("")}</svg>`;
}

export function verdictText(state: State, analysis: Analysis): { text: string; tone: string } {
  const truth = state.speedup;
  const real = truth > 0 ? `B is really ${pct(truth)} faster.` : "The two versions are identical.";
  const interval = analysis.interval;
  switch (verdict(analysis)) {
    case "single":
      return {
        text: `<strong>Can't tell.</strong> One run of each can't separate a real difference from noise. ${real}`,
        tone: "unclear",
      };
    case "faster":
      return {
        text: `<strong>B is faster</strong> by ${pct(analysis.measured)} (95% interval ${pct(interval![0])} to ${pct(interval![1])}). ${truth > 0 ? "That's right." : "False alarm: the two versions are identical."}`,
        tone: truth > 0 ? "right" : "wrong",
      };
    case "slower":
      return {
        text: `<strong>B looks slower</strong> by ${pct(-analysis.measured)} (95% interval ${pct(-interval![1])} to ${pct(-interval![0])}). ${truth > 0 ? `Wrong: B is really ${pct(truth)} faster.` : "False alarm: the two versions are identical."}`,
        tone: "wrong",
      };
    default:
      return {
        text: `<strong>Can't tell.</strong> The 95% interval for the speedup, ${pct(interval![0])} to ${pct(interval![1])}, includes zero. ${real}`,
        tone: truth > 0 ? "unclear" : "right",
      };
  }
}

export function repeatsText(state: State): string {
  const r = repeat(state);
  const range = `between ${pct(r.p5)} and ${pct(r.p95)}`;
  if (state.speedup > 0) {
    return `Run this exact experiment ${r.experiments.toLocaleString("en-US")} times and its medians pick B as faster in <strong>${pct(r.rightWinner, 0)}</strong> of them. Nine in ten measured speedups fall ${range}; the true speedup is ${pct(state.speedup)}.`;
  }
  return `Run this exact experiment ${r.experiments.toLocaleString("en-US")} times and <strong>${pct(r.falseAlarm, 0)}</strong> of them measure a gap over 1% between two identical versions. Nine in ten fall ${range}.`;
}

export function record(state: State, analysis: Analysis): string {
  const interval = analysis.interval
    ? `${pct(analysis.interval[0])} to ${pct(analysis.interval[1])}`
    : "none, one run each";
  const lines = [
    "evidence_class: wall-clock  # simulated",
    "method:",
    `  repetitions: ${state.runs}  # per version, all A runs then all B runs`,
    `  warmup: ${state.warmup}`,
    `  affinity: ${state.pin ? '"pinned to one core"' : '"unpinned"'}`,
    "  variance_reported: true  # bootstrap 95% interval",
    `os: ${state.freq ? '"frequency fixed, turbo off"' : '"governor and turbo unrecorded"'}`,
    `background_load: ${state.quiet ? '"idle machine"' : '"uncontrolled"'}`,
    "results:",
    `  median_ns_per_op: {A: ${ns(analysis.medianA)}, B: ${ns(analysis.medianB)}}`,
    `  speedup_of_B: "${pct(analysis.measured)} (95% interval ${interval})"`,
  ];
  return lines.join("\n").replace(/−/g, "-");
}

export interface Parts {
  chart: string;
  verdict: string;
  tone: string;
  repeats: string;
  record: string;
}

export function parts(state: State): Parts {
  const analysis = analyze(state);
  const v = verdictText(state, analysis);
  return {
    chart: chart(state, analysis),
    verdict: v.text,
    tone: v.tone,
    repeats: repeatsText(state),
    record: escapeHtml(record(state, analysis)),
  };
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const toggle = (name: string, label: string, hint: string, checked: boolean) =>
  `<label class="bn-toggle"><input type="checkbox" name="${name}"${checked ? " checked" : ""} disabled> <span>${label}<small>${hint}</small></span></label>`;

export interface Props {
  seed?: number;
}

/** The whole figure, rendered at build time from the default state. */
export function render(props: Props): string {
  const state = defaultState(typeof props.seed === "number" ? props.seed : undefined);
  const p = parts(state);
  return [
    `<figure class="bn" data-seed="${state.seed}">`,
    `<div class="bn-controls">`,
    `<label class="bn-slider"><span>True speedup of B <output name="speedup-out">${speedupLabel(state.speedup)}</output></span><input type="range" name="speedup" min="0" max="15" step="0.5" value="${state.speedup * 100}" disabled></label>`,
    `<label class="bn-slider"><span>Runs per version <output name="runs-out">${state.runs}</output></span><input type="range" name="runs" min="1" max="50" step="1" value="${state.runs}" disabled></label>`,
    `<fieldset class="bn-toggles"><legend>Controls in place</legend>`,
    toggle("warmup", "Warm up before timing", "drops cold first runs", state.warmup),
    toggle("pin", "Pin to one core", "no scheduler migrations", state.pin),
    toggle("freq", "Fix the CPU frequency", "no turbo fading as the chip heats", state.freq),
    toggle("quiet", "Quiet machine", "no other processes", state.quiet),
    `</fieldset>`,
    `</div>`,
    `<div class="bn-legend" aria-hidden="true"><span class="bn-key bn-a">● A</span><span class="bn-key bn-b">■ B</span><span class="bn-key">— median</span><span class="bn-key bn-key-true">- - true speed</span></div>`,
    `<div class="bn-plot" data-part="chart">${p.chart}</div>`,
    `<p class="bn-verdict" data-part="verdict" data-tone="${p.tone}" aria-live="polite">${p.verdict}</p>`,
    `<p class="bn-repeats" data-part="repeats">${p.repeats}</p>`,
    `<div class="bn-actions"><button type="button" name="rerun" disabled>Run it again</button></div>`,
    `<details class="bn-details"><summary>The measurement record for this run</summary><pre class="bn-record" data-part="record">${p.record}</pre></details>`,
    `<figcaption>Simulated data. Version A takes ${BASE_NS} ns per operation; the noise sizes are illustrative, not measurements.</figcaption>`,
    `</figure>`,
  ].join("");
}
