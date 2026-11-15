// Markup for the history checker. The build renders the preset's history and
// the three verdicts, computed by the same checkers the browser runs, with
// the controls disabled; the client redraws the timeline and the verdicts
// from these functions after every edit.

import { esc } from "../../shared/format";
import {
  causalViews,
  cloneOps,
  label,
  linearizationPoints,
  linearize,
  minimalRejected,
  MODELS,
  presets,
  serialize,
  type Axis,
  type Model,
  type Op,
} from "./model";

export interface State {
  preset: string;
  procs: number;
  axis: Axis;
  ops: Op[];
  selected: string | null;
  /** The model whose witness or rejected core the timeline draws. */
  shown: Model | null;
}

export function initialState(preset: string): State {
  const key = preset in presets ? preset : "stale";
  const pr = presets[key];
  return { preset: key, procs: pr.procs, axis: { ...pr.axis }, ops: cloneOps(pr.ops), selected: null, shown: null };
}

export const NAMES: Record<Model, string> = {
  linearizable: "Linearizable",
  sequential: "Sequentially consistent",
  causal: "Causal",
};

// ---- Geometry, shared with the client for dragging.

export const W = 640;
export const M = { left: 34, right: 14, top: 30, bottom: 30 };
export const LANE = 58;
export const BAR = 20;
export const height = (s: State) => M.top + LANE * s.procs + M.bottom - 18;
export const xOf = (s: State, t: number) => M.left + (t / s.axis.max) * (W - M.left - M.right);
export const tPerPx = (s: State) => s.axis.max / (W - M.left - M.right);
export const yOf = (p: number) => M.top + p * LANE;

const fmt = (s: State, t: number) => {
  const digits = s.axis.step < 1 ? (s.axis.step < 0.1 ? 2 : 1) : 0;
  return `${t.toFixed(digits)}`;
};

const opText = (s: State, o: Op) => `P${o.p + 1} ${label(o)}`;
const opSpan = (s: State, o: Op) => `${opText(s, o)} [${fmt(s, o.call)}, ${fmt(s, o.ret)}${s.axis.unit}]`;

export interface Analysis {
  lin: number[] | null;
  sc: number[] | null;
  views: Map<number, number[]> | null;
  core: Record<Model, string[]>;
}

export function analyze(s: State): Analysis {
  const lin = linearize(s.ops);
  const sc = serialize(s.ops);
  const views = causalViews(s.ops);
  return {
    lin,
    sc,
    views,
    core: {
      linearizable: lin ? [] : minimalRejected("linearizable", s.ops),
      sequential: sc ? [] : minimalRejected("sequential", s.ops),
      causal: views ? [] : minimalRejected("causal", s.ops),
    },
  };
}

const ok = (a: Analysis, m: Model) => (m === "linearizable" ? !!a.lin : m === "sequential" ? !!a.sc : !!a.views);

/** The model drawn on the timeline: the reader's pick, else the weakest model the history fails, else linearizability. */
export function shownModel(s: State, a: Analysis): Model {
  if (s.shown) return s.shown;
  const failing = MODELS.filter((m) => !ok(a, m));
  return failing.length ? failing[failing.length - 1] : "linearizable";
}

// ---- The timeline.

export function svg(s: State, a: Analysis = analyze(s)): string {
  const h = height(s);
  const parts: string[] = [];
  const shown = shownModel(s, a);
  const core = new Set(a.core[shown]);
  const ticks = s.axis.max <= 24 ? 2 : 10;
  for (let t = 0; t <= s.axis.max + 1e-9; t += ticks) {
    const x = xOf(s, t);
    parts.push(
      `<line class="hc-grid" x1="${x}" x2="${x}" y1="${M.top - 20}" y2="${h - M.bottom + 4}"/>`,
      `<text class="hc-tick" x="${x}" y="${h - M.bottom + 18}" text-anchor="middle">${t}</text>`,
    );
  }
  if (s.axis.unit) parts.push(`<text class="hc-tick" x="${W - M.right}" y="${h - 3}" text-anchor="end">time, ms</text>`);
  for (let p = 0; p < s.procs; p++) {
    const y = yOf(p);
    parts.push(
      `<line class="hc-lane" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`,
      `<text class="hc-pname" x="4" y="${y + 5}">P${p + 1}</text>`,
    );
  }
  const points = shown === "linearizable" && a.lin ? linearizationPoints(s.ops, a.lin) : null;
  const rank = new Map<string, number>();
  if (a.lin && points) a.lin.forEach((i, k) => rank.set(s.ops[i].id, k + 1));
  // A label that would overlap the previous one on its line goes below the bar.
  const below = new Set<string>();
  const lastEdge = new Map<number, number>();
  for (const o of [...s.ops].sort((a, b) => a.call - b.call)) {
    const cx = (xOf(s, o.call) + Math.max(xOf(s, o.ret), xOf(s, o.call) + 6)) / 2;
    const half = label(o).length * 5.6; // about the phone font size, in viewBox units
    if ((lastEdge.get(o.p) ?? -Infinity) > cx - half) below.add(o.id);
    else lastEdge.set(o.p, cx + half);
  }
  for (const o of s.ops) {
    const x1 = xOf(s, o.call);
    const x2 = Math.max(xOf(s, o.ret), x1 + 6);
    const y = yOf(o.p);
    const cls = [
      "hc-op",
      `hc-${o.kind}`,
      o.id === s.selected ? "hc-sel" : "",
      core.size ? (core.has(o.id) ? "hc-core" : "hc-dim") : "",
    ]
      .filter(Boolean)
      .join(" ");
    const desc = `${opSpan(s, o)}${o.kind === "r" ? ". Click to change the value it returns" : ""}. Drag to move; arrow keys move it, Shift with arrows moves its end, Delete removes it.`;
    parts.push(
      `<g class="${cls}" data-id="${o.id}" tabindex="0" role="button" aria-label="${esc(desc)}">`,
      `<rect class="hc-bar" x="${x1}" y="${y - BAR / 2}" width="${x2 - x1}" height="${BAR}" rx="4"/>`,
      `<rect class="hc-end" data-end="call" x="${x1 - 4}" y="${y - BAR / 2}" width="8" height="${BAR}"/>`,
      `<rect class="hc-end" data-end="ret" x="${x2 - 4}" y="${y - BAR / 2}" width="8" height="${BAR}"/>`,
      `<text class="hc-label" x="${(x1 + x2) / 2}" y="${below.has(o.id) ? y + BAR / 2 + 14 : y - BAR / 2 - 5}" text-anchor="middle">${esc(label(o))}</text>`,
    );
    const pt = points?.get(o.id);
    if (pt !== undefined) {
      const px = xOf(s, pt);
      parts.push(
        `<line class="hc-point" x1="${px}" x2="${px}" y1="${y - BAR / 2}" y2="${y + BAR / 2}"/>`,
        `<text class="hc-rank" x="${px}" y="${y + BAR / 2 + 13}" text-anchor="middle">${rank.get(o.id)}</text>`,
      );
    }
    parts.push(`</g>`);
  }
  const what = `Timeline of ${s.procs} processes and ${s.ops.length} operations on one register that starts at 0.`;
  return `<svg class="hc-svg" viewBox="0 0 ${W} ${h}" role="group" aria-label="${what}">${parts.join("")}</svg>`;
}

// ---- The verdicts.

function detail(s: State, a: Analysis, m: Model): string {
  const byId = new Map(s.ops.map((o) => [o.id, o]));
  if (!ok(a, m)) {
    const core = a.core[m].map((id) => opSpan(s, byId.get(id)!));
    if (!s.ops.every((o) => o.kind === "w" || o.v === 0 || s.ops.some((w) => w.kind === "w" && w.v === o.v)))
      return "A read returns a value nobody wrote.";
    return `Rejected already by ${core.length === 1 ? "this operation alone" : `these ${core.length} operations alone`}: ${core.join("; ")}.`;
  }
  if (!s.ops.length) return "The empty history.";
  if (m === "linearizable") return `Linearization: ${a.lin!.map((i) => opText(s, s.ops[i])).join(", ")}.`;
  if (m === "sequential") return `Sequential order: ${a.sc!.map((i) => opText(s, s.ops[i])).join(", ")}.`;
  const writes = (ix: number[]) => ix.filter((i) => s.ops[i].kind === "w").map((i) => s.ops[i].v);
  const views = [...a.views!.entries()].map(([p, ix]) => `P${p + 1} ${writes(ix).join(", ") || "none"}`);
  return `Order of writes in each process's view: ${views.join("; ")}.`;
}

export function verdictList(s: State, a: Analysis = analyze(s)): string {
  const shown = shownModel(s, a);
  return MODELS.map((m) => {
    const yes = ok(a, m);
    return `<button type="button" class="hc-verdict" name="show" value="${m}" data-ok="${yes}" aria-pressed="${m === shown}" disabled><span class="hc-vname">${NAMES[m]}</span><span class="hc-vmark">${yes ? "admits" : "rejects"}</span><span class="hc-vdetail">${esc(detail(s, a, m))}</span></button>`;
  }).join("");
}

// ---- The whole figure.

export interface Props {
  preset?: unknown;
}

const CAPTION =
  "One register, initially 0. Each bar is an operation from its invocation to its response; w(1) writes 1 and r→1 is a read that returned 1. Drag a bar or its ends, click a read to change what it returned, or add operations. The three checkers run on every edit. When the history is linearizable, the numbered ticks are linearization points; otherwise the outlined bars are a minimal sub-history that the highlighted model already rejects.";

export function render(props: Props = {}): string {
  const s = initialState(typeof props.preset === "string" ? props.preset : "stale");
  const a = analyze(s);
  const options = Object.entries(presets)
    .map(([key, p]) => `<option value="${key}"${key === s.preset ? " selected" : ""}>${esc(p.label)}</option>`)
    .join("");
  const procOptions = [0, 1, 2].map((p) => `<option value="${p}">P${p + 1}</option>`).join("");
  return [
    `<figure class="hc" data-preset="${s.preset}">`,
    `<div class="hc-top"><label class="hc-field">History <select name="preset" disabled>${options}</select></label></div>`,
    `<div class="hc-plot" data-part="svg">${svg(s, a)}</div>`,
    `<div class="hc-edit"><label class="hc-field">On <select name="proc" disabled>${procOptions}</select></label><button type="button" name="add-w" disabled>Add write</button><button type="button" name="add-r" disabled>Add read</button><button type="button" name="delete" disabled>Delete selected</button></div>`,
    `<div class="hc-verdicts" data-part="verdicts" aria-live="polite">${verdictList(s, a)}</div>`,
    `<figcaption>${CAPTION}</figcaption>`,
    `</figure>`,
  ].join("");
}
