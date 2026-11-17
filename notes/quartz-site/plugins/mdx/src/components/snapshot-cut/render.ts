// Markup for the snapshot cut figure. The build renders the whole figure for
// its starting cut; the client redraws the diagram and the readout from the
// same functions as the reader moves the cut.

import { esc } from "../../shared/format";
import { analyzeCut, countConsistent, largestConsistentWithin, vectorClocks, type Cut, type CutState, type Trace } from "./model";
import { trace as recorded } from "./trace";

export const trace: Trace = recorded;
export const PROCS = trace.events.length;

export interface State {
  cut: Cut;
  markers: boolean;
}

export type Start = "naive" | "cl";

export function initialState(start: string): State {
  const which: Start = start === "cl" ? "cl" : "naive";
  return { cut: [...trace.cuts[which].cut], markers: which === "cl" };
}

// ---- Geometry. Events are spaced by their order on the host's monotonic
// clock, not to scale: real gaps range from 3 to 508 microseconds, and to
// scale the closest events would overlap.

export const W = 640;
export const M = { left: 40, right: 14, top: 34, bottom: 34 };
export const ROW = 82;
export const H = M.top + ROW * (PROCS - 1) + M.bottom;
const X0 = M.left + 26;
const X1 = W - M.right - 22;

const knots = [...new Set(trace.events.flat().map((e) => e.t))].sort((a, b) => a - b);
const step = (X1 - X0) / (knots.length - 1);

/** Piecewise-linear map from monotonic time to x, through evenly spaced event times. */
export function xOfT(t: number): number {
  let i = 0;
  while (i < knots.length - 2 && t > knots[i + 1]) i++;
  const span = knots[i + 1] - knots[i];
  const x = X0 + step * (i + (t - knots[i]) / span);
  return Math.max(M.left, Math.min(W - M.right, x));
}

export const yOf = (p: number): number => M.top + p * ROW;
const eventX = (p: number, k: number): number => xOfT(trace.events[p][k - 1].t);

/** x of the gap after the first c events of process p. */
export function gapX(p: number, c: number): number {
  const es = trace.events[p];
  if (es.length === 0) return (X0 + X1) / 2;
  if (c <= 0) return Math.max(M.left + 4, eventX(p, 1) - 11);
  if (c >= es.length) return Math.min(W - M.right - 2, eventX(p, es.length) + 11);
  return (eventX(p, c) + eventX(p, c + 1)) / 2;
}

/** The cut position on process p nearest to x: the number of its events left of x. */
export function cutAtX(p: number, x: number): number {
  return trace.events[p].filter((e) => xOfT(e.t) < x).length;
}

const name = (p: number): string => `P${p + 1}`;
const money = (n: number): string => n.toLocaleString("en-US");
const msgLabel = (i: number): string => {
  const m = trace.messages[i];
  return `${name(m.src)}→${name(m.dst)} ${m.amount}`;
};

function arrow(x1: number, y1: number, x2: number, y2: number, cls: string, label?: string): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const tipX = x2 - ux * 6;
  const tipY = y2 - uy * 6;
  const head = `M${tipX} ${tipY}L${tipX - ux * 8 - uy * 4} ${tipY - uy * 8 + ux * 4}L${tipX - ux * 8 + uy * 4} ${tipY - uy * 8 - ux * 4}Z`;
  const text = label
    ? `<text class="sc-amt" x="${x1 + (x2 - x1) * 0.3 + 4}" y="${y1 + (y2 - y1) * 0.3 + 4}">${label}</text>`
    : "";
  return `<g class="${cls}"><line x1="${x1}" y1="${y1}" x2="${tipX - ux * 5}" y2="${tipY - uy * 5}"/><path d="${head}"/>${text}</g>`;
}

export function svg(state: State, s: CutState = analyzeCut(trace, state.cut)): string {
  const parts: string[] = [];
  const top = M.top - 24;
  const bottom = H - M.bottom + 24;

  // The cut's past, shaded.
  const pts: string[] = [`${M.left},${top}`];
  for (let p = 0; p < PROCS; p++) {
    const x = gapX(p, state.cut[p]);
    pts.push(`${x},${p === 0 ? top : yOf(p) - ROW / 2}`, `${x},${p === PROCS - 1 ? bottom : yOf(p) + ROW / 2}`);
  }
  pts.push(`${M.left},${bottom}`);
  parts.push(`<polygon class="sc-past" points="${pts.join(" ")}"/>`);

  for (let p = 0; p < PROCS; p++) {
    const y = yOf(p);
    parts.push(
      `<line class="sc-proc" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`,
      `<text class="sc-pname" x="6" y="${y + 4}">${name(p)}</text>`,
      `<rect class="sc-band" data-proc="${p}" x="${M.left}" y="${y - ROW / 2 + 4}" width="${W - M.left - M.right}" height="${ROW - 8}"/>`,
    );
  }

  const orphan = new Set(s.orphans);
  const flying = new Set(s.inflight);
  trace.messages.forEach((m, i) => {
    const x1 = m.from ? eventX(m.from[0], m.from[1]) : M.left;
    const y1 = yOf(m.from ? m.from[0] : m.src);
    const x2 = m.to ? eventX(m.to[0], m.to[1]) : W - M.right;
    const y2 = yOf(m.to ? m.to[0] : m.dst);
    const cls = `sc-msg${orphan.has(i) ? " sc-orphan" : flying.has(i) ? " sc-flight" : ""}${m.from ? "" : " sc-stub"}`;
    parts.push(arrow(x1, y1, x2, y2, cls, String(m.amount)));
  });

  if (state.markers) {
    for (const mk of trace.markers) {
      parts.push(arrow(xOfT(mk.tFrom), yOf(mk.from[0]), xOfT(mk.tTo), yOf(mk.to[0]), "sc-marker"));
    }
  }

  for (let p = 0; p < PROCS; p++) {
    trace.events[p].forEach((e, k) => {
      const inside = k < state.cut[p];
      parts.push(
        `<circle class="sc-ev sc-${e.kind}${inside ? " sc-in" : ""}" cx="${xOfT(e.t)}" cy="${yOf(p)}" r="4.5"><title>${e.kind === "send" ? "send" : "receive"} ${esc(msgLabel(e.msg))} at ${e.t} µs</title></circle>`,
      );
    });
  }

  // The cut line and one handle per process.
  const line: string[] = [];
  for (let p = 0; p < PROCS; p++) {
    const x = gapX(p, state.cut[p]);
    line.push(`${x},${p === 0 ? top : yOf(p) - ROW / 2}`, `${x},${p === PROCS - 1 ? bottom : yOf(p) + ROW / 2}`);
  }
  parts.push(`<polyline class="sc-cut${s.consistent ? "" : " sc-bad"}" points="${line.join(" ")}"/>`);
  for (let p = 0; p < PROCS; p++) {
    const x = gapX(p, state.cut[p]);
    const n = trace.events[p].length;
    parts.push(
      `<g class="sc-handle" data-proc="${p}" tabindex="0" role="slider" aria-label="Cut on ${name(p)}: events included" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${state.cut[p]}">`,
      `<rect class="sc-hit" x="${x - 12}" y="${yOf(p) - 18}" width="24" height="36"/>`,
      `<rect class="sc-knob" x="${x - 4}" y="${yOf(p) - 13}" width="8" height="26" rx="3"/>`,
      `</g>`,
    );
  }

  const label = `Space-time diagram of ${PROCS} processes over ${Math.round(knots[knots.length - 1])} microseconds of a recorded run, with a cut that includes ${state.cut.join(", ")} events of each process.`;
  return `<svg class="sc-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

const vc = vectorClocks(trace);
const sameCut = (a: Cut, b: Cut) => a.every((x, i) => x === b[i]);

export function readout(state: State, s: CutState = analyzeCut(trace, state.cut)): string {
  const out: string[] = [];
  if (s.consistent) {
    out.push(`<p class="sc-verdict" data-tone="good"><strong>Consistent.</strong> Every transfer received inside the cut was also sent inside it.</p>`);
  } else {
    const which = s.orphans
      .map((i) => {
        const m = trace.messages[i];
        return `${name(m.dst)} has received ${m.amount} from ${name(m.src)}, but the cut does not include ${name(m.src)} sending it`;
      })
      .join("; ");
    out.push(`<p class="sc-verdict" data-tone="bad"><strong>Inconsistent.</strong> ${which}.</p>`);
  }

  const rows = s.balances
    .map((b, p) => `<tr><th scope="row">${name(p)}</th><td>${state.cut[p]} of ${trace.events[p].length}</td><td>${money(b)}</td><td>[${vc[p][state.cut[p]].join(", ")}]</td></tr>`)
    .join("");
  out.push(
    `<table class="sc-table"><thead><tr><th scope="col">Process</th><th scope="col">Events in cut</th><th scope="col">Balance</th><th scope="col">Frontier clock</th></tr></thead><tbody>${rows}</tbody></table>`,
  );

  const chan = s.inflight.length ? s.inflight.map(msgLabel).join(", ") : "nothing";
  let chanNote = "";
  if (sameCut(state.cut, trace.cuts.cl.cut)) {
    chanNote = " These are exactly the transfers the processes recorded on their incoming channels between recording their balances and receiving each channel's marker.";
  } else if (sameCut(state.cut, trace.cuts.naive.cut)) {
    chanNote = " The uncoordinated snapshot recorded no channel state, so its own total was the balances alone.";
  }
  out.push(`<p class="sc-line">In flight across the cut: ${chan}.${chanNote}</p>`);

  const counted = s.balanceSum + s.inflightSum;
  const sum = `Balances ${money(s.balanceSum)} + in flight ${money(s.inflightSum)} = ${money(counted)}`;
  out.push(
    s.consistent
      ? `<p class="sc-line">${sum}, the ${money(trace.total)} the system holds.</p>`
      : `<p class="sc-line">${sum}, ${money(counted - trace.total)} more than the ${money(trace.total)} the system holds: each orphaned transfer is counted at its receiver and still at its sender.</p>`,
  );
  return out.join("");
}

const button = (nameAttr: string, text: string, pressed: boolean) =>
  `<button type="button" name="${nameAttr}" aria-pressed="${pressed}" disabled>${text}</button>`;

export function controls(state: State): string {
  const fixed = largestConsistentWithin(trace, state.cut);
  return [
    button("naive", "Uncoordinated snapshot", sameCut(state.cut, trace.cuts.naive.cut)),
    button("cl", "Chandy–Lamport snapshot", sameCut(state.cut, trace.cuts.cl.cut)),
    `<button type="button" name="fix"${sameCut(fixed, state.cut) ? " data-idle" : ""} disabled>Largest consistent cut inside</button>`,
  ].join("");
}

const consistentCount = countConsistent(trace);

export interface Props {
  start?: string;
}

export function render(props: Props): string {
  const state = initialState(typeof props.start === "string" ? props.start : "naive");
  const s = analyzeCut(trace, state.cut);
  const src = trace.source;
  return [
    `<figure class="sc" data-start="${state.markers ? "cl" : "naive"}">`,
    `<div class="sc-actions" data-part="buttons">${controls(state)}</div>`,
    `<label class="sc-check"><input type="checkbox" name="markers"${state.markers ? " checked" : ""} disabled> Show the Chandy–Lamport markers</label>`,
    `<div class="sc-plot" data-part="svg">${svg(state, s)}</div>`,
    `<div class="sc-readout" data-part="readout" aria-live="polite">${readout(state, s)}</div>`,
    `<p class="sc-summary">${consistentCount} of this window's ${trace.allCuts} cuts are consistent.</p>`,
    `<figcaption>A ${(knots[knots.length - 1] / 1000).toFixed(1)} ms window of a recorded run: ${PROCS} processes on one host transferring money over TCP at about ${money(src.rate)} transfers per second each. Drag a handle, click a process line, or use the arrow keys on a handle to move the cut. Red arrows are received inside the cut but sent outside it; orange arrows are in flight across it; dashed purple arrows are markers. Events are spaced by their order, not to scale, and the clocks count only events inside the window.</figcaption>`,
    `</figure>`,
  ].join("");
}
