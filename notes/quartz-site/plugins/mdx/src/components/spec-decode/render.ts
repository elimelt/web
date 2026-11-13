// Markup for the two speculative decoding figures, the replay (this
// directory) and the speedup charts (../spec-decode-speedup). The build renders each
// figure in its default state, so the page shows real data before any script
// runs; the client redraws the same parts with these functions.

import { esc } from "../../shared/format";
import {
  acceptProb,
  accepts,
  decodingAlpha,
  domainLabel,
  domains,
  expectedTokens,
  measuredCosts,
  piece,
  residual,
  results,
  tokensBefore,
  tokensPerPass,
  traces,
  type Domain,
  type Position,
  type Round,
  type Trace,
} from "./model";


/** A token as a label: spaces and newlines made visible, long pieces cut. */
export function label(text: string, max = 12): string {
  let s = text.replace(/\n/g, "↵").replace(/\t/g, "⇥").replace(/ /g, "␣");
  if (s.length > max) s = s.slice(0, max - 1) + "…";
  return esc(s);
}

const num = (v: number): string => (v >= 0.995 && v < 1 ? ">.99" : v > 0 && v < 0.005 ? "<.01" : v.toFixed(2).replace(/^0/, ""));

// ---------------------------------------------------------------------------
// Replay of recorded rounds

export interface ReplayState {
  domain: Domain;
  round: number;
  /** index of the drafted position whose distributions are shown; gamma means the extra token */
  sel: number;
}

/** The position worth showing first: the rejection, or the free extra token. */
export const defaultSel = (r: Round): number => r.accepted;

export const replayDefault = (domain: Domain = "code"): ReplayState => ({ domain, round: 0, sel: defaultSel(traces[domain].rounds[0]) });

const CONTEXT_CHARS = 220;

function textPart(trace: Trace, s: ReplayState): string {
  const r = trace.rounds[s.round];
  const before = tokensBefore(trace, s.round);
  const promptLen = trace.prompt.length;
  // Walk back from the end until the context is long enough.
  let start = before.length;
  let chars = 0;
  while (start > 0 && chars < CONTEXT_CHARS) chars += piece(trace, before[--start]).length;
  const spans: string[] = [];
  if (start > 0) spans.push(`<span class="sd-ctx">…</span>`);
  for (let i = start; i < before.length; i++) {
    spans.push(`<span class="${i < promptLen ? "sd-ctx" : "sd-done"}">${esc(piece(trace, before[i]))}</span>`);
  }
  r.drafted.forEach((x, i) => {
    const cls = i < r.accepted ? "sd-kept" : i === r.accepted ? "sd-rej" : "sd-skip";
    const sel = i === s.sel ? " sd-sel" : "";
    spans.push(`<span class="sd-tok ${cls}${sel}" data-pos="${i}">${esc(piece(trace, x))}</span>`);
  });
  const fix = r.emitted[r.emitted.length - 1];
  spans.push(`<span class="sd-tok sd-new${s.sel === r.drafted.length ? " sd-sel" : ""}" data-pos="${r.drafted.length}">${esc(piece(trace, fix))}</span>`);
  return spans.join("");
}

function summaryPart(trace: Trace, s: ReplayState): string {
  const r = trace.rounds[s.round];
  const g = r.drafted.length;
  const fix = label(piece(trace, r.emitted[r.emitted.length - 1]), 16);
  const kept =
    r.accepted === g
      ? `The target kept all ${g} and added <b>${fix}</b>, sampled from its own distribution at the next position.`
      : r.accepted === 0
        ? `The target rejected the first one and put <b>${fix}</b> in its place, sampled from the residual.`
        : `The target kept the first ${r.accepted}, rejected draft ${r.accepted + 1}, and put <b>${fix}</b> in its place, sampled from the residual.`;
  const avg = tokensPerPass(trace, s.round).toFixed(2);
  return `The draft proposed ${g} tokens. ${kept} That is ${r.emitted.length} token${r.emitted.length > 1 ? "s" : ""} from one target pass${s.round > 0 ? `; ${avg} per pass over rounds 1 to ${s.round + 1}` : ""}.`;
}

function tablePart(trace: Trace, s: ReplayState): string {
  const r = trace.rounds[s.round];
  const rows = r.drafted.map((x, i) => {
    const pos: Position | undefined = r.positions[i];
    const sel = i === s.sel ? ` aria-pressed="true"` : ` aria-pressed="false"`;
    const tok = `<button type="button" class="sd-pick" data-pos="${i}"${sel}>${label(piece(trace, x))}</button>`;
    if (!pos) return `<tr class="sd-row-skip"><td>${i + 1}</td><td>${tok}</td><td colspan="4">never checked</td><td>discarded</td></tr>`;
    const ok = accepts(pos);
    return `<tr class="${ok ? "sd-row-kept" : "sd-row-rej"}"><td>${i + 1}</td><td>${tok}</td><td>${num(pos.px)}</td><td>${num(pos.qx)}</td><td>${num(acceptProb(pos.px, pos.qx))}</td><td>${num(pos.u ?? 0)}</td><td>${ok ? "kept" : "rejected"}</td></tr>`;
  });
  const fix = r.emitted[r.emitted.length - 1];
  const sel = s.sel === r.drafted.length ? ` aria-pressed="true"` : ` aria-pressed="false"`;
  rows.push(
    `<tr class="sd-row-new"><td>${r.accepted === r.drafted.length ? r.drafted.length + 1 : r.accepted + 1}</td><td><button type="button" class="sd-pick" data-pos="${r.drafted.length}"${sel}>${label(piece(trace, fix))}</button></td><td colspan="4">${r.accepted === r.drafted.length ? "sampled from q" : "sampled from the residual"}</td><td>added</td></tr>`,
  );
  return [
    `<table class="sd-table"><thead><tr><th>#</th><th>token</th><th title="draft probability of the token">p(x)</th><th title="target probability of the token">q(x)</th><th title="keep if u is below min(1, q/p)">min(1, q/p)</th><th title="uniform random draw">u</th><th></th></tr></thead>`,
    `<tbody>${rows.join("")}</tbody></table>`,
  ].join("");
}

const bar = (cls: string, v: number) => `<span class="sd-b ${cls}" style="width:${(Math.min(1, v) * 100).toFixed(1)}%"></span>`;

function distPart(trace: Trace, s: ReplayState): string {
  const r = trace.rounds[s.round];
  const g = r.drafted.length;
  const fix = r.emitted[r.emitted.length - 1];
  if (s.sel === g) {
    // The extra token after all drafts were kept: only q exists here.
    const top = r.bonus_top ?? [];
    const scale = Math.max(...top.map(([, q]) => q), 1e-9);
    const rows = top.map(
      ([t, q]) =>
        `<li${t === fix ? ` class="sd-chosen"` : ""}><span class="sd-lab">${label(piece(trace, t))}</span><span class="sd-bars">${bar("sd-q", q / scale)}</span><span class="sd-val">q ${num(q)}</span></li>`,
    );
    if (!top.length) {
      const pos = r.positions[r.accepted];
      return pos ? distPart(trace, { ...s, sel: r.accepted }) : "";
    }
    return `<p class="sd-dhead">Position ${g + 1}: every draft was kept, so the target pass already holds q for the next position. The extra token is sampled from it at no extra cost.</p><ul class="sd-dist">${rows.join("")}</ul>`;
  }
  const pos = r.positions[s.sel];
  if (!pos) {
    return `<p class="sd-dhead">Draft ${s.sel + 1} came after a rejection. The target's distribution there assumed the rejected token, so it is thrown away unchecked.</p>`;
  }
  const rejected = s.sel === r.accepted;
  const scale = Math.max(...pos.top.map(([, p, q]) => Math.max(p, q, rejected ? residual(pos, p, q) : 0)), 1e-9);
  const rows = pos.top.map(([t, p, q]) => {
    const tags = [t === pos.x ? "drafted" : "", rejected && t === fix ? "sampled" : ""].filter(Boolean).join(", ");
    const res = rejected ? bar("sd-r", residual(pos, p, q) / scale) : "";
    return `<li${t === pos.x ? ` class="sd-drafted"` : rejected && t === fix ? ` class="sd-chosen"` : ""}><span class="sd-lab">${label(piece(trace, t))}${tags ? `<small>${tags}</small>` : ""}</span><span class="sd-bars">${bar("sd-p", p / scale)}${bar("sd-q", q / scale)}${res}</span><span class="sd-val">p ${num(p)} · q ${num(q)}${rejected ? ` · r ${num(residual(pos, p, q))}` : ""}</span></li>`;
  });
  const head = rejected
    ? `Position ${s.sel + 1}: rejected because u = ${num(pos.u ?? 0)} ≥ ${num(acceptProb(pos.px, pos.qx))}. The replacement comes from the residual r ∝ max(q − p, 0), which keeps only the mass the draft under-proposed. Here the draft and target overlap by Σ min(p, q) = ${num(pos.alpha)}.`
    : `Position ${s.sel + 1}: kept because u = ${num(pos.u ?? 0)} < ${num(acceptProb(pos.px, pos.qx))}. The draft and target overlap by Σ min(p, q) = ${num(pos.alpha)} here, which is the chance this position passes.`;
  return `<p class="sd-dhead">${head}</p><ul class="sd-dist">${rows.join("")}</ul>`;
}

export interface ReplayParts {
  text: string;
  summary: string;
  table: string;
  dist: string;
  counter: string;
}

export function replayParts(s: ReplayState): ReplayParts {
  const trace = traces[s.domain];
  return {
    text: textPart(trace, s),
    summary: summaryPart(trace, s),
    table: tablePart(trace, s),
    dist: distPart(trace, s),
    counter: `Round ${s.round + 1} of ${trace.rounds.length}`,
  };
}

const segmented = (name: string, options: [string, string][], value: string) =>
  `<div class="sd-seg" role="group">${options
    .map(([v, text]) => `<button type="button" name="${name}" value="${v}" aria-pressed="${v === value}" disabled>${text}</button>`)
    .join("")}</div>`;

export function renderReplay(): string {
  const s = replayDefault();
  const p = replayParts(s);
  const legend = `<div class="sd-legend" aria-hidden="true"><span class="sd-key sd-kept">kept draft</span><span class="sd-key sd-rej">rejected draft</span><span class="sd-key sd-skip">discarded</span><span class="sd-key sd-new">target's token</span></div>`;
  return [
    `<figure class="sd sd-replay" data-domain="${s.domain}">`,
    `<div class="sd-bar">${segmented("domain", domains.map((d) => [d, domainLabel[d]]), s.domain)}`,
    `<div class="sd-step"><button type="button" name="prev" aria-label="Previous round" disabled>←</button><span data-part="counter" aria-live="polite">${p.counter}</span><button type="button" name="next" aria-label="Next round" disabled>→</button></div></div>`,
    `<pre class="sd-text" data-part="text">${p.text}</pre>`,
    legend,
    `<p class="sd-summary" data-part="summary">${p.summary}</p>`,
    `<div class="sd-scroll" data-part="table">${p.table}</div>`,
    `<div data-part="dist">${p.dist}</div>`,
    `<figcaption>Recorded rounds with draft length 4 at temperature 1, from the draft and target models trained for this note. Probabilities are the models' own; u is the uniform draw the run used. Bars are scaled to the largest value shown.</figcaption>`,
    `</figure>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Speedup against draft length

export interface SpeedState {
  domain: Domain;
  temp: "0" | "1";
  batch: "1" | "4" | "16" | "64";
}

export const speedDefault = (): SpeedState => ({ domain: "code", temp: "1", batch: "1" });

const W = 320;
const H = 220;
const M = { left: 38, right: 10, top: 26, bottom: 34 };

interface Series {
  points: { g: number; y: number; lo?: number; hi?: number }[];
  cls: string;
  line: boolean;
}

function chart(series: Series[], yMax: number, yLabel: string, gammas: number[], refY?: number): string {
  const gMax = gammas[gammas.length - 1];
  const x = (g: number) => M.left + ((g - 1) / (gMax - 1)) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - v / yMax) * (H - M.top - M.bottom);
  const parts: string[] = [];
  const step = yMax > 6 ? 2 : yMax > 2.5 ? 1 : 0.5;
  for (let t = 0; t <= yMax + 1e-9; t += step) {
    parts.push(`<line class="sd-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(t)}" y2="${y(t)}"/>`, `<text class="sd-tick" x="${M.left - 5}" y="${y(t) + 4}" text-anchor="end">${+t.toFixed(1)}</text>`);
  }
  for (const g of gammas) parts.push(`<text class="sd-tick" x="${x(g)}" y="${H - M.bottom + 15}" text-anchor="middle">${g}</text>`);
  parts.push(`<text class="sd-tick" x="${(M.left + W - M.right) / 2}" y="${H - 4}" text-anchor="middle">draft length γ</text>`);
  parts.push(`<text class="sd-tick" x="${M.left - 30}" y="11">${yLabel}</text>`);
  if (refY !== undefined) parts.push(`<line class="sd-ref" x1="${M.left}" x2="${W - M.right}" y1="${y(refY)}" y2="${y(refY)}"/>`);
  for (const s of series) {
    if (s.line) {
      const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(p.g).toFixed(1)},${y(Math.min(p.y, yMax)).toFixed(1)}`).join("");
      parts.push(`<path class="${s.cls}" d="${d}"/>`);
    } else {
      for (const p of s.points) {
        if (p.lo !== undefined && p.hi !== undefined) parts.push(`<line class="${s.cls}-err" x1="${x(p.g)}" x2="${x(p.g)}" y1="${y(p.lo)}" y2="${y(Math.min(p.hi, yMax))}"/>`);
        parts.push(`<circle class="${s.cls}" cx="${x(p.g)}" cy="${y(Math.min(p.y, yMax))}" r="3.5"/>`);
      }
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${parts.join("")}</svg>`;
}

export interface SpeedParts {
  tokens: string;
  speed: string;
  note: string;
}

export function speedParts(s: SpeedState): SpeedParts {
  const key = `${s.domain}_T${s.temp}`;
  const run = results.runs[key];
  const alpha = results.alpha[key].mean;
  // With one draft per round, the share of drafts kept is the mean acceptance
  // rate over the text the decoder actually produced.
  const alphaRun = decodingAlpha(key);
  const gammas = results.run_setup.gammas;
  const fine = Array.from({ length: (gammas[gammas.length - 1] - 1) * 4 + 1 }, (_, i) => 1 + i / 4);
  const b1 = measuredCosts("1");
  const bb = measuredCosts(s.batch);

  const tokPts = gammas.map((g) => {
    const r = run.gamma[g];
    return { g, y: r.tokens_per_round, lo: r.tokens_per_round - 2 * r.tokens_per_round_se, hi: r.tokens_per_round + 2 * r.tokens_per_round_se };
  });
  const tokMax = Math.ceil(Math.max(...tokPts.map((p) => p.hi), ...fine.map((g) => expectedTokens(Math.max(alpha, alphaRun), g)))) + 0.5;
  const tokens = chart(
    [
      { points: fine.map((g) => ({ g, y: expectedTokens(alpha, g) })), cls: "sd-formula", line: true },
      { points: fine.map((g) => ({ g, y: expectedTokens(alphaRun, g) })), cls: "sd-formula2", line: true },
      { points: tokPts, cls: "sd-meas", line: false },
    ],
    tokMax,
    "tokens per target pass",
    gammas,
  );

  const measured = gammas.map((g) => ({ g, y: run.gamma[g].speedup, lo: run.gamma[g].speedup_q25, hi: run.gamma[g].speedup_q75 }));
  // Prediction: measured tokens per pass divided by the measured cost of a round in target steps.
  const predicted = (costs: typeof b1) => gammas.map((g) => ({ g, y: run.gamma[g].tokens_per_round / (g * costs.c + costs.v(g)) }));
  const ideal = fine.map((g) => ({ g, y: expectedTokens(alphaRun, g) / (g * b1.c + 1) }));
  const series: Series[] = [
    { points: ideal, cls: "sd-formula2", line: true },
    { points: predicted(bb), cls: "sd-pred", line: true },
  ];
  if (s.batch === "1") series.push({ points: measured, cls: "sd-meas", line: false });
  const all = [...measured.map((p) => p.hi), ...ideal.map((p) => p.y), ...predicted(bb).map((p) => p.y)];
  const speed = chart(series, Math.ceil(Math.max(...all) * 2) / 2, "speedup", gammas, 1);

  const best = predicted(bb).reduce((a, b) => (b.y > a.y ? b : a));
  const note =
    `${domainLabel[s.domain]} at ${s.temp === "0" ? "greedy decoding" : "temperature 1"}: mean acceptance α = ${alpha.toFixed(2)} on held-out text and ${alphaRun.toFixed(2)} on the text the decoder wrote. ` +
    `A draft step costs c = ${bb.c.toFixed(2)} target steps at batch ${s.batch}, and checking γ = 4 drafts costs ${bb.v(4).toFixed(2)} target steps. ` +
    (s.batch === "1"
      ? `Measured end to end, the best draft length is γ = ${measured.reduce((a, b) => (b.y > a.y ? b : a)).g}.`
      : `At this batch size the prediction peaks at ${best.y.toFixed(2)}× with γ = ${best.g}${best.y < 1 ? ", so speculation is a slowdown at every length" : ""}.`);
  return { tokens, speed, note };
}

export function renderSpeedup(): string {
  const s = speedDefault();
  const p = speedParts(s);
  return [
    `<figure class="sd sd-speed">`,
    `<div class="sd-bar">${segmented("domain", domains.map((d) => [d, domainLabel[d]]), s.domain)}`,
    segmented("temp", [["1", "T = 1"], ["0", "greedy"]], s.temp),
    `<label class="sd-batch">batch <select name="batch" disabled>${["1", "4", "16", "64"].map((b) => `<option${b === s.batch ? " selected" : ""}>${b}</option>`).join("")}</select></label></div>`,
    `<div class="sd-charts"><div data-part="tokens">${p.tokens}</div><div data-part="speed">${p.speed}</div></div>`,
    `<div class="sd-legend" aria-hidden="true"><span class="sd-key sd-k-meas">measured (±2 SE; speedup: quartiles)</span><span class="sd-key sd-k-formula">formula, α from held-out text</span><span class="sd-key sd-k-formula2">formula, α seen while decoding</span><span class="sd-key sd-k-pred">predicted from measured pass costs</span></div>`,
    `<p class="sd-summary" data-part="note">${p.note}</p>`,
    `<figcaption>All points come from measure.py on a 4-core CPU: 16 held-out prompts × 3 repeats, 128 new tokens each. Only batch 1 was decoded end to end; other batch sizes rescale the batch-1 tokens per pass by forward-pass times measured at that batch size.</figcaption>`,
    `</figure>`,
  ].join("");
}
