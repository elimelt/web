// Markup for the pipeline schedule figure: for each schedule shown, one row
// per device with its forward and backward operations on a shared time axis,
// the idle time (the bubble) left blank, and below the rows the number of
// microbatches whose activations the first device holds over time. The build
// renders the finished figure; client.ts reruns the simulation when a slider
// moves.

import { esc, num } from "../../shared/format";
import { closedBubble, KINDS, simulate, valid, type Kind, type Result } from "./model";

export interface Props {
  schedules?: string;
  p?: number;
  m?: number;
  v?: number;
  caption?: string;
}

export interface State {
  kinds: Kind[];
  p: number;
  m: number;
  v: number;
}

export const LIMITS = { p: [1, 8], m: [1, 16], v: [2, 4] } as const;

const NAMES: Record<Kind, string> = { gpipe: "GPipe", "1f1b": "1F1B", interleaved: "Interleaved 1F1B" };

const clamp = (x: unknown, [lo, hi]: readonly [number, number], dflt: number) =>
  typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : dflt;

export function stateFrom(props: Props): State {
  const kinds = (props.schedules ?? "gpipe,1f1b,interleaved")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Kind => (KINDS as readonly string[]).includes(s));
  return {
    kinds: kinds.length ? kinds : ["gpipe", "1f1b"],
    p: clamp(props.p, LIMITS.p, 4),
    m: clamp(props.m, LIMITS.m, 8),
    v: clamp(props.v, LIMITS.v, 2),
  };
}

const pctText = (x: number) => `${num(x * 100, 1).replace(/\.0$/, "")}%`;

/** A fraction such as 3/8 in lowest terms. */
function frac(a: number, b: number): string {
  const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
  const d = g(a, b) || 1;
  return b / d === 1 ? String(a / d) : `${a / d}/${b / d}`;
}

const fmtT = (t: number) => (Math.abs(t - Math.round(t)) < 1e-9 ? String(Math.round(t)) : num(t, 2).replace(/0$/, ""));

export function results(s: State): (Result | { kind: Kind; invalid: true })[] {
  return s.kinds.map((k) => (valid(k, s.p, s.m) ? simulate(k, s.p, s.m, s.v) : { kind: k, invalid: true as const }));
}

function summary(r: Result): string {
  const vv = r.kind === "interleaved" ? r.v : 1;
  const idle = r.makespan - r.ideal; // chunk units
  const closed = closedBubble(r.kind, r.p, r.m, vv);
  const form = r.kind === "interleaved" ? "(p − 1)/(m v)" : "(p − 1)/m";
  return `bubble ${frac(idle, r.ideal)} of busy time = ${pctText(r.bubble)} (closed form ${form} = ${pctText(closed)}); device 1 holds at most ${fmtT(r.peak[0])} microbatches`;
}

/** The chart for every schedule, on one time axis in whole-device forward passes. */
export function chartHtml(s: State): string {
  const rs = results(s);
  const sims = rs.filter((r): r is Result => !("invalid" in r));
  const horizon = Math.max(1, ...sims.map((r) => r.makespan / r.v));
  const held = Math.max(1, ...sims.map((r) => r.peak[0]));
  const pct = (t: number) => `${((t / horizon) * 100).toFixed(3)}%`;
  const blocks: string[] = [];
  for (const r of rs) {
    if ("invalid" in r) {
      blocks.push(
        `<div class="ps-block"><p class="ps-head"><strong>${NAMES[r.kind]}</strong>: Megatron-LM's interleaved schedule needs m to be a multiple of p; m = ${s.m} is not a multiple of p = ${s.p}.</p></div>`,
      );
      continue;
    }
    const rows: string[] = [];
    for (let i = 0; i < r.p; i++) {
      const segs = r.ops
        .filter((o) => o.device === i)
        .map((o) => {
          const a = o.start / r.v;
          const w = (o.end - o.start) / r.v;
          const label = w / horizon >= 0.028 ? String(o.mb + 1) : "";
          const stage = o.chunk * r.p + i + 1;
          const title = `${o.phase === "F" ? "Forward" : "Backward"} of microbatch ${o.mb + 1} on model stage ${stage}${r.v > 1 ? ` (chunk ${o.chunk + 1} of device ${i + 1})` : ""}, ${fmtT(a)} to ${fmtT(a + w)}`;
          return `<span class="ps-seg ps-${o.phase} ps-k${o.chunk}" style="left:${pct(a)};width:${pct(w)}" title="${esc(title)}">${label}</span>`;
        })
        .join("");
      rows.push(
        `<div class="ps-row"><span class="ps-name">Device ${i + 1}</span><div class="ps-track">${segs}</div><span class="ps-stat" title="peak microbatches in flight">${fmtT(r.peak[i])}</span></div>`,
      );
    }
    // Activations held on device 1, as a step chart scaled to the largest peak shown.
    const steps = r.inflight[0];
    const W = 1000;
    const H = 100;
    const x = (t: number) => ((t / r.v / horizon) * W).toFixed(1);
    const y = (c: number) => (H - (c / r.v / held) * (H - 6)).toFixed(1);
    let d = `M0 ${H}`;
    for (let k = 0; k < steps.length; k++) {
      const [t, c] = steps[k];
      const prev = k ? steps[k - 1][1] : 0;
      d += ` L${x(t)} ${y(prev)} L${x(t)} ${y(c)}`;
    }
    d += ` L${x(r.makespan)} ${y(0)} Z`;
    rows.push(
      `<div class="ps-row ps-held"><span class="ps-name">Held, device 1</span><div class="ps-track"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg></div><span class="ps-stat"></span></div>`,
    );
    blocks.push(
      `<div class="ps-block"><p class="ps-head"><strong>${NAMES[r.kind]}</strong>${r.kind === "interleaved" ? `, v = ${r.v}` : ""}: ${esc(summary(r))}.</p>${rows.join("")}</div>`,
    );
  }
  const step = [1, 2, 5, 10, 20, 50].find((st) => horizon / st <= 10) ?? 100;
  const ticks: string[] = [];
  for (let t = 0; t <= horizon + 1e-9; t += step) ticks.push(`<span style="left:${pct(t)}">${t}</span>`);
  blocks.push(`<div class="ps-row ps-axis"><span class="ps-name"></span><div class="ps-track">${ticks.join("")}</div><span class="ps-stat"></span></div>`);
  return blocks.join("");
}

function slider(name: keyof typeof LIMITS, label: string, value: number, interactive: boolean): string {
  const [lo, hi] = LIMITS[name];
  return `<label class="ps-slider"><span>${label} <output name="${name}">${value}</output></span><input type="range" name="${name}" min="${lo}" max="${hi}" step="1" value="${value}"${interactive ? "" : " disabled"}></label>`;
}

export function controlsHtml(s: State, interactive: boolean): string {
  return [
    slider("p", "Stages p", s.p, interactive),
    slider("m", "Microbatches m", s.m, interactive),
    s.kinds.includes("interleaved") ? slider("v", "Chunks per device v", s.v, interactive) : "",
  ].join("");
}

export function render(props: Props): string {
  const s = stateFrom(props);
  return `<figure class="ps" data-state="${esc(JSON.stringify(s))}">
<div class="ps-controls">${controlsHtml(s, false)}</div>
<div class="ps-legend" aria-hidden="true"><span class="ps-key ps-F"></span>forward <span class="ps-key ps-B"></span>backward (twice a forward) <span class="ps-key ps-gap"></span>idle (bubble). Numbers are microbatches${s.kinds.includes("interleaved") ? "; lighter shades are a device's later chunks" : ""}. The right column is each device's peak count of microbatches in flight.</div>
<div class="ps-chart" data-part="chart">${chartHtml(s)}</div>
${props.caption ? `<figcaption>${esc(props.caption)}</figcaption>` : ""}
</figure>`;
}
