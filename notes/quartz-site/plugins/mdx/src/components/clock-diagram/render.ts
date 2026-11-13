// Markup for the clock diagram. The build renders the whole figure from an
// example, so the page shows a finished diagram before any script runs; the
// client module redraws the same parts from these functions as the reader
// edits the diagram.

import { esc } from "../../shared/format";
import {
  compute,
  examples,
  happensBefore,
  hlcLead,
  hlcOrder,
  lamportOrder,
  messages,
  OFFSET_LIMIT,
  physicalOrder,
  PROCS,
  T_MAX,
  vectorOrder,
  cloneDiagram,
  type Computed,
  type Diagram,
  type Order,
  type Stamped,
} from "./model";

export type View = "lamport" | "vector" | "hlc" | "physical";
export type Mode = "select" | "local" | "message";

export interface State {
  example: string;
  diagram: Diagram;
  view: View;
  mode: Mode;
  /** Up to two selected event ids, oldest first. The last one is the focus. */
  selected: string[];
  pending: { proc: number; t: number } | null;
  status: string;
}

export const views: Record<View, string> = {
  lamport: "Lamport",
  vector: "Vector",
  hlc: "Hybrid logical",
  physical: "Physical",
};

export function initialState(example: string, view: View): State {
  const ex = examples[example] ?? examples.skew;
  return {
    example: examples[example] ? example : "skew",
    diagram: cloneDiagram(ex.diagram),
    view,
    mode: "select",
    selected: [...ex.pick],
    pending: null,
    status: "",
  };
}

// ---- Geometry, shared with the client for hit testing.

export const W = 640;
export const M = { left: 52, right: 18, top: 40, bottom: 62 };
export const ROW = 76;
export const H = M.top + ROW * (PROCS - 1) + M.bottom;
export const xOf = (t: number): number => M.left + (t / T_MAX) * (W - M.left - M.right);
export const tOf = (x: number): number => ((x - M.left) / (W - M.left - M.right)) * T_MAX;
export const yOf = (proc: number): number => M.top + proc * ROW;

const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

export function stampText(e: Stamped, view: View): string {
  switch (view) {
    case "lamport":
      return String(e.lamport);
    case "vector":
      return `[${e.vector.join(",")}]`;
    case "hlc":
      return `${e.hlc.l}.${e.hlc.c}`;
    default:
      return String(e.pt);
  }
}

const kindWord = { local: "local event", send: "send", recv: "receive" } as const;

function describe(e: Stamped): string {
  return `${e.name}, ${kindWord[e.kind]} on P${e.proc + 1} at true time ${e.t} ms. Lamport ${e.lamport}, vector [${e.vector.join(", ")}], hybrid ${e.hlc.l}.${e.hlc.c}, physical ${e.pt} ms.`;
}

// ---- The diagram.

export function svg(state: State, c: Computed = compute(state.diagram)): string {
  const d = state.diagram;
  const parts: string[] = [];
  const focus = state.selected.length ? state.selected[state.selected.length - 1] : null;

  for (let t = 0; t <= T_MAX; t += 10) {
    const x = xOf(t);
    parts.push(
      `<line class="cd-grid" x1="${x}" x2="${x}" y1="${M.top - 22}" y2="${H - M.bottom + 28}"/>`,
      `<text class="cd-tick" x="${x}" y="${H - M.bottom + 42}" text-anchor="middle">${t}</text>`,
    );
  }
  parts.push(
    `<text class="cd-tick" x="${W - M.right}" y="${H - 6}" text-anchor="end">true time, ms (no process can see this axis)</text>`,
  );

  for (let p = 0; p < PROCS; p++) {
    const y = yOf(p);
    parts.push(
      `<line class="cd-proc" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`,
      `<text class="cd-pname" x="8" y="${y + 1}">P${p + 1}</text>`,
      `<text class="cd-poff" x="8" y="${y + 15}">${signed(d.offsets[p])} ms</text>`,
      `<rect class="cd-band" data-proc="${p}" x="${M.left - 6}" y="${y - 22}" width="${W - M.left - M.right + 12}" height="44"/>`,
    );
  }

  for (const m of messages(d, c)) {
    const x1 = xOf(m.send.t);
    const y1 = yOf(m.send.proc);
    const x2 = xOf(m.recv.t);
    const y2 = yOf(m.recv.proc);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const tipX = x2 - ux * 8;
    const tipY = y2 - uy * 8;
    const head = `M${tipX} ${tipY}L${tipX - ux * 9 - uy * 4.5} ${tipY - uy * 9 + ux * 4.5}L${tipX - ux * 9 + uy * 4.5} ${tipY - uy * 9 - ux * 4.5}Z`;
    const bad = state.view === "physical" && m.gap <= 0;
    const cls = `cd-msg${bad ? " cd-bad" : ""}`;
    parts.push(`<g class="${cls}"><line x1="${x1}" y1="${y1}" x2="${tipX - ux * 6}" y2="${tipY - uy * 6}"/><path d="${head}"/></g>`);
    if (bad) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      parts.push(
        `<text class="cd-badlabel" x="${mx + 8}" y="${my}">${m.gap < 0 ? `arrives ${-m.gap} ms before it left` : "same reading"}</text>`,
      );
    }
  }

  if (state.pending) {
    parts.push(`<circle class="cd-pending" cx="${xOf(state.pending.t)}" cy="${yOf(state.pending.proc)}" r="7"/>`);
  }

  const fi = focus ? c.index.get(focus) : undefined;
  for (const e of c.events) {
    const i = c.index.get(e.id)!;
    let rel = "";
    if (fi !== undefined && e.id !== focus) {
      if (c.past[fi].has(i)) rel = " cd-past";
      else if (c.past[i].has(fi)) rel = " cd-future";
      else rel = " cd-conc";
    }
    const sel = state.selected.includes(e.id) ? " cd-sel" : "";
    const x = xOf(e.t);
    const y = yOf(e.proc);
    parts.push(
      `<g class="cd-ev cd-${e.kind}${rel}${sel}" data-id="${e.id}" tabindex="0" role="button" aria-pressed="${sel ? "true" : "false"}" aria-label="${esc(describe(e))}">`,
      `<circle class="cd-hit" cx="${x}" cy="${y}" r="13"/>`,
      `<circle class="cd-dot" cx="${x}" cy="${y}" r="6"/>`,
      `<text class="cd-stamp" x="${x}" y="${y - 12}" text-anchor="middle">${stampText(e, state.view)}</text>`,
      `<text class="cd-name" x="${x}" y="${y + 21}" text-anchor="middle">${e.name}</text>`,
      `</g>`,
    );
  }

  const label = `Space-time diagram of ${PROCS} processes with ${c.events.length} events and ${d.msgs.length} messages, labeled with ${views[state.view].toLowerCase()} timestamps.`;
  return `<svg class="cd-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${label}">${parts.join("")}</svg>`;
}

// ---- The readout under the diagram.

const truthWords: Record<Order, (a: string, b: string) => string> = {
  before: (a, b) => `${a} happens before ${b}`,
  after: (a, b) => `${b} happens before ${a}`,
  concurrent: (a, b) => `${a} and ${b} are concurrent`,
  same: (a) => `${a} is one event`,
};

/** What a clock's comparison claims, and whether the claim is right. */
function verdict(clock: Order, truth: Order, a: string, b: string, vector = false): { text: string; tone: string } {
  if (truth === "concurrent") {
    if (vector) return { text: "concurrent", tone: "right" };
    if (clock === "same") return { text: "tie; can't tell", tone: "meh" };
    const first = clock === "before" ? a : b;
    return { text: `${first} first, but nothing orders them`, tone: "meh" };
  }
  const first = truth === "before" ? a : b;
  if (clock === truth) return { text: `${first} first`, tone: "right" };
  if (clock === "same") return { text: "tie; loses the order", tone: "wrong" };
  return { text: `${first === a ? b : a} first: backwards`, tone: "wrong" };
}

function pairTable(c: Computed, a: Stamped, b: Stamped): string {
  const truth = happensBefore(c, a.id, b.id);
  const rows: Array<[string, string, string, { text: string; tone: string }]> = [
    ["Lamport", String(a.lamport), String(b.lamport), verdict(lamportOrder(a, b), truth, a.name, b.name)],
    [
      "Vector",
      `[${a.vector.join(",")}]`,
      `[${b.vector.join(",")}]`,
      verdict(vectorOrder(a.vector, b.vector), truth, a.name, b.name, true),
    ],
    ["Hybrid logical", `${a.hlc.l}.${a.hlc.c}`, `${b.hlc.l}.${b.hlc.c}`, verdict(hlcOrder(a, b), truth, a.name, b.name)],
    ["Physical", `${a.pt} ms`, `${b.pt} ms`, verdict(physicalOrder(a, b), truth, a.name, b.name)],
  ];
  const body = rows
    .map(
      ([clock, x, y, v]) =>
        `<tr><th scope="row">${clock}</th><td>${x}</td><td>${y}</td><td data-tone="${v.tone}">${v.text}</td></tr>`,
    )
    .join("");
  return [
    `<p class="cd-truth"><strong>${truthWords[truth](a.name, b.name)}.</strong> ${truthReason(truth)}</p>`,
    `<table class="cd-table"><thead><tr><th scope="col">Clock</th><th scope="col">${a.name}</th><th scope="col">${b.name}</th><th scope="col">Says</th></tr></thead><tbody>${body}</tbody></table>`,
  ].join("");
}

function truthReason(truth: Order): string {
  if (truth === "concurrent") return "No chain of process steps and messages leads from one to the other.";
  return "A chain of process steps and messages leads from one to the other.";
}

function single(c: Computed, e: Stamped): string {
  const i = c.index.get(e.id)!;
  let past = 0;
  let future = 0;
  let conc = 0;
  for (const other of c.events) {
    if (other.id === e.id) continue;
    const j = c.index.get(other.id)!;
    if (c.past[i].has(j)) past++;
    else if (c.past[j].has(i)) future++;
    else conc++;
  }
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;
  return [
    `<p class="cd-truth"><strong>${e.name}</strong>, a ${kindWord[e.kind]} on P${e.proc + 1}. ${n(past, "event")} happen before it, ${n(future, "event")} after it, and ${n(conc, "event")} ${conc === 1 ? "is" : "are"} concurrent with it.</p>`,
    `<p class="cd-stamps">Lamport ${e.lamport} · vector [${e.vector.join(",")}] · hybrid ${e.hlc.l}.${e.hlc.c} · physical ${e.pt} ms</p>`,
    `<p class="cd-hint">Pick a second event to compare the four clocks.</p>`,
  ].join("");
}

export function readout(state: State, c: Computed = compute(state.diagram)): string {
  const picked = state.selected.map((id) => c.byId.get(id)).filter((e): e is Stamped => Boolean(e));
  if (picked.length === 2) return pairTable(c, picked[0], picked[1]);
  if (picked.length === 1) return single(c, picked[0]);
  return `<p class="cd-hint">Pick an event to see its causal past and future, or two events to compare the clocks.</p>`;
}

export function summary(state: State, c: Computed = compute(state.diagram)): string {
  const ms = messages(state.diagram, c);
  if (!ms.length) return "No messages yet, so every pair of events on different processes is concurrent.";
  const backwards = ms.filter((m) => m.gap < 0).length;
  const ties = ms.filter((m) => m.gap === 0).length;
  const lead = Math.max(0, ...c.events.map(hlcLead));
  const parts = [
    backwards
      ? `Physical clocks stamp ${backwards} of ${ms.length} receives earlier than their sends${ties ? `, and ${ties} the same` : ""}.`
      : ties
        ? `Physical clocks give ${ties} of ${ms.length} messages the same reading at both ends.`
        : `Physical clocks happen to order all ${ms.length} messages correctly.`,
    lead
      ? `The hybrid clock never contradicts causality; it runs at most ${lead} ms ahead of a process's own clock.`
      : "The hybrid clock never contradicts causality and never runs ahead of a process's own clock here.",
  ];
  return parts.join(" ");
}

// ---- The whole figure.

const radio = (name: string, value: string, label: string, checked: boolean) =>
  `<label class="cd-radio"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""} disabled> ${label}</label>`;

const offsetSlider = (p: number, value: number) =>
  `<label class="cd-slider"><span>P${p + 1} clock <output name="off${p}-out">${signed(value)} ms</output></span><input type="range" name="off${p}" min="${-OFFSET_LIMIT}" max="${OFFSET_LIMIT}" step="1" value="${value}" disabled></label>`;

export const offsetLabel = signed;

export interface Props {
  example?: string;
  view?: string;
}

export function render(props: Props): string {
  const view = (props.view && props.view in views ? props.view : "lamport") as View;
  const state = initialState(typeof props.example === "string" ? props.example : "skew", view);
  const c = compute(state.diagram);
  const exampleOptions = Object.entries(examples)
    .map(([key, ex]) => `<option value="${key}"${key === state.example ? " selected" : ""}>${ex.label}</option>`)
    .join("");
  return [
    `<figure class="cd" data-example="${state.example}" data-view="${state.view}">`,
    // A form scopes the radio groups, so two figures on one page don't share them.
    `<form class="cd-controls">`,
    `<fieldset class="cd-group"><legend>Label events with</legend>${(Object.keys(views) as View[]).map((v) => radio("view", v, views[v], v === state.view)).join("")}</fieldset>`,
    `<fieldset class="cd-group"><legend>Clicking a process line</legend>${radio("mode", "select", "selects", true)}${radio("mode", "local", "adds an event", false)}${radio("mode", "message", "sends a message", false)}</fieldset>`,
    `</form>`,
    `<div class="cd-plot" data-part="svg">${svg(state, c)}</div>`,
    `<p class="cd-status" data-part="status" aria-live="polite">${esc(state.status)}</p>`,
    `<div class="cd-readout" data-part="readout" aria-live="polite">${readout(state, c)}</div>`,
    `<fieldset class="cd-sliders"><legend>Physical clock error, relative to true time</legend>${state.diagram.offsets.map((o, p) => offsetSlider(p, o)).join("")}</fieldset>`,
    `<div class="cd-actions"><label class="cd-example">Example <select name="example" disabled>${exampleOptions}</select></label><button type="button" name="delete" disabled>Delete picked event</button><button type="button" name="clear" disabled>Clear</button></div>`,
    `<p class="cd-summary" data-part="summary">${summary(state, c)}</p>`,
    `<figcaption>Every timestamp is computed from the diagram by the rules in this note. Blue events happen before the last event you picked, orange ones after it, and hollow ones are concurrent with it. Physical clocks read whole milliseconds from a base of 100.</figcaption>`,
    `</figure>`,
  ].join("");
}
