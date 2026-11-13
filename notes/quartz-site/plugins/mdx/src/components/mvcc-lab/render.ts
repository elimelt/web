// Markup for the MVCC lab. The build renders the whole figure for its
// starting scenario, so the page shows a finished figure before any script
// runs; the client redraws the same parts from these functions.

import { esc } from "../../shared/format";
import {
  chain,
  dependencies,
  describe,
  finalState,
  horizon,
  keys,
  life,
  run,
  serialOrder,
  verdict,
  type Edge,
  type Level,
  type State,
  type Step,
  type Txn,
  type Verdict,
} from "./model";
import { scenarioKeys, scenarios, startScenario, type Scenario } from "./scenarios";

export interface Props {
  scenario?: unknown;
}

export interface View {
  key: string;
  steps: Step[];
  level: Level;
  done: number;
  /** The step chosen for moving, or -1. */
  picked: number;
  /** The transaction whose view is explained. */
  focus: number;
}

export const LEVELS: [Level, string, string][] = [
  ["rc", "Read committed", "new snapshot per statement"],
  ["rr", "Repeatable read", "snapshot isolation"],
  ["ser", "Serializable", "SSI"],
];

export const startView = (key: unknown): View => {
  const k = startScenario(key);
  const sc = scenarios[k];
  return { key: k, steps: sc.steps, level: sc.level, done: 0, picked: -1, focus: 1 };
};

export const stateOf = (v: View): State => run(scenarios[v.key].init, v.steps, v.level, v.done);

// --- Schedule ---------------------------------------------------------------

export function stepsHtml(v: View, s: State): string {
  return v.steps
    .map((step, i) => {
      const r = s.results[i];
      let cls = "pending";
      let res = "";
      if (r) {
        if (r.kind === "error") {
          cls = "error";
          res = ` <span class="mv-res">${r.error!.code === "40P01" ? "deadlock" : "fails"}</span>`;
        } else if (r.kind === "skipped") cls = "skipped";
        else if (r.kind === "blocked" && r.releasedAt === undefined) {
          cls = "blocked";
          res = ` <span class="mv-res">waits</span>`;
        } else if (r.kind === "blocked" && r.releasedKind === "error") {
          cls = "error";
          res = ` <span class="mv-res">waited, fails</span>`;
        } else {
          cls = r.kind === "blocked" ? "done waited" : "done";
          if (step.op === "r") res = ` <span class="mv-res">→ ${num(r.value!)}</span>`;
          if (r.kind === "blocked") res += ` <span class="mv-res">after a wait</span>`;
        }
      }
      if (i === v.done) cls += " next";
      if (i === v.picked) cls += " picked";
      const label = `T${step.t} ${describe(step)}`;
      return `<li><button type="button" class="mv-chip t${step.t} ${cls}" data-step="${i}" aria-pressed="${i === v.picked}" disabled>${esc(label)}${res}</button></li>`;
    })
    .join("");
}

const num = (n: number) => String(n).replace("-", "−");

export function noteText(v: View, s: State): string {
  if (v.done === 0) return "Press Next to run the first step, or click any step to run up to it.";
  const step = v.steps[v.done - 1];
  const r = s.results[v.done - 1];
  let head = `Step ${v.done}: T${step.t} ${describe(step)}`;
  if (r.kind === "ok" && step.op === "r") head += ` reads ${num(r.value!)}`;
  if (r.kind === "skipped") head += ` is skipped: T${step.t} already failed`;
  return [head + ".", ...s.notes].join(" ");
}

// --- Rows -------------------------------------------------------------------

const LIFE_WORD: Record<string, string> = {
  live: "current",
  uncommitted: "not yet committed",
  aborted: "rolled back",
  kept: "dead, kept for an open snapshot",
  removable: "dead, can be removed",
  replacing: "being replaced",
};

function owner(s: State, xid: number): string {
  const t = Object.values(s.txns).find((x) => x.xid === xid);
  return t ? `t${t.t}` : "t0";
}

export function rowsHtml(v: View, s: State): string {
  const t = s.txns[v.focus];
  const snap = t?.snap ?? null;
  return keys(s)
    .map((key) => {
      const vers = chain(s, key)
        .map((ver) => {
          const lf = life(s, ver);
          const seen = snap && t.status !== "idle" ? verdict(s, ver, t, snap).visible : false;
          const xmax = ver.xmax === null ? "–" : String(ver.xmax);
          return `<li class="mv-ver ${owner(s, ver.xmin)} life-${lf}${seen ? " seen" : ""}" title="${esc(LIFE_WORD[lf])}"><b>${num(ver.value)}</b><small>xmin ${ver.xmin}<br>xmax ${xmax}</small><em>${esc(LIFE_WORD[lf])}</em></li>`;
        })
        .join("");
      return `<div class="mv-key"><span class="mv-keyname">${esc(key)}</span><ol class="mv-chain">${vers}</ol></div>`;
    })
    .join("");
}

export function horizonText(s: State): string {
  const h = horizon(s);
  const holders = Object.values(s.txns).filter(
    (t) => (t.status === "active" || t.status === "blocked") && ((t.xid !== null && t.xid === h) || (s.level !== "rc" && t.snap?.xmin === h)),
  );
  const who = holders.length ? `, held by ${holders.map((t) => `T${t.t}`).join(" and ")}` : "";
  return `Removal horizon: xid ${h}${who}. A version replaced by a committed transaction older than this is invisible to every snapshot.`;
}

// --- Transactions ---------------------------------------------------------

const STATUS: Record<string, string> = {
  idle: "not started",
  active: "running",
  blocked: "waiting",
  committed: "committed",
  aborted: "rolled back",
};

function snapText(s: State, t: Txn): string {
  if (!t.snap) return "no snapshot yet";
  const sn = t.snap;
  const xip = sn.xip.length ? sn.xip.join(", ") : "none";
  const which = s.level === "rc" ? "last statement's snapshot" : "snapshot";
  return `${which}: xmin ${sn.xmin}, xmax ${sn.xmax}, in progress: ${xip}`;
}

export function txnsHtml(v: View, s: State): string {
  return Object.values(s.txns)
    .map((t) => {
      const reads = t.reads.length ? t.reads.map((r) => `${esc(r.key)}=${num(r.value)}`).join(", ") : "nothing yet";
      const xid = t.xid === null ? "no xid yet" : `xid ${t.xid}`;
      const wait = t.status === "blocked" && t.waitsFor !== null ? ` on T${t.waitsFor}` : "";
      const doomed = s.level === "ser" && t.doomed && t.status !== "aborted" ? `<span class="mv-doom">marked to fail</span>` : "";
      const fail = t.failure ? `<span class="mv-fail">ERROR: ${esc(t.failure.message)}</span>` : "";
      return `<button type="button" class="mv-txn t${t.t} st-${t.status}${t.t === v.focus ? " focus" : ""}" data-txn="${t.t}" aria-pressed="${t.t === v.focus}" disabled><span class="mv-txnhead"><b>T${t.t}</b> ${xid} · ${STATUS[t.status]}${wait}</span><span>${esc(snapText(s, t))}</span><span>read: ${reads}</span>${doomed}${fail}</button>`;
    })
    .join("");
}

// --- Why ----------------------------------------------------------------------

function reason(s: State, vd: Verdict, xmin: number, xmax: number | null): string {
  switch (vd.why) {
    case "own":
      return "its own write";
    case "committed":
      return `xid ${xmin} committed before the snapshot, and nothing replaced it`;
    case "deleter-running":
      return `replaced by xid ${xmax}, which is in the snapshot's in-progress list`;
    case "deleter-later":
      return `replaced by xid ${xmax}, which started after the snapshot`;
    case "deleter-aborted":
      return `replaced by xid ${xmax}, which rolled back`;
    case "creator-running":
      return `written by xid ${xmin}, in progress for this snapshot`;
    case "creator-later":
      return `written by xid ${xmin}, which started after the snapshot`;
    case "creator-aborted":
      return `written by xid ${xmin}, which rolled back`;
    case "deleted":
      return `replaced by xid ${xmax}, which committed before the snapshot`;
    case "own-replaced":
      return "replaced by its own later write";
  }
}

export function whyHtml(v: View, s: State): string {
  const t = s.txns[v.focus];
  if (!t) return "";
  if (!t.snap) return `<p>T${t.t} has no snapshot yet: it takes one at its first statement.</p>`;
  const items = keys(s)
    .map((key) => {
      const parts = chain(s, key).map((ver) => {
        const vd = verdict(s, ver, t, t.snap!);
        return `<li class="${vd.visible ? "yes" : "no"}">${esc(key)} = ${num(ver.value)}: ${vd.visible ? "visible" : "invisible"}, ${esc(reason(s, vd, ver.xmin, ver.xmax))}</li>`;
      });
      return parts.join("");
    })
    .join("");
  const when = t.status === "committed" || t.status === "aborted" ? ` (as of its last statement; T${t.t} has ${STATUS[t.status]})` : "";
  return `<p>What T${t.t}'s snapshot sees${esc(when)}:</p><ul>${items}</ul>`;
}

// --- Dependency graph -------------------------------------------------------

export const GW = 300;
export const GH = 170;

function nodePos(n: number, count: number): [number, number] {
  if (count <= 2) return n === 1 ? [60, 85] : [240, 85];
  return ([[50, 40], [250, 40], [150, 140]] as [number, number][])[n - 1];
}

function inCycle(edges: Edge[], nodes: number[]): Set<string> {
  // An edge lies on a cycle when its head can reach its tail.
  const reach = (a: number, b: number) => {
    const seen = new Set<number>([a]);
    const stack = [a];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === b) return true;
      for (const e of edges) if (e.from === x && !seen.has(e.to)) (seen.add(e.to), stack.push(e.to));
    }
    return false;
  };
  const out = new Set<string>();
  for (const e of edges) if (nodes.includes(e.from) && reach(e.to, e.from)) out.add(`${e.from}-${e.to}`);
  return out;
}

export function graphSvg(s: State): string {
  const txns = Object.values(s.txns);
  const count = txns.length;
  const edges = dependencies(s);
  const cyc = inCycle(edges, txns.map((t) => t.t));
  const pairs = new Map<string, Edge[]>();
  for (const e of edges) {
    const k = `${e.from}-${e.to}`;
    pairs.set(k, [...(pairs.get(k) ?? []), e]);
  }
  const R = 22;
  let paths = "";
  for (const [k, es] of pairs) {
    const [a, b] = k.split("-").map(Number);
    const [x1, y1] = nodePos(a, count);
    const [x2, y2] = nodePos(b, count);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    // Bend every edge to its left so the two directions of a pair separate.
    const bend = 22;
    const mx = (x1 + x2) / 2 + uy * bend;
    const my = (y1 + y2) / 2 - ux * bend;
    const sx = x1 + ux * R;
    const sy = y1 + uy * R;
    const ex = x2 - ux * (R + 4);
    const ey = y2 - uy * (R + 4);
    const label = es.map((e) => `${e.kind} ${e.key}`).join(", ");
    const hot = cyc.has(k) ? " cycle" : "";
    const rw = es.every((e) => e.kind === "rw") ? " rw" : "";
    paths += `<path class="mv-edge${hot}${rw}" d="M${sx.toFixed(1)} ${sy.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" marker-end="url(#mv-arrow${hot ? "-hot" : ""})"/>`;
    const lx = (x1 + x2) / 2 + uy * (bend / 2 + 9);
    const ly = (y1 + y2) / 2 - ux * (bend / 2 + 9) + 4;
    paths += `<text class="mv-elabel${hot}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${esc(label)}</text>`;
  }
  const nodes = txns
    .map((t) => {
      const [x, y] = nodePos(t.t, count);
      return `<g class="mv-node t${t.t} st-${t.status}"><circle cx="${x}" cy="${y}" r="${R}"/><text x="${x}" y="${y + 5}" text-anchor="middle">T${t.t}</text></g>`;
    })
    .join("");
  const defs = `<defs><marker id="mv-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="mv-head"/></marker><marker id="mv-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="mv-head hot"/></marker></defs>`;
  return `${defs}${paths}${nodes}`;
}

// --- Verdict ------------------------------------------------------------------

export function verdictHtml(v: View, s: State): { text: string; tone: string } {
  const sc: Scenario = scenarios[v.key];
  const open = Object.values(s.txns).filter((t) => t.status === "idle" || t.status === "active" || t.status === "blocked");
  const reads: Record<number, Record<string, number>> = {};
  for (const t of Object.values(s.txns)) {
    reads[t.t] = {};
    for (const r of t.reads) reads[t.t][r.key] = r.value;
  }
  const failed = Object.values(s.txns).filter((t) => t.failure);
  const failText = failed.length ? ` ${failed.map((t) => `T${t.t}`).join(" and ")} failed and would be retried.` : "";
  if (open.length) {
    return { text: `${open.length === 1 ? "One transaction is" : `${open.length} transactions are`} still open. The arrows show the dependencies so far; an arrow T1 → T2 means T1 must come before T2 in any equivalent serial order.`, tone: "neutral" };
  }
  const order = serialOrder(sc.init, s);
  const fin = finalState(s);
  const check = sc.check ? sc.check(fin, reads) : "";
  const state = Object.entries(fin).map(([k, x]) => `${k} = ${num(x)}`).join(", ");
  if (order) {
    const as = order.length > 1 ? `the same as running ${order.map((t) => `T${t}`).join(" then ")}` : "trivially serial";
    return { text: `Serializable: ${as}. Final ${state}.${failText} ${check}`.trim(), tone: "good" };
  }
  return {
    text: `Not serializable: no order of the committed transactions reads these values and ends with ${state}. ${check}${failText}`.trim(),
    tone: "bad",
  };
}

export function ssiText(s: State): string {
  if (s.level !== "ser") return "";
  const edges: string[] = [];
  for (const t of Object.values(s.txns)) for (const w of t.outC) edges.push(`T${t.t} → T${w}`);
  const doomed = Object.values(s.txns).filter((t) => t.doomed && t.status !== "aborted").map((t) => `T${t.t}`);
  const e = edges.length ? `SSI is tracking rw-conflicts ${edges.join(", ")}.` : "SSI is tracking no rw-conflicts.";
  return doomed.length ? `${e} ${doomed.join(", ")} will fail at its next statement.` : e;
}

// --- The whole figure ---------------------------------------------------------

export function render(props: Props): string {
  const v = startView(props.scenario);
  const s = stateOf(v);
  const options = scenarioKeys
    .map((k) => `<option value="${k}"${k === v.key ? " selected" : ""}>${esc(scenarios[k].label)}</option>`)
    .join("");
  const levels = LEVELS.map(
    ([k, name, sub]) => `<button type="button" name="level" value="${k}" aria-pressed="${k === v.level}" disabled><b>${name}</b><small>${sub}</small></button>`,
  ).join("");
  const vd = verdictHtml(v, s);
  return `<figure class="mv" data-scenario="${v.key}">
<div class="mv-controls">
<label class="mv-scenario"><span>Scenario</span><select name="scenario" disabled>${options}</select></label>
<div class="mv-levels" role="group" aria-label="Isolation level">${levels}</div>
</div>
<p class="mv-story" data-part="story">${esc(scenarios[v.key].story)}</p>
<ol class="mv-steps" data-part="steps" aria-label="Schedule">${stepsHtml(v, s)}</ol>
<div class="mv-bar">
<button type="button" name="back" disabled>Back</button><button type="button" name="next" disabled>Next</button><button type="button" name="end" disabled>Run all</button><button type="button" name="reset" disabled>Reset</button>
<span class="mv-move"><button type="button" name="earlier" disabled aria-label="Move the chosen step earlier">◀ Earlier</button><button type="button" name="later" disabled aria-label="Move the chosen step later">Later ▶</button></span>
</div>
<p class="mv-note" data-part="note" aria-live="polite">${esc(noteText(v, s))}</p>
<div class="mv-grid">
<section class="mv-rows"><h4>Row versions, oldest first</h4><div data-part="rows">${rowsHtml(v, s)}</div><p class="mv-horizon" data-part="horizon">${esc(horizonText(s))}</p></section>
<section class="mv-txns"><h4>Transactions</h4><div data-part="txns">${txnsHtml(v, s)}</div></section>
</div>
<div class="mv-why" data-part="why">${whyHtml(v, s)}</div>
<div class="mv-result">
<svg class="mv-graph" viewBox="0 0 ${GW} ${GH}" role="img" aria-label="Dependency graph between the transactions" data-part="graph">${graphSvg(s)}</svg>
<div><p class="mv-verdict" data-part="verdict" data-tone="${vd.tone}">${esc(vd.text)}</p><p class="mv-ssi" data-part="ssi">${esc(ssiText(s))}</p></div>
</div>
<figcaption>A model of PostgreSQL's MVCC, checked step by step against PostgreSQL 16 on these schedules and 80 random ones. Click a step to run up to it, or pick a step and move it earlier or later to change the interleaving. Click a transaction to see what its snapshot sees and why. Arrows are dependencies: ww and wr point from the earlier writer, rw from a reader to the transaction that replaced what it read. A cycle (red) means no serial order exists.</figcaption>
</figure>`;
}
