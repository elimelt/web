// Markup for the two-phase commit simulator. The build renders the whole
// figure for its starting scenario, so the page shows a complete figure before
// any script runs; the client module redraws the same parts from these
// functions after every event.

import { esc } from "../../shared/format";
import {
  describeNext,
  holdsLocks,
  initial,
  kindLabel,
  linkKey,
  LINKS,
  NODES,
  PARTICIPANTS,
  scenarios,
  status,
  summarize,
  type Msg,
  type NodeId,
  type PId,
  type Sim,
} from "./model";

export interface Props {
  scenario?: unknown;
}

export const W = 360;
export const H = 200;
const R = 22;
const POS: Record<NodeId, [number, number]> = { C: [180, 34], P1: [60, 146], P2: [180, 146], P3: [300, 146] };

export const startScenario = (key: unknown): string => (typeof key === "string" && key in scenarios ? key : "fresh");

/** The state class a node is drawn with. */
export function nodeClass(s: Sim, n: NodeId): string {
  if (!s.up[n]) return "down";
  if (n === "C") return s.c.state === "done" ? "committed-done" : s.c.state;
  const st = status(s, n as PId);
  if (st.kind === "uncertain") return st.blocked ? "uncertain blocked" : "uncertain";
  return st.kind;
}

function nodeWord(s: Sim, n: NodeId): string {
  if (!s.up[n]) return "down";
  if (n === "C") {
    return { idle: "ready", waiting: "collecting votes", committed: "committed", aborted: "aborted", done: "finished" }[s.c.state];
  }
  const st = status(s, n as PId);
  if (st.kind === "uncertain") return st.blocked ? "blocked" : "uncertain";
  return st.kind;
}

function linkPath(a: NodeId, b: NodeId): string {
  const [x1, y1] = POS[a];
  const [x2, y2] = POS[b];
  if (a === "P1" && b === "P3") return `M${x1} ${y1 + R}Q180 ${H + 60} ${x2} ${y2 + R}`;
  return `M${x1} ${y1}L${x2} ${y2}`;
}

/** Where along a link a message label sits: past the middle, toward its destination. */
function labelPoint(m: Msg, slot: number): [number, number] {
  const [x1, y1] = POS[m.from];
  const [x2, y2] = POS[m.to];
  const curved = linkKey(m.from, m.to) === "P1-P3";
  const t = linkKey(m.from, m.to) === "P1-P3" ? 0.68 : 0.6;
  let x = x1 + (x2 - x1) * t;
  let y = y1 + (y2 - y1) * t;
  if (curved) {
    // On the curve under the participants: its middle sits at y = H + 14.
    x = x1 + (x2 - x1) * t;
    y = H + 11;
  }
  // Stack messages that share a directed link; nudge the two directions of
  // a link apart so a request and its reply don't overlap.
  const horizontal = Math.abs(y2 - y1) < 1;
  const dir = NODES.indexOf(m.from) < NODES.indexOf(m.to) ? 1 : -1;
  if (horizontal && !curved) y += dir * 12 + slot * 13 * dir;
  else if (curved) y -= slot * 13;
  else {
    x += dir * 0;
    y += slot * 13;
  }
  return [x, y];
}

export function svg(s: Sim): string {
  const parts: string[] = [];
  parts.push(
    `<defs><marker id="cs-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" class="cs-arrowhead"/></marker></defs>`,
  );
  for (const [a, b] of LINKS) {
    const cut = s.cut.includes(linkKey(a, b));
    const d = linkPath(a, b);
    parts.push(
      `<g class="cs-link${cut ? " cut" : ""}" data-link="${a}-${b}" role="button" tabindex="0" aria-pressed="${cut}" aria-label="${cut ? "Heal" : "Cut"} the link between ${a} and ${b}">` +
        `<path class="cs-link-hit" d="${d}"/><path class="cs-link-line" d="${d}"/>` +
        (cut ? cutMark(a, b) : "") +
        `</g>`,
    );
  }
  // Messages in flight, grouped by directed link so they stack.
  const slots = new Map<string, number>();
  for (const m of s.inFlight) {
    const key = `${m.from}>${m.to}`;
    const slot = slots.get(key) ?? 0;
    slots.set(key, slot + 1);
    const [x, y] = labelPoint(m, slot);
    const text = kindLabel(m.kind);
    const w = text.length * 6.8 + 10;
    parts.push(
      `<g class="cs-msg cs-msg-${m.kind}"><rect x="${(x - w / 2).toFixed(1)}" y="${(y - 8.5).toFixed(1)}" width="${w.toFixed(1)}" height="16" rx="8"/>` +
        `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle">${esc(text)}</text><title>${m.from} → ${m.to} ${esc(text)}</title></g>`,
    );
  }
  for (const n of NODES) {
    const [x, y] = POS[n];
    const cls = nodeClass(s, n);
    const locks = n !== "C" && holdsLocks(s, n as PId);
    parts.push(
      `<g class="cs-node ${cls}"><circle cx="${x}" cy="${y}" r="${R}"/>` +
        `<text class="cs-node-name" x="${x}" y="${y + 1}" text-anchor="middle">${n}</text>` +
        `<text class="cs-node-word" x="${x}" y="${n === "C" ? y - R - 7 : y + R + 15}" text-anchor="middle">${esc(nodeWord(s, n))}${locks ? " · locks" : ""}</text>` +
        `</g>`,
    );
  }
  const label = `Coordinator C above participants P1, P2 and P3. ${NODES.map((n) => `${n} ${nodeWord(s, n)}`).join(", ")}. ${s.inFlight.length} message${s.inFlight.length === 1 ? "" : "s"} in flight. ${s.cut.length ? `Cut links: ${s.cut.join(", ")}.` : ""}`;
  return `<svg class="cs-svg" viewBox="0 -14 ${W} ${H + 46}" role="group" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

function cutMark(a: NodeId, b: NodeId): string {
  const [x1, y1] = POS[a];
  const [x2, y2] = POS[b];
  let x = (x1 + x2) / 2;
  let y = (y1 + y2) / 2;
  if (a === "P1" && b === "P3") y = H + 14;
  if (a === "C") {
    x = x1 + (x2 - x1) * 0.35;
    y = y1 + (y2 - y1) * 0.35;
  }
  return `<path class="cs-cut-mark" d="M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x + 6} ${y - 6}L${x - 6} ${y + 6}"/>`;
}

const ROLE: Record<NodeId, string> = { C: "coordinator", P1: "participant", P2: "participant", P3: "participant" };

function card(s: Sim, n: NodeId): string {
  const up = s.up[n];
  const isPart = n !== "C";
  const p = n as PId;
  let detail = "";
  if (isPart) {
    const st = status(s, p);
    if (st.kind === "uncertain" && st.blocked) detail = `Blocked. Waits for ${st.waitingOn.join(" or ")} to ${st.waitingOn.every((w) => s.up[w]) ? "be reachable" : "come back"}.`;
    else if (st.kind === "uncertain") detail = "Voted yes. Must wait for the decision.";
    else if (st.kind === "down" && st.uncertain) detail = "Will be uncertain when it recovers.";
    else if (st.kind === "working") detail = "Hasn't voted. Can still abort on its own.";
  } else if (up && s.c.state === "waiting") {
    const got = PARTICIPANTS.filter((q) => s.c.votes[q]).map((q) => `${q} ${s.c.votes[q]}`);
    detail = got.length ? `Votes so far: ${got.join(", ")}.` : "No votes yet.";
  }
  const locks = isPart ? (holdsLocks(s, p) ? `<span class="cs-locks on">holds locks</span>` : `<span class="cs-locks">no locks</span>`) : "";
  const log = s.log[n].length
    ? `<ol class="cs-log">${s.log[n].map((r) => `<li>${esc(r.text)}${r.forced ? ` <span class="cs-forced" title="forced to disk before going on">forced</span>` : ""}</li>`).join("")}</ol>`
    : `<p class="cs-log-empty">empty</p>`;
  const voted = isPart && (s.p[p] !== "working" || s.log[p].length > 0);
  const voteNo = isPart
    ? `<label class="cs-voteno"><input type="checkbox" data-voteno="${n}"${s.voteNo.includes(p) ? " checked" : ""}${voted ? " data-locked" : ""} disabled> votes no</label>`
    : "";
  return (
    `<section class="cs-card ${nodeClass(s, n)}" aria-label="${n}">` +
    `<header><strong>${n}</strong> <span class="cs-role">${ROLE[n]}</span> <span class="cs-state">${esc(nodeWord(s, n))}</span></header>` +
    (detail ? `<p class="cs-detail">${esc(detail)}</p>` : "") +
    `<div class="cs-log-head">Log ${locks}</div>${log}` +
    `<div class="cs-card-actions"><button type="button" data-node="${n}" data-act="${up ? "crash" : "recover"}" disabled>${up ? "Crash" : "Recover"}</button>${voteNo}</div>` +
    `</section>`
  );
}

export const cards = (s: Sim): string => NODES.map((n) => card(s, n)).join("");

export function flight(s: Sim): string {
  if (!s.inFlight.length) return `<p class="cs-flight-empty">No messages in flight.</p>`;
  return (
    `<ul>` +
    s.inFlight
      .map(
        (m) =>
          `<li><span class="cs-flight-msg">${m.from} → ${m.to} <strong>${kindLabel(m.kind)}</strong></span>` +
          `<button type="button" data-msg="${m.id}" data-act="deliver" disabled>Deliver</button><button type="button" data-msg="${m.id}" data-act="lose" disabled>Lose</button></li>`,
      )
      .join("") +
    `</ul>`
  );
}

export function history(s: Sim, keep = 5): string {
  const lines = s.history.slice(-keep);
  if (!lines.length) return `<li class="cs-hist-empty">Nothing has happened yet.</li>`;
  return lines.map((l, i) => `<li${i === lines.length - 1 ? ' class="latest"' : ""}>${esc(l)}</li>`).join("");
}

export const counts = (s: Sim): string => `Messages sent: <strong>${s.sent}</strong>. Forced log writes: <strong>${s.forced}</strong>.`;

export function render(props: Props): string {
  const key = startScenario(props.scenario);
  const s = scenarios[key].build();
  const sum = summarize(s);
  const options = Object.entries(scenarios)
    .map(([k, sc]) => `<option value="${k}"${k === key ? " selected" : ""}>${esc(sc.label)}</option>`)
    .join("");
  return [
    `<figure class="cs" data-scenario="${key}">`,
    // A form scopes the controls' names, so two figures on one page stay independent.
    `<form class="cs-controls">`,
    `<label class="cs-scenario">Start from <select name="scenario" disabled>${options}</select></label>`,
    `<label class="cs-coop"><input type="checkbox" name="cooperative"${s.cooperative ? " checked" : ""} disabled> Uncertain participants also ask each other</label>`,
    `</form>`,
    `<div class="cs-bar"><button type="button" name="next" class="cs-primary" disabled>Next</button><button type="button" name="back" disabled>Back</button><button type="button" name="reset" disabled>Reset</button><span class="cs-next" data-part="next">${esc(describeNext(s))}</span></div>`,
    `<p class="cs-headline" data-part="headline" data-tone="${sum.tone}" aria-live="polite">${esc(sum.headline)}</p>`,
    `<div class="cs-plot" data-part="diagram">${svg(s)}</div>`,
    `<div class="cs-flight"><h4>In flight</h4><div data-part="flight">${flight(s)}</div></div>`,
    `<div class="cs-nodes" data-part="nodes">${cards(s)}</div>`,
    `<div class="cs-history"><h4>What just happened</h4><ol data-part="history">${history(s)}</ol></div>`,
    `<p class="cs-counts" data-part="counts">${counts(s)}</p>`,
    `<figcaption>Every state, log record and verdict here comes from the protocol model in the figure's source, which the site's tests check against the atomic commitment rules. Next delivers the oldest message in flight; with nothing in flight, it lets the timers fire. ASK is an uncertain participant asking for the decision, and UNSURE is the reply of one that doesn't know either. Click a link in the diagram to cut or heal it.</figcaption>`,
    `</figure>`,
  ].join("");
}

export { initial };
