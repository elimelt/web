// Markup for the replicated-text figure. The build runs the starting scenario
// through the real algorithm and renders the result with the controls
// disabled; the client module redraws the same parts from these functions.

import { esc } from "../../shared/format";
import { ALGO_LABEL, ALGOS, DEFAULT_ALGO, DEFAULT_SCENARIO, pending, scenarios, scenarioSim, summary, type Algo, type Elem, type ReplicaId, type Sim } from "./model";

export interface Props {
  algo?: unknown;
  scenario?: unknown;
}

export const startAlgo = (v: unknown): Algo => (typeof v === "string" && (ALGOS as string[]).includes(v) ? (v as Algo) : DEFAULT_ALGO);
export const startScenario = (v: unknown): string => (typeof v === "string" && v in scenarios ? v : DEFAULT_SCENARIO);

const WHO: Record<string, string> = { o: "the starting text", A: "replica A", B: "replica B" };

function chip(e: Elem): string {
  const ch = e.char === " " ? "␣" : esc(e.char);
  const title = `${e.deleted ? "deleted " : ""}“${e.char}” typed at ${WHO[e.replica] ?? e.replica}, id ${e.label}`;
  return `<span class="lc-chip lc-${e.replica === "o" ? "o" : e.replica}${e.deleted ? " lc-del" : ""}${e.char === " " ? " lc-space" : ""}" title="${esc(title)}"><b>${ch}</b><i>${esc(e.label)}</i></span>`;
}

/** The replica's stored sequence: every character in document order, tombstones included. */
export function sequence(sim: Sim, r: ReplicaId): string {
  return sim.docs[r].elems().map(chip).join("");
}

/** What is queued on the replica's outgoing link. */
export function outbox(sim: Sim, r: ReplicaId): string {
  const n = sim.inFlight[r === "A" ? "AB" : "BA"].length;
  return n === 0 ? "nothing to send" : `${n} op${n === 1 ? "" : "s"} to send`;
}

export function flight(sim: Sim): string {
  const n = pending(sim);
  return n === 0 ? "in sync" : `${n} in flight`;
}

function replica(sim: Sim, r: ReplicaId): string {
  return `<section class="lc-replica lc-r${r}" aria-label="Replica ${r}">
  <div class="lc-head"><span class="lc-name">Replica ${r}</span><span class="lc-out" data-part="out${r}">${outbox(sim, r)}</span></div>
  <input type="text" name="text${r}" value="${esc(sim.docs[r].text())}" aria-label="Text at replica ${r}" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" disabled>
  <div class="lc-seq" data-part="seq${r}" aria-label="What replica ${r} stores">${sequence(sim, r)}</div>
</section>`;
}

export function render(props: Props = {}): string {
  const algo = startAlgo(props.algo);
  const scenario = startScenario(props.scenario);
  const sim = scenarioSim(algo, scenario);
  const sum = summary(sim);
  const algoOptions = ALGOS.map((a) => `<option value="${a}"${a === algo ? " selected" : ""}>${ALGO_LABEL[a]}</option>`).join("");
  const scenarioOptions = Object.entries(scenarios)
    .map(([k, s]) => `<option value="${k}"${k === scenario ? " selected" : ""}>${esc(s.label)}</option>`)
    .join("");
  return `<figure class="lc" data-algo="${algo}">
<form class="lc-controls">
  <label class="lc-field"><span>List CRDT</span><select name="algo" disabled>${algoOptions}</select></label>
  <label class="lc-field"><span>Start</span><select name="scenario" disabled>${scenarioOptions}</select></label>
  <label class="lc-check"><input type="checkbox" name="online" disabled> Online</label>
  <label class="lc-check"><input type="checkbox" name="ids" disabled> Show ids and tombstones</label>
</form>
<div class="lc-replicas">
${replica(sim, "A")}
<div class="lc-net"><button type="button" name="sync" disabled>Sync</button><span class="lc-flight" data-part="flight">${flight(sim)}</span><button type="button" name="reset" disabled>Reset</button></div>
${replica(sim, "B")}
</div>
<p class="lc-summary" data-part="summary" data-tone="${sum.tone}" aria-live="polite">${esc(sum.text)}</p>
<figcaption>Two replicas of one text, each running the chosen list CRDT in your browser. Edits go out one character at a time as operations; with Online off they queue until you press Sync. Type into either box, or pick a start. Changing the CRDT replays the same keystrokes under the other algorithm. Under each box is what that replica stores, in document order: blue characters came from A, orange from B, gray from the shared starting text. Show ids to see the identifier each algorithm orders by, and the deleted characters it keeps as tombstones.</figcaption>
</figure>`;
}
