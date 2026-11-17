// Markup for the Paxos stepper. The build renders the whole figure for its
// preset, so the page shows a complete figure before any script runs; the
// client module redraws the same parts from these functions after each step.

import { esc } from "../../shared/format";
import {
  ACCEPTORS,
  chosenValues,
  describeNext,
  kindLabel,
  presets,
  PROPOSERS,
  startPreset,
  summarize,
  type AId,
  type Msg,
  type NodeId,
  type PId,
  type Sim,
} from "./model";

export interface Props {
  preset?: unknown;
}

const W = 360;
const H = 214;
const PBOX = { w: 132, h: 52 };
const ABOX = { w: 104, h: 52 };
const PPOS: Record<PId, [number, number]> = { P1: [24, 8], P2: [204, 8] };
const APOS: Record<AId, [number, number]> = { A1: [4, 152], A2: [128, 152], A3: [252, 152] };

/** Where a link meets a node: bottom middle of a proposer, top middle of an acceptor. */
function anchor(n: NodeId): [number, number] {
  if (n === "P1" || n === "P2") {
    const [x, y] = PPOS[n];
    return [x + PBOX.w / 2, y + PBOX.h];
  }
  const [x, y] = APOS[n as AId];
  return [x + ABOX.w / 2, y];
}

const phaseWord = (s: Sim, p: PId): string => {
  const pr = s.prop[p];
  if (pr.crashed) return "crashed";
  switch (pr.phase) {
    case "idle":
      return "idle";
    case "preparing":
      return `promises ${Object.keys(pr.promises).length} of 2`;
    case "accepting":
      return `accepted by ${pr.acks.length} of 2`;
    case "learned":
      return `learned ${pr.value}`;
  }
};

function proposerBox(s: Sim, p: PId): string {
  const pr = s.prop[p];
  const [x, y] = PPOS[p];
  const cls = pr.crashed ? "down" : pr.phase;
  const line3 = pr.value ? `proposes ${pr.value}` : `own value ${pr.own}`;
  return (
    `<g class="px-node px-prop ${cls}"><rect x="${x}" y="${y}" width="${PBOX.w}" height="${PBOX.h}" rx="6"/>` +
    `<text class="px-name" x="${x + 8}" y="${y + 16}">${p}<tspan class="px-dim"> · ${pr.n ? `round ${pr.n}` : "no round"}</tspan></text>` +
    `<text x="${x + 8}" y="${y + 31}">${esc(phaseWord(s, p))}</text>` +
    `<text class="px-dim" x="${x + 8}" y="${y + 45}">${esc(line3)}</text></g>`
  );
}

function acceptorBox(s: Sim, a: AId, chosen: Set<string>): string {
  const ac = s.acc[a];
  const [x, y] = APOS[a];
  const v = ac.accepted?.v;
  return (
    `<g class="px-node px-acc${v && chosen.has(v) ? " holds-chosen" : ""}"><rect x="${x}" y="${y}" width="${ABOX.w}" height="${ABOX.h}" rx="6"/>` +
    `<text class="px-name" x="${x + 8}" y="${y + 16}">${a}</text>` +
    `<text x="${x + 8}" y="${y + 31}">promised ${ac.promised || "–"}</text>` +
    `<text x="${x + 8}" y="${y + 45}">accepted ${ac.accepted ? `${ac.accepted.v}@${ac.accepted.n}` : "–"}</text></g>`
  );
}

/** Messages waiting on a link, drawn as dots near the receiving end. */
function dots(s: Sim): string {
  const groups = new Map<string, Msg[]>();
  for (const m of s.inFlight) {
    const k = `${m.from}>${m.to}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const out: string[] = [];
  for (const ms of groups.values()) {
    const [x1, y1] = anchor(ms[0].from);
    const [x2, y2] = anchor(ms[0].to);
    ms.forEach((m, i) => {
      const t = 0.62 - i * 0.1;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      out.push(`<circle class="px-dot k-${m.kind}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"><title>${m.from} → ${m.to} ${esc(kindLabel(m))}</title></circle>`);
    });
  }
  return out.join("");
}

function lastArrow(s: Sim): string {
  if (!s.last) return "";
  const [x1, y1] = anchor(s.last.from);
  const [x2, y2] = anchor(s.last.to);
  // Stop short of the box so the arrowhead stays visible.
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ex = x2 - ((x2 - x1) / len) * 3;
  const ey = y2 - ((y2 - y1) / len) * 3;
  return `<line class="px-last k-${s.last.kind} ${s.last.outcome}" x1="${x1}" y1="${y1}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" marker-end="url(#px-arrow-${s.last.kind})"/>`;
}

export function svg(s: Sim): string {
  const chosen = new Set(chosenValues(s));
  const parts: string[] = [];
  parts.push(
    `<defs>${["prepare", "promise", "accept", "accepted"]
      .map((k) => `<marker id="px-arrow-${k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8Z" class="px-head k-${k}"/></marker>`)
      .join("")}</defs>`,
  );
  for (const p of PROPOSERS)
    for (const a of ACCEPTORS) {
      const [x1, y1] = anchor(p);
      const [x2, y2] = anchor(a);
      parts.push(`<line class="px-link" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    }
  parts.push(lastArrow(s), dots(s));
  for (const p of PROPOSERS) parts.push(proposerBox(s, p));
  for (const a of ACCEPTORS) parts.push(acceptorBox(s, a, chosen));
  const label =
    `Proposers P1 and P2 above acceptors A1, A2 and A3. ` +
    PROPOSERS.map((p) => `${p} ${s.prop[p].n ? `round ${s.prop[p].n}` : "no round"}, ${phaseWord(s, p)}`).join("; ") +
    ". " +
    ACCEPTORS.map((a) => `${a} promised ${s.acc[a].promised || "nothing"}, accepted ${s.acc[a].accepted ? `${s.acc[a].accepted!.v} in round ${s.acc[a].accepted!.n}` : "nothing"}`).join("; ") +
    `. ${s.inFlight.length} message${s.inFlight.length === 1 ? "" : "s"} in flight.`;
  return `<svg class="px-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

export function flight(s: Sim): string {
  if (!s.inFlight.length) return `<p class="px-empty">No messages in flight.</p>`;
  return (
    `<ul>` +
    s.inFlight
      .map(
        (m) =>
          `<li><span class="px-tag k-${m.kind}"></span><span class="px-msg">${m.from} → ${m.to} ${esc(kindLabel(m))}</span>` +
          `<button type="button" data-msg="${m.id}" data-act="deliver" disabled>Deliver</button><button type="button" data-msg="${m.id}" data-act="drop" disabled>Lose</button></li>`,
      )
      .join("") +
    `</ul>`
  );
}

export function procButtons(s: Sim): string {
  return PROPOSERS.map((p) => {
    const pr = s.prop[p];
    return (
      `<span class="px-proc"><button type="button" data-p="${p}" data-act="start"${pr.crashed ? " data-locked" : ""} disabled>${p}: new round</button>` +
      `<button type="button" data-p="${p}" data-act="${pr.crashed ? "recover" : "crash"}" disabled>${p}: ${pr.crashed ? "recover" : "crash"}</button></span>`
    );
  }).join("");
}

export function history(s: Sim, keep = 4): string {
  const lines = s.history.slice(-keep);
  if (!lines.length) return `<li>Nothing has happened yet.</li>`;
  return lines.map((l, i) => `<li${i === lines.length - 1 ? ' class="latest"' : ""}>${esc(l)}</li>`).join("");
}

export const counts = (s: Sim): string => `Messages sent: <strong>${s.sent}</strong>`;

const CAPTION: Record<string, string> = {
  basic: "One proposer runs both phases with three acceptors. Next delivers the oldest message in flight.",
  takeover:
    "P1 gets x accepted by A1 and A2, so x is chosen, then crashes before anyone learns it. P2 starts round 2 and reaches A2 and A3. Untick the box to let P2 propose its own value regardless of what the promises report.",
  duel: "Next follows an adversarial schedule: whenever one proposer's accept requests could succeed, the other proposer's timer fires and its prepare requests arrive first. No message is lost and no process crashes.",
};

export function render(props: Props): string {
  const key = startPreset(props.preset);
  const s = presets[key].build(true);
  const sum = summarize(s);
  return [
    `<figure class="px" data-preset="${key}">`,
    key === "takeover"
      ? `<form class="px-controls"><label><input type="checkbox" name="adopt" checked disabled> P2 proposes the highest-numbered value its promises report (the Paxos rule)</label></form>`
      : "",
    `<div class="px-bar"><button type="button" name="next" class="px-primary" disabled>Next</button><button type="button" name="back" disabled>Back</button><button type="button" name="reset" disabled>Reset</button><span class="px-next" data-part="next">${esc(describeNext(s))}</span></div>`,
    `<p class="px-headline" data-part="headline" data-tone="${sum.tone}" aria-live="polite">${esc(sum.headline)}</p>`,
    `<div class="px-plot" data-part="diagram">${svg(s)}</div>`,
    `<div class="px-legend"><span><i class="k-prepare"></i>prepare</span><span><i class="k-promise"></i>promise</span><span><i class="k-accept"></i>accept</span><span><i class="k-accepted"></i>accepted</span></div>`,
    `<div class="px-history"><ol data-part="history">${history(s)}</ol></div>`,
    `<details class="px-more"><summary>Deliver or lose messages yourself</summary>`,
    `<div class="px-flight" data-part="flight">${flight(s)}</div>`,
    `<div class="px-procs" data-part="procs">${procButtons(s)}</div>`,
    `</details>`,
    `<p class="px-counts" data-part="counts">${counts(s)}</p>`,
    `<figcaption>${esc(CAPTION[key])} The protocol runs in the browser: every state and the chosen value are computed by the model in the figure's source, which the site's tests check against an exhaustive search. Dots on a link are messages in flight; the arrow is the last message delivered.</figcaption>`,
    `</figure>`,
  ].join("");
}
