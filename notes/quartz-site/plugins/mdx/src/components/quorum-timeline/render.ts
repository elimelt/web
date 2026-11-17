// Markup for the quorum timeline: a space-time diagram of one request, the
// numbers it implies, and the etcd measurement for the same setting.

import { esc } from "../../shared/format";
import {
  members,
  measured,
  OP_LABEL,
  OPS,
  PRESETS,
  presetKey,
  rtt,
  simulate,
  type Msg,
  type Outcome,
  type Preset,
  type Setting,
} from "./model";

export interface Props {
  preset?: unknown;
}

export const W = 600;
/** Width of the diagram's coordinate system when the figure is narrower than this many pixels. */
export const NARROW_PX = 520;
export const W_NARROW = 400;
const RIGHT = 16;
const TOP = 14;
const LANE = 38;
const BOTTOM = 36;

const height = (n: number): number => TOP + LANE * (n - 1) + 18 + BOTTOM;
const laneY = (m: number): number => TOP + 8 + LANE * m;

/** A round axis end and its tick step, in ms. */
export function axis(maxT: number): { end: number; step: number } {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100];
  const target = Math.max(maxT * 1.06, 1);
  for (const step of steps) {
    const end = Math.ceil(target / step) * step;
    if (end / step <= 6) return { end, step };
  }
  return { end: Math.ceil(target / 100) * 100, step: 100 };
}

/** A line with a filled arrowhead drawn as a polygon, so no SVG ids are needed. */
function arrow(x0: number, y0: number, x1: number, y1: number): string {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const h = Math.min(7, len * 0.45);
  const bx = x1 - ux * h;
  const by = y1 - uy * h;
  const px = -uy * 3;
  const py = ux * 3;
  const f = (v: number) => v.toFixed(1);
  return (
    `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(bx)}" y2="${f(by)}"/>` +
    `<polygon points="${f(x1)},${f(y1)} ${f(bx + px)},${f(by + py)} ${f(bx - px)},${f(by - py)}"/>`
  );
}

export const fmtMs = (v: number): string => (v >= 10 ? `${v.toFixed(1)} ms` : `${v.toFixed(2)} ms`);

function lastTime(o: Outcome): number {
  let t = o.done ?? 0;
  for (const m of o.msgs) t = Math.max(t, m.t1);
  for (const d of o.disks) t = Math.max(t, d.t1);
  return t;
}

const memberLabel = (s: Setting, m: number): string =>
  m === 0 ? "m0 leader" : s.down[m - 1] ? `m${m} down` : `m${m}, ${rtt(s, m)} ms`;

export function chart(s: Setting, W_: number = W): string {
  const W = W_;
  const LABEL_W = W < 500 ? 82 : 96;
  const o = simulate(s);
  const n = members(s);
  const H = height(n);
  const { end, step } = axis(lastTime(o));
  const x = (t: number): number => LABEL_W + (t / end) * (W - LABEL_W - RIGHT);
  const f1 = (v: number): string => v.toFixed(1);
  const out: string[] = [
    `<svg viewBox="0 0 ${W} ${H}" class="qt-chart" role="img" aria-label="Space-time diagram of one ${esc(OP_LABEL[s.op])}: one row per member, time in milliseconds to the right, arrows for messages">`,
  ];
  const axisY = laneY(n - 1) + 18;
  for (let t = 0; t <= end + 1e-9; t += step) {
    const xx = f1(x(t));
    out.push(`<line class="qt-grid" x1="${xx}" x2="${xx}" y1="${TOP}" y2="${axisY}"/>`);
    out.push(`<text class="qt-tick" x="${xx}" y="${axisY + 15}" text-anchor="middle">${+t.toFixed(2)}</text>`);
  }
  out.push(`<text class="qt-axis" x="${f1(x(end))}" y="${axisY + 31}" text-anchor="end">ms after the client's request</text>`);
  for (let m = 0; m < n; m++) {
    const y = laneY(m);
    const down = m > 0 && s.down[m - 1];
    out.push(`<line class="qt-lane${down ? " qt-down" : ""}${m === s.via ? " qt-via" : ""}" x1="${LABEL_W}" x2="${W - RIGHT}" y1="${y}" y2="${y}"/>`);
    out.push(`<text class="qt-label${down ? " qt-down" : ""}" x="${LABEL_W - 8}" y="${y + 4}" text-anchor="end">${esc(memberLabel(s, m))}</text>`);
  }
  for (const d of o.disks) {
    const w = Math.max(x(d.t1) - x(d.t0), 2);
    out.push(`<rect class="qt-disk" x="${f1(x(d.t0))}" y="${laneY(d.member) - 4}" width="${f1(w)}" height="8"/>`);
  }
  const late = (m: Msg): boolean =>
    (m.kind === "ack" || m.kind === "hbAck") && (o.decided === null || !o.quorum.includes(m.from));
  for (const m of o.msgs) {
    const cls = `qt-msg qt-${m.kind}${late(m) ? " qt-late" : ""}`;
    out.push(`<g class="${cls}">${arrow(x(m.t0), laneY(m.from), x(m.t1), laneY(m.to))}</g>`);
  }
  if (o.decided !== null && s.op !== "get-serializable") {
    const xx = f1(x(o.decided));
    out.push(`<line class="qt-decided" x1="${xx}" x2="${xx}" y1="${TOP - 6}" y2="${axisY}"/>`);
    out.push(`<circle class="qt-decided-dot" cx="${xx}" cy="${laneY(0)}" r="4"/>`);
  }
  if (o.done !== null) {
    out.push(`<circle class="qt-done" cx="${f1(x(o.done))}" cy="${laneY(s.via)}" r="5"/>`);
  }
  out.push(`</svg>`);
  return out.join("");
}

export function legend(s: Setting): string {
  const items =
    s.op === "put"
      ? [
          ["qt-key-append", "entry sent"],
          ["qt-key-ack", "acknowledgement in the quorum"],
          ["qt-key-late", "later acknowledgement"],
          ["qt-key-disk", "WAL fsync"],
        ]
      : s.op === "get-linearizable"
        ? [
            ["qt-key-append", "heartbeat"],
            ["qt-key-ack", "reply in the quorum"],
            ["qt-key-late", "later reply"],
          ]
        : [];
  if (s.via !== 0 && s.op !== "get-serializable") items.push(["qt-key-fwd", "forwarded request, outcome to the follower"]);
  const end = [["qt-key-decided", s.op === "put" ? "commit" : "leadership confirmed"], ["qt-key-done", "answer to the client"]];
  const all = s.op === "get-serializable" ? [["qt-key-done", "answer to the client"]] : [...items, ...end];
  return all.map(([c, t]) => `<li><span class="qt-key ${c}"></span>${esc(t)}</li>`).join("");
}

export function readout(s: Setting): string {
  const o = simulate(s);
  const n = members(s);
  const live = s.down.filter((d) => !d).length;
  const parts: string[] = [];
  if (s.op === "get-serializable") {
    parts.push(
      `<p>m${s.via} answers from its own applied state with no messages, so the read can return a value older than the latest committed write. Model: <b>${fmtMs(o.done!)}</b>.</p>`,
    );
  } else if (o.decided === null) {
    parts.push(
      `<p>${live} of ${n - 1} followers are up, fewer than the ${o.need} a quorum of ${o.need + 1} needs, so the ${esc(OP_LABEL[s.op])} cannot complete. etcd keeps the request pending until the client's deadline expires.</p>`,
    );
  } else {
    const names = o.quorum.map((m) => `m${m}`).join(" and ");
    const what =
      s.op === "put"
        ? `The write commits when the leader and ${o.need} of the ${n - 1} followers have it on disk${names ? `: here ${names}, the nearest ${o.quorum.length > 1 ? "followers that are" : "follower that is"} up` : ""}.`
        : `The leader confirms that it is still leader when ${o.need} of the ${n - 1} followers have answered a heartbeat${names ? `: here ${names}` : ""}. No fsync is needed.`;
    const fwd = s.via !== 0 ? ` m${s.via} forwards the request to the leader and answers after it learns the outcome, which adds its own round trip of ${rtt(s, s.via)} ms.` : "";
    parts.push(
      `<p>${what}${fwd} Model: ${s.op === "put" ? "commit" : "confirmed"} at <b>${fmtMs(o.decided)}</b>, answer at <b>${fmtMs(o.done!)}</b>.</p>`,
    );
  }
  const m = measured(s);
  parts.push(
    m
      ? `<p class="qt-measured">etcd 3.6, same setting: median <b>${fmtMs(m.p50)}</b> (medians of the three clusters ${m.lo.toFixed(2)} to ${m.hi.toFixed(2)} ms; 99th percentile ${fmtMs(m.p99)}; ${m.n.toLocaleString("en-US")} requests).</p>`
      : `<p class="qt-measured">This combination was not measured.</p>`,
  );
  return parts.join("");
}

const pressed = (on: boolean): string => `aria-pressed="${on}"`;

export function controls(p: Preset, s: Setting): string {
  if (p.controls === "fail") {
    const buttons = s.rtts
      .map((r, i) => `<button type="button" name="down" value="${i + 1}" ${pressed(s.down[i])} disabled>m${i + 1}, ${r} ms</button>`)
      .join("");
    return `<div class="qt-row"><span class="qt-row-label">Stop a follower</span><span class="qt-buttons">${buttons}</span></div>`;
  }
  if (p.controls === "via") {
    const buttons = Array.from({ length: members(s) }, (_, m) =>
      `<button type="button" name="via" value="${m}" ${pressed(s.via === m)} disabled>m${m}${m === 0 ? " (leader)" : `, ${rtt(s, m)} ms`}</button>`,
    ).join("");
    return `<div class="qt-row"><span class="qt-row-label">Client sends to</span><span class="qt-buttons">${buttons}</span></div>`;
  }
  const choices = p.rttChoices!;
  const idx = Math.max(0, choices.indexOf(s.rtts[0]));
  const ops = OPS.map((op) => `<button type="button" name="op" value="${op}" ${pressed(s.op === op)} disabled>${esc(OP_LABEL[op])}</button>`).join("");
  return (
    `<div class="qt-row"><span class="qt-row-label">Request</span><span class="qt-buttons">${ops}</span></div>` +
    `<label class="qt-slider"><span>Round trip from the leader to each follower <output name="rtt-out">${choices[idx]} ms</output></span>` +
    `<input type="range" name="rtt" min="0" max="${choices.length - 1}" step="1" value="${idx}" disabled></label>`
  );
}

export const CAPTION =
  "Timing model, not a trace: messages travel half the round trip each way, every fsync takes the mean leader WAL fsync measured in the runs with no added delay, and a fixed per-request overhead fitted to those same runs is added at the end. The model is tested against every etcd measurement in the note.";

export function body(p: Preset, s: Setting): string {
  return (
    `<form class="qt-controls">${controls(p, s)}</form>` +
    `<div class="qt-plot" data-part="plot">${chart(s)}</div>` +
    `<ul class="qt-legend" data-part="legend">${legend(s)}</ul>` +
    `<div class="qt-readout" data-part="readout" aria-live="polite">${readout(s)}</div>`
  );
}

export function render(props: Props): string {
  const key = presetKey(props.preset);
  const p = PRESETS[key];
  const s = p.setting;
  return `<figure class="qt" data-preset="${key}">${body(p, s)}<figcaption>${esc(CAPTION)}</figcaption></figure>`;
}
