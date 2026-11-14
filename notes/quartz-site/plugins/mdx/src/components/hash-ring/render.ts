// Markup for the hash ring figure. Each copy on the page is one scenario with
// at most two controls; render draws the scenario's starting state and the
// client redraws the same parts after each action.

import { esc } from "../../shared/format";
import { initial, NAMES, POINT_STEPS, scenarioKey, view, type ScenarioKey, type View } from "./model";

interface Props {
  scenario?: string;
  seed?: number;
}

const SIZE = 280;
const C = SIZE / 2;
const R = 112;
const TAU = Math.PI * 2;

/** Angle for a ring fraction, clockwise from twelve o'clock. */
const at = (t: number, r: number): [number, number] => {
  const a = t * TAU - Math.PI / 2;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};

const f = (x: number): string => x.toFixed(2);

function arcPath(from: number, to: number, r: number): string {
  if (to - from >= 0.99999) {
    const [x0, y0] = at(from, r);
    const [x1, y1] = at(from + 0.5, r);
    return `M${f(x0)} ${f(y0)}A${r} ${r} 0 1 1 ${f(x1)} ${f(y1)}A${r} ${r} 0 1 1 ${f(x0)} ${f(y0)}`;
  }
  const [x0, y0] = at(from, r);
  const [x1, y1] = at(to, r);
  return `M${f(x0)} ${f(y0)}A${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`;
}

const cls = (server: number): string => `hr-s${server}`;

export function ringSvg(v: View): string {
  const parts: string[] = [];
  parts.push(`<circle class="hr-track" cx="${C}" cy="${C}" r="${R}"/>`);
  for (const a of v.arcs) parts.push(`<path class="hr-arc ${cls(a.server)}" d="${arcPath(a.from, a.to, R)}"/>`);
  if (v.table) {
    // Entry boundaries and numbers.
    const n = v.owners.length;
    for (let e = 0; e < n; e++) {
      const [x0, y0] = at(e / n, R - 9);
      const [x1, y1] = at(e / n, R + 9);
      parts.push(`<line class="hr-tick" x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}"/>`);
      const [tx, ty] = at((e + 0.5) / n, R + 19);
      const moved = v.movedEntries.includes(e);
      parts.push(`<text class="hr-entry${moved ? " hr-moved-text" : ""}" x="${f(tx)}" y="${f(ty)}">${e}</text>`);
    }
  } else {
    // Past about a hundred points the ticks would cover the arcs, so the
    // colors alone show the cut.
    const few = v.points.length <= 12;
    for (const p of v.points.length <= 120 ? v.points : []) {
      const t = p.pos / 2 ** 32;
      const [x0, y0] = at(t, R - 10);
      const [x1, y1] = at(t, R + 10);
      parts.push(`<line class="hr-point ${cls(p.server)}" x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}"/>`);
      if (few) {
        const [tx, ty] = at(t, R + 22);
        parts.push(`<text class="hr-name ${cls(p.server)}" x="${f(tx)}" y="${f(ty)}">${NAMES[p.server]}</text>`);
      }
    }
  }
  const maxReq = Math.max(1, ...v.dots.map((d) => d.requests));
  for (const d of v.dots) {
    const [x, y] = at(d.pos / 2 ** 32, R - 22);
    const r = d.requests ? 2 + 9 * Math.sqrt(d.requests / maxReq) : 3;
    if (d.moved) parts.push(`<circle class="hr-halo" cx="${f(x)}" cy="${f(y)}" r="${f(r + 3)}"/>`);
    parts.push(`<circle class="hr-key ${cls(d.server)}" cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`);
  }
  return `<svg class="hr-ring" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${esc(v.label)}">${parts.join("")}</svg>`;
}

export function barsHtml(v: View): string {
  const fair = 1 / v.servers;
  const max = Math.max(fair * 1.15, ...v.bars.map((b) => b.share));
  const rows = v.bars
    .map(
      (b) => `<div class="hr-bar-row"><span class="hr-bar-name ${cls(b.server)}">${NAMES[b.server]}</span><span class="hr-bar-track"><span class="hr-bar ${cls(b.server)}" style="width:${((b.share / max) * 100).toFixed(1)}%"></span><span class="hr-fair" style="left:${((fair / max) * 100).toFixed(1)}%"></span></span><span class="hr-bar-detail">${esc(b.detail)}</span></div>`,
    )
    .join("");
  return `${rows}<p class="hr-bar-key"><span class="hr-fair-key"></span> fair share</p>`;
}

export function stripHtml(v: View): string {
  if (!v.table) return "";
  const cells = v.owners
    .map((o, e) => `<span class="hr-cell ${cls(o)}${v.movedEntries.includes(e) ? " hr-cell-moved" : ""}" title="entry ${e} → ${NAMES[o]}"><small>${e}</small>${NAMES[o]}</span>`)
    .join("");
  return `<span class="hr-strip-label">Table</span><span class="hr-cells">${cells}</span>`;
}

function controls(scenario: ScenarioKey, points: number): string {
  switch (scenario) {
    case "placement":
      return `<button type="button" name="reseed" disabled>Place servers again</button>`;
    case "points": {
      const i = POINT_STEPS.indexOf(points);
      return `<label class="hr-slider"><span>Points per server <output name="points-out">${points}</output></span><input type="range" name="points" min="0" max="${POINT_STEPS.length - 1}" step="1" value="${i}" disabled></label>`;
    }
    case "add":
    case "add-points":
    case "table-add":
      return `<button type="button" name="add" aria-pressed="false" disabled>Add server F</button>`;
    case "hot":
      return `<button type="button" name="move" disabled>Move one entry</button><button type="button" name="reset" disabled>Reset</button>`;
  }
}

const CAPTIONS: Record<ScenarioKey, string> = {
  placement:
    "Five servers, one point each, placed by hashing the server's name. The ring's colored arcs show who owns what; each dot is a key from a Twitter cache trace, colored by the server that owns it. Bars compare each server's share of the ring with a fair fifth.",
  points:
    "The same five servers, now hashed onto the ring several times each. Every arc still belongs to the next point clockwise, so more points cut the ring into more, smaller arcs, and each server's total comes closer to a fifth.",
  add: "Five servers with one point each. Adding F puts one new point on the ring; keys with a halo moved.",
  "add-points": "The same five servers with 16 points each. Adding F puts 16 new points on the ring; keys with a halo moved.",
  "table-add":
    "An indirection table of 20 entries over the same hash space. Each slice of the ring is one entry, and the strip below is the table every client holds. Adding F reassigns whole entries; keys with a halo moved.",
  hot: "The same 20-entry table, with dots for the 24 most requested keys in the trace, sized by request count. Bars show each server's share of all requests in the trace. Each press moves the one entry that best evens out the busiest and idlest servers.",
};

export function render(props: Props = {}): string {
  const scenario = scenarioKey(props.scenario);
  const state = initial(scenario, Number(props.seed ?? 0) || 0);
  const v = view(state);
  return `<figure class="hr" data-scenario="${scenario}" data-seed="${state.seed}">
<div class="hr-body">
<div class="hr-left" data-part="ring">${ringSvg(v)}</div>
<div class="hr-right">
<div class="hr-controls">${controls(scenario, state.points)}</div>
<div class="hr-bars" data-part="bars">${barsHtml(v)}</div>
<p class="hr-readout" data-part="readout" aria-live="polite">${esc(v.readout)}</p>
</div>
</div>
<div class="hr-strip" data-part="strip"${v.table ? "" : " hidden"}>${stripHtml(v)}</div>
<figcaption>${esc(CAPTIONS[scenario])}</figcaption>
</figure>`;
}
