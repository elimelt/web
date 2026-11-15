// Markup for the vertex cover figure. The build renders the finished run, so
// the page shows a complete result before the script loads; the client redraws
// the same parts with these functions as the reader steps.

import { esc } from "../../shared/format";
import { edgeOrder, optimum, preset, run, snapshot, type Graph, type Run, type Step } from "./model";

export interface Props {
  preset?: string;
}

export interface State {
  id: string;
  graph: Graph;
  seed: number;
  prune: boolean;
  run: Run;
  step: number;
  opt: number;
}

export function initialState(props: Props = {}, seed?: number): State {
  const p = preset(props.preset);
  const s = seed ?? p.seed;
  const r = run(p.graph, edgeOrder(p.graph, s), p.prune);
  return { id: p.id, graph: p.graph, seed: s, prune: p.prune, run: r, step: r.steps.length, opt: optimum(p.graph).size };
}

const W = 600;
const PAD_X = 52;

function height(g: Graph): number {
  return g.names.length > 8 ? 370 : 210;
}

function point(g: Graph, i: number): [number, number] {
  const [x, y] = g.xy[i];
  const narrow = g.names.length <= 8;
  const x0 = narrow ? 170 : PAD_X;
  const x1 = narrow ? W - 170 : W - PAD_X;
  return [x0 + x * (x1 - x0), 30 + y * (height(g) - 48)];
}

const edgeName = (g: Graph, e: number): string => `${g.names[g.edges[e][0]]}–${g.names[g.edges[e][1]]}`;

export function chart(state: State): string {
  const g = state.graph;
  const snap = snapshot(g, state.run, state.step);
  const matched = new Set(snap.matching);
  const cur = snap.current;
  const curEdge = cur && (cur.kind === "take" || cur.kind === "skip") ? cur.edge : null;
  const curVertex = cur && (cur.kind === "drop" || cur.kind === "keep") ? cur.vertex : null;
  const parts: string[] = [];
  g.edges.forEach(([u, v], e) => {
    const [x1, y1] = point(g, u);
    const [x2, y2] = point(g, v);
    const cls = matched.has(e) ? "vm-matched" : snap.uncovered.has(e) ? "vm-open" : "vm-covered";
    if (e === curEdge) parts.unshift(`<line class="vm-halo" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    parts.push(`<line class="vm-edge ${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  });
  g.names.forEach((name, i) => {
    const [x, y] = point(g, i);
    const cls = snap.cover.has(i) ? "vm-in" : "vm-out";
    if (i === curVertex) parts.unshift(`<circle class="vm-halo-node" cx="${x}" cy="${y}" r="15"/>`);
    const short = name.length > 5 ? name.slice(0, 4) : name;
    parts.push(
      `<g class="vm-node ${cls}"><circle cx="${x}" cy="${y}" r="7"/>` +
        `<text class="vm-name vm-long" x="${x}" y="${y - 12}" text-anchor="middle">${esc(name)}</text>` +
        `<text class="vm-name vm-short" x="${x}" y="${y - 17}" text-anchor="middle">${esc(short)}</text></g>`,
    );
  });
  const H = height(g);
  const aria = `${g.names.length} vertices and ${g.edges.length} edges. After ${state.step} steps the cover holds ${snap.cover.size} vertices and the matching ${snap.matching.length} edges.`;
  return `<svg class="vm-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

export function tally(state: State): string {
  const snap = snapshot(state.graph, state.run, state.step);
  const m = snap.matching.length;
  return (
    `<span><b>${m}</b> matched edge${m === 1 ? "" : "s"}</span>` +
    `<span>cover <b>${snap.cover.size}</b> vertices</span>` +
    `<span>optimum <b>${state.opt}</b></span>`
  );
}

function stepText(g: Graph, s: Step): string {
  switch (s.kind) {
    case "take":
      return `Edge ${esc(edgeName(g, s.edge))} has neither end in the cover. Take both ends; the edge joins the matching.`;
    case "skip":
      return `Edge ${esc(edgeName(g, s.edge))} is already covered by ${esc(g.names[s.coveredBy])}. Skip it.`;
    case "drop":
      return `Pruning: every neighbour of ${esc(g.names[s.vertex])} is in the cover, so its edges stay covered without it. Drop it.`;
    case "keep":
      return `Pruning: ${esc(g.names[s.vertex])} stays, because its neighbour ${esc(g.names[s.witness])} is outside the cover and only ${esc(g.names[s.vertex])} covers the edge between them.`;
  }
}

export function narration(state: State): string {
  const g = state.graph;
  const total = state.run.steps.length;
  const scans = g.edges.length;
  if (state.step === 0) return `Nothing scanned yet. The algorithm will look at the ${scans} edges in a random order${state.prune ? ", then try to drop each cover vertex" : ""}.`;
  let text = `Step ${state.step}: ${stepText(g, state.run.steps[state.step - 1])}`;
  if (state.step === scans && state.prune) {
    const snap = snapshot(g, state.run, state.step);
    text += ` The scan is done: ${snap.cover.size} vertices. Now each cover vertex gets a second look.`;
  }
  if (state.step === total) {
    const snap = snapshot(g, state.run, state.step);
    const m = snap.matching.length;
    const c = snap.cover.size;
    text += ` Finished with ${c} vertices. The ${m} matched edges share no endpoint, so any cover needs ${m} different vertices just for them: the optimum is at least ${m}${state.prune ? `, and pruning only shrank the 2 × ${m} vertices the scan took` : `, and the cover has exactly 2 × ${m}`}. Here the optimum is ${state.opt}, a ratio of ${(c / state.opt).toFixed(2)}.`;
  }
  return text;
}

export function stepLabel(state: State): string {
  return `${state.step} / ${state.run.steps.length}`;
}

export function render(props: Props = {}): string {
  const state = initialState(props);
  const p = preset(props.preset);
  const reorder = p.reorder ? `<button type="button" name="reorder" disabled>New edge order</button>` : "";
  return `<figure class="vm" data-preset="${esc(p.id)}">
<div class="vm-chart" data-part="chart">${chart(state)}</div>
<p class="vm-tally" data-part="tally">${tally(state)}</p>
<div class="vm-steps">
<button type="button" name="first" aria-label="Back to the start" disabled>⏮</button>
<button type="button" name="prev" aria-label="Previous step" disabled>◀</button>
<button type="button" name="next" aria-label="Next step" disabled>▶</button>
<button type="button" name="last" aria-label="Finish the run" disabled>⏭</button>
<output name="step">${stepLabel(state)}</output>
${reorder}
</div>
<p class="vm-narration" data-part="narration" aria-live="polite">${narration(state)}</p>
<p class="vm-key"><span><i class="vm-key-matched"></i>matched edge</span><span><i class="vm-key-in"></i>in the cover</span><span><i class="vm-key-open"></i>not yet covered</span><span><i class="vm-key-halo"></i>this step</span></p>
</figure>`;
}
