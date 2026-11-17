// Markup for the schedule checker. The build renders the whole figure for its
// starting preset; the client redraws the same parts from these functions.

import { esc, num } from "../../shared/format";
import { run as pgRun, finalState as pgFinal, type Level } from "../mvcc-lab/model";
import {
  ansiPermits,
  committed,
  conflictGraph,
  findCycle,
  phenomena,
  serialOrder,
  strict2pl,
  topoOrder,
  txns,
  type Edge,
  type Outcome,
  type Step,
  type StepOutcome,
} from "./model";
import { recorded } from "./mysql";
import { presets } from "./presets";

export interface Props {
  preset?: unknown;
}

export interface View {
  key: string;
  steps: Step[];
  /** The step chosen for moving, or -1. */
  picked: number;
}

export const presetKeys = Object.keys(presets);
export const startView = (key: unknown): View => {
  const k = typeof key === "string" && key in presets ? key : presetKeys[0];
  return { key: k, steps: presets[k].steps, picked: -1 };
};
export const edited = (v: View) => v.steps !== presets[v.key].steps;

export const label = (s: Step) => (s.op === "r" || s.op === "w" ? `${s.op}${s.t}[${s.key}]` : `${s.op}${s.t}`);
const rule = (s: Step) => (s.op !== "w" ? "" : s.set !== undefined ? `= ${num(s.set, 0)}` : `${s.add! < 0 ? "−" : "+"} ${Math.abs(s.add!)}`);
const tn = (ts: number[]) => ts.map((t) => `T${t}`).join(", ");

// --- Schedulers --------------------------------------------------------------

export interface Row {
  id: string;
  name: string;
  sub: string;
  out: Outcome;
}

function fromPg(init: Record<string, number>, steps: Step[], level: Level): Outcome {
  const s = pgRun(init, steps, level);
  const out: StepOutcome[] = s.results.map((r, i) => {
    if (r.kind === "error") return { kind: "error", code: r.error!.code, message: r.error!.message };
    if (r.kind === "skipped") return { kind: "skipped" };
    if (r.kind === "blocked" && r.releasedAt === undefined) return { kind: "blocked" };
    if (r.kind === "blocked" && r.releasedKind === "error")
      return { kind: "error", code: r.error?.code ?? "40001", message: r.error?.message ?? "", releasedAt: r.releasedAt };
    const value = steps[i].op === "r" || steps[i].op === "w" ? r.value : undefined;
    return { kind: "ok", value, ...(r.kind === "blocked" ? { releasedAt: r.releasedAt } : {}) };
  });
  return { steps: out, final: pgFinal(s), committed: Object.values(s.txns).filter((t) => t.status === "committed").map((t) => t.t).sort() };
}

export function rows(v: View): Row[] {
  const p = presets[v.key];
  const out: Row[] = [{ id: "2pl", name: "Strict 2PL", sub: "simulated", out: strict2pl(p.init, v.steps) }];
  for (const [lv, n] of [["rc", "read committed"], ["rr", "repeatable read"], ["ser", "serializable"]] as [Level, string][])
    out.push({ id: `pg-${lv}`, name: "PostgreSQL", sub: n, out: fromPg(p.init, v.steps, lv) });
  if (!edited(v) && recorded[v.key]) {
    for (const [lv, n] of [["ru", "read uncommitted"], ["rc", "read committed"], ["rr", "repeatable read"], ["ser", "serializable"]])
      out.push({ id: `my-${lv}`, name: "MySQL 8.0", sub: n, out: recorded[v.key][lv] });
  }
  return out;
}

function cell(step: Step, r: StepOutcome, steps: Step[]): string {
  const after = r.releasedAt !== undefined ? `<small>after ${esc(label(steps[r.releasedAt])).replace("[", "<wbr>[")}</small>` : "";
  if (r.kind === "skipped") return `<td class="sc-skip" title="not run: the transaction had already failed">·</td>`;
  if (r.kind === "blocked") return `<td class="sc-wait" title="still waiting at the end of the schedule">waits</td>`;
  if (r.kind === "error") {
    const code = r.code === "deadlock" || r.code === "40P01" || r.code === "1213" ? "deadlock" : r.code === "1205" ? "timeout" : "fails";
    return `<td class="sc-err" title="${esc(`${r.code ?? ""} ${r.message ?? ""}`.trim())}">${code.replace("dead", "dead&shy;")}${after}</td>`;
  }
  const v = step.op === "r" || step.op === "w" ? (r.value !== undefined ? num(r.value, 0) : "ok") : step.op;
  return `<td class="${after ? "sc-waited" : ""}">${v}${after}</td>`;
}

export function result(init: Record<string, number>, steps: Step[], o: Outcome): { text: string; ok: boolean } {
  const fin = Object.keys(o.final).sort().map((k) => `${k} = ${num(o.final[k], 0)}`).join(", ");
  const all = txns(steps);
  const failed = all.filter((t) => !o.committed.includes(t) && steps.some((s) => s.t === t && s.op === "c"));
  const order = serialOrder(init, steps, o);
  const lost = failed.length ? ` ${tn(failed)} failed and would be retried.` : "";
  if (order === null) return { text: `${fin}. No serial order of ${tn(o.committed)} reads these values and ends here.${lost}`, ok: false };
  const same = order.length === 0 ? "Same as running nothing." : order.length === 1 ? `Same as running T${order[0]} alone.` : `Same as ${order.map((t) => `T${t}`).join(" then ")}.`;
  return { text: `${fin}. ${same}${lost}`, ok: true };
}

export function gridHtml(v: View): string {
  const p = presets[v.key];
  const head = v.steps
    .map((s, i) => `<th scope="col"><button type="button" class="sc-step t${s.t}" data-step="${i}" aria-pressed="${i === v.picked}" disabled>${esc(label(s)).replace("[", "<wbr>[")}${rule(s) ? `<small>${esc(rule(s))}</small>` : ""}</button></th>`)
    .join("");
  const n = v.steps.length;
  const body = rows(v)
    .map((r) => {
      const res = result(p.init, v.steps, r.out);
      return `<tr class="sc-run" data-row="${r.id}"><th scope="row">${esc(r.name)}<small>${esc(r.sub)}</small></th>${v.steps.map((s, i) => cell(s, r.out.steps[i], v.steps)).join("")}</tr>
<tr class="sc-res" data-ok="${res.ok}"><td colspan="${n + 1}">${esc(res.text)}</td></tr>`;
    })
    .join("");
  const note = edited(v) || !recorded[v.key]
    ? `<tr class="sc-res"><td colspan="${n + 1}" class="sc-mysql-note">MySQL rows are recordings of the unedited schedules; press Reset to see them.</td></tr>`
    : "";
  return `<thead><tr><th scope="col" class="sc-corner">Schedule</th>${head}</tr></thead><tbody>${body}${note}</tbody>`;
}

// --- Conflict graph ----------------------------------------------------------

export const GW = 300;
export const GH = 128;

export function graphSvg(steps: Step[]): string {
  const nodes = committed(steps);
  const edges = conflictGraph(steps);
  const cycle = findCycle(nodes, edges);
  const onCycle = new Set<string>();
  if (cycle) for (let i = 0; i + 1 < cycle.length; i++) onCycle.add(`${cycle[i]}>${cycle[i + 1]}`);
  const pos = new Map<number, [number, number]>();
  const R = 17;
  if (nodes.length === 1) pos.set(nodes[0], [GW / 2, GH / 2]);
  else if (nodes.length === 2) nodes.forEach((t, i) => pos.set(t, [70 + i * (GW - 140), GH / 2]));
  else nodes.forEach((t, i) => pos.set(t, [GW / 2 + 95 * Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / nodes.length), GH / 2 + 8 + 48 * Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / nodes.length)]));
  const groups = new Map<string, Edge[]>();
  for (const e of edges) {
    const k = `${e.from}>${e.to}`;
    if (!groups.has(k)) groups.set(k, []);
    if (!groups.get(k)!.some((x) => x.kind === e.kind && x.key === e.key)) groups.get(k)!.push(e);
  }
  let svg = `<defs><marker id="sc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`;
  for (const [k, es] of groups) {
    const [a, b] = k.split(">").map(Number);
    const [x1, y1] = pos.get(a)!, [x2, y2] = pos.get(b)!;
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
    const nx = -dy / d, ny = dx / d;
    const bend = groups.has(`${b}>${a}`) ? 26 : 0;
    const mx = (x1 + x2) / 2 + nx * bend, my = (y1 + y2) / 2 + ny * bend;
    const sx = x1 + (dx / d) * R + nx * (bend ? 7 : 0), sy = y1 + (dy / d) * R + ny * (bend ? 7 : 0);
    const ex = x2 - (dx / d) * R + nx * (bend ? 7 : 0), ey = y2 - (dy / d) * R + ny * (bend ? 7 : 0);
    const cls = onCycle.has(k) ? "sc-edge cyc" : "sc-edge";
    const text = es.map((e) => `${e.kind} ${e.key}`).join(", ");
    svg += `<path class="${cls}" d="M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}" marker-end="url(#sc-arrow)"/>`;
    svg += `<text class="sc-elabel" x="${(mx + nx * 6).toFixed(1)}" y="${(my + ny * 6 + 4).toFixed(1)}" text-anchor="middle">${esc(text)}</text>`;
  }
  for (const t of nodes) {
    const [x, y] = pos.get(t)!;
    svg += `<g class="sc-node t${t}"><circle cx="${x}" cy="${y}" r="${R}"/><text x="${x}" y="${y + 5}" text-anchor="middle">T${t}</text></g>`;
  }
  if (!nodes.length) svg += `<text class="sc-elabel" x="${GW / 2}" y="${GH / 2}" text-anchor="middle">no committed transactions</text>`;
  return svg;
}

export function verdictText(steps: Step[]): { text: string; tone: "ok" | "bad" } {
  const nodes = committed(steps);
  const edges = conflictGraph(steps);
  const cycle = findCycle(nodes, edges);
  if (cycle) return { text: `Not conflict serializable: the cycle ${cycle.map((t) => `T${t}`).join(" → ")} rules out every serial order.`, tone: "bad" };
  const order = topoOrder(nodes, edges)!;
  return { text: order.length > 1 ? `Conflict serializable, equivalent to ${order.map((t) => `T${t}`).join(" then ")}.` : `Conflict serializable.`, tone: "ok" };
}

// --- Phenomena ---------------------------------------------------------------

export function phenHtml(steps: Step[]): string {
  return phenomena(steps)
    .map((p) => `<li class="${p.match ? "on" : "off"}"><b>${p.id}</b> ${esc(p.name)}${p.match ? `: <span class="sc-m">${p.match.map((i) => esc(label(steps[i]))).join(" ")}</span>` : ""}</li>`)
    .join("");
}

export function ansiText(steps: Step[]): string {
  const res = ansiPermits(phenomena(steps));
  const yes = res.filter((r) => r.permits).map((r) => r.level.toLowerCase());
  const no = res.filter((r) => !r.permits).map((r) => `${r.level.toLowerCase()} (${r.because.join(", ")})`);
  return `Locking levels (the Critique's Table 4) that admit this schedule: ${yes.length ? yes.join(", ") : "none"}.${no.length ? ` Excluded at ${no.join("; ")}.` : ""}`;
}

export function render(props: Props): string {
  const v = startView(props.preset);
  const options = presetKeys.map((k) => `<option value="${k}"${k === v.key ? " selected" : ""}>${esc(presets[k].label)}</option>`).join("");
  const vd = verdictText(v.steps);
  return `<figure class="sc" data-preset="${v.key}">
<div class="sc-controls">
<label class="sc-preset"><span>Schedule</span><select name="preset" disabled>${options}</select></label>
<span class="sc-move"><button type="button" name="earlier" disabled aria-label="Move the chosen step earlier">◀ Earlier</button><button type="button" name="later" disabled aria-label="Move the chosen step later">Later ▶</button><button type="button" name="reset" disabled>Reset</button></span>
</div>
<p class="sc-story" data-part="story">${esc(presets[v.key].story)}</p>
<div class="sc-scroll"><table class="sc-grid" data-part="grid">${gridHtml(v)}</table></div>
<div class="sc-panels">
<section><h4>Conflict graph of the committed transactions</h4><svg class="sc-graph" viewBox="0 0 ${GW} ${GH}" role="img" aria-label="Conflict graph" data-part="graph">${graphSvg(v.steps)}</svg><p class="sc-verdict" data-part="verdict" data-tone="${vd.tone}">${esc(vd.text)}</p></section>
<section><h4>Phenomena in the schedule as written</h4><ul class="sc-phen" data-part="phen">${phenHtml(v.steps)}</ul><p class="sc-ansi" data-part="ansi">${esc(ansiText(v.steps))}</p></section>
</div>
<figcaption>Each row runs the schedule above through one scheduler, issuing the steps in order. A cell shows the value read or written; a shaded cell waited for a lock and ran after the step named under it, and a step after a failure in the same transaction is skipped (·). Strict 2PL is a simulation. The PostgreSQL rows come from the model in the <a href="/systems/databases/mvcc-snapshot-isolation">MVCC note</a>, checked step by step against a PostgreSQL 16 server; PostgreSQL runs read uncommitted as read committed. The MySQL rows replay recordings from MySQL 8.0. Pick a step and move it earlier or later to change the interleaving; the graph and phenomena are computed from the schedule as written.</figcaption>
</figure>`;
}
