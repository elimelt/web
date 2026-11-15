// Markup for the augmenting-path figure. The build renders the finished run
// (the minimum cut), so the page shows a complete result before the script
// loads; the client redraws the same parts with these functions as the reader
// steps or switches between the residual graph and the flow.

import { esc } from "../../shared/format";
import { INF, arcHead, arcTail, flowAt, preset, residual, run, valueAt, type Arc, type Net, type Preset, type Run } from "./model";

export type View = "residual" | "flow";

export interface Props {
  preset?: string;
}

export interface State {
  preset: Preset;
  run: Run;
  step: number;
  view: View;
}

export function initialState(props: Props = {}): State {
  const p = preset(props.preset);
  const r = run(p.net);
  return { preset: p, run: r, step: r.augments.length, view: "residual" };
}

const W = 600;
const PAD_X = 28;
const PAD_Y = 30;
const R = 15;

function point(p: Preset, i: number): [number, number] {
  const [x, y] = p.net.xy[i];
  return [PAD_X + x * (W - 2 * PAD_X), PAD_Y + y * (p.height - 2 * PAD_Y)];
}

const cap = (c: number) => (c >= INF / 2 ? "∞" : String(c));
const arcName = (net: Net, a: Arc) => `${net.names[arcTail(net, a)]} → ${net.names[arcHead(net, a)]}`;
const edgeName = (net: Net, e: number) => `${net.names[net.edges[e][0]]} → ${net.names[net.edges[e][1]]}`;
const f1 = (x: number) => x.toFixed(1);

/** An arrow from vertex u to vertex v, shifted `off` units to the right of its direction. */
function arrow(p: Preset, u: number, v: number, off: number, cls: string, label: string, labelOff: number, head = true): string {
  const [x1, y1] = point(p, u);
  const [x2, y2] = point(p, v);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const nx = -uy;
  const ny = ux;
  const sx = x1 + ux * (R + 2) + nx * off;
  const sy = y1 + uy * (R + 2) + ny * off;
  const tx = x2 - ux * (R + 3) + nx * off;
  const ty = y2 - uy * (R + 3) + ny * off;
  const ex = head ? tx - ux * 7 : tx;
  const ey = head ? ty - uy * 7 : ty;
  let out = `<g class="${cls}"><line x1="${f1(sx)}" y1="${f1(sy)}" x2="${f1(ex)}" y2="${f1(ey)}"/>`;
  if (head) {
    const bx = tx - ux * 9;
    const by = ty - uy * 9;
    out += `<polygon points="${f1(tx)},${f1(ty)} ${f1(bx + nx * 4.5)},${f1(by + ny * 4.5)} ${f1(bx - nx * 4.5)},${f1(by - ny * 4.5)}"/>`;
  }
  if (label) {
    const mx = (sx + tx) / 2 + nx * labelOff;
    const my = (sy + ty) / 2 + ny * labelOff;
    out += `<text class="ap-label" x="${f1(mx)}" y="${f1(my + 4)}" text-anchor="middle">${esc(label)}</text>`;
  }
  return out + "</g>";
}

export function chart(state: State): string {
  const p = state.preset;
  const net = p.net;
  const r = state.run;
  const total = r.augments.length;
  const flow = flowAt(r, state.step);
  const done = state.step === total;
  const next = done ? null : r.augments[state.step];
  const onPath = new Set(next ? next.path.map((a) => `${a.e}:${a.dir}`) : []);
  const pathEdges = new Set(next ? next.path.map((a) => a.e) : []);
  const cutEdges = new Set(done ? r.cut : []);
  const back: string[] = [];
  const front: string[] = [];
  net.edges.forEach(([u, v, c], e) => {
    const cut = cutEdges.has(e) ? " ap-cut" : "";
    if (state.view === "flow") {
      const f = flow[e];
      const cls = `ap-edge${f > 0 ? " ap-carries" : ""}${f !== 0 && Math.abs(f) === c ? " ap-full" : ""}${pathEdges.has(e) ? " ap-on-path" : ""}${cut}`;
      const [a, b] = f < 0 ? [v, u] : [u, v];
      // an infinite edge shows only its flow, and only when it carries some
      const label = c >= INF / 2 ? (f !== 0 ? String(Math.abs(f)) : "") : `${Math.abs(f)}/${cap(c)}`;
      (pathEdges.has(e) ? front : back).push(arrow(p, a, b, 0, cls, label, -11, !net.undirected?.[e] || f !== 0));
      return;
    }
    for (const dir of [1, -1] as const) {
      const a: Arc = { e, dir };
      const res = residual(net, flow, a);
      if (res <= 0) continue;
      const path = onPath.has(`${e}:${dir}`);
      const cls = `ap-arc ${dir === 1 ? "ap-forward" : "ap-backward"}${path ? " ap-on-path" : ""}${dir === 1 ? cut : ""}`;
      (path ? front : back).push(arrow(p, arcTail(net, a), arcHead(net, a), 5, cls, res >= INF / 2 ? "" : cap(res), 12));
    }
    if (done && cutEdges.has(e) && residual(net, flow, { e, dir: 1 }) <= 0) {
      back.push(arrow(p, u, v, 5, "ap-arc ap-ghost ap-cut", "", 0));
    }
  });
  const nodes = net.names.map((name, i) => {
    const [x, y] = point(p, i);
    const cls = `ap-node${done && r.reach[i] ? " ap-reach" : ""}${i === net.s || i === net.t ? " ap-terminal" : ""}`;
    return `<g class="${cls}"><circle cx="${x}" cy="${y}" r="${R}"/><text class="ap-name" x="${x}" y="${y + 4.5}" text-anchor="middle">${esc(name)}</text></g>`;
  });
  const aria = done
    ? `The final ${state.view === "flow" ? "flow" : "residual graph"} of value ${r.value}, with the minimum cut of capacity ${r.cutCapacity}.`
    : `${state.view === "flow" ? "Flow" : "Residual graph"} after ${state.step} augmentations, value ${valueAt(r, state.step)}, with the next augmenting path highlighted.`;
  return `<svg class="ap-svg" viewBox="0 0 ${W} ${p.height}" role="img" aria-label="${esc(aria)}">${back.join("")}${front.join("")}${nodes.join("")}</svg>`;
}

export function tally(state: State): string {
  const r = state.run;
  const total = r.augments.length;
  let out = `<span>flow value <b>${valueAt(r, state.step)}</b></span><span>augmentations <b>${state.step}</b> of ${total}</span>`;
  if (state.step === total) out += `<span>cut capacity <b>${r.cutCapacity}</b></span>`;
  return out;
}

function matchingText(state: State): string {
  const p = state.preset;
  const sides = p.sides;
  if (!sides) return "";
  const net = p.net;
  const r = state.run;
  const matched = net.edges.map(([u, v], e) => (sides.x.includes(u) && sides.y.includes(v) && r.flow[e] > 0 ? `${net.names[u]}–${net.names[v]}` : "")).filter(Boolean);
  const cover = [...sides.x.filter((v) => !r.reach[v]), ...sides.y.filter((v) => r.reach[v])].map((v) => net.names[v]);
  return ` The ${matched.length} middle edges with flow, ${matched.join(", ")}, are a maximum matching. The cut's X vertices on the t side and Y vertices on the s side, {${cover.join(", ")}}, form a vertex cover of the same size ${cover.length}, as Kőnig's theorem states.`;
}

export function narration(state: State): string {
  const p = state.preset;
  const net = p.net;
  const r = state.run;
  const total = r.augments.length;
  if (state.step === total) {
    const side = net.names.filter((_, i) => r.reach[i]);
    const edges = r.cut.map((e) => `${edgeName(net, e)} (${cap(net.edges[e][2])})`);
    let text = `No augmenting path remains. Breadth-first search from s reaches only {${side.join(", ")}}, shaded. The edges leaving that set, ${edges.join(" and ")}, have total capacity ${r.cutCapacity}, equal to the flow value ${r.value}, so the flow is maximum and the cut is minimum.`;
    if (p.id === "diamond") {
      const c = net.edges[0][2];
      text += ` Edmonds-Karp used ${total} augmentations and never routed flow through a → b. Augmenting paths that alternate between s → a → b → t and s → b → a → t gain 1 unit each and would take ${2 * c}.`;
    }
    return text + matchingText(state);
  }
  const aug = r.augments[state.step];
  const verts = [net.names[net.s], ...aug.path.map((a) => net.names[arcHead(net, a)])];
  const bottleArc = aug.path.find((a) => residual(net, aug.before, a) === aug.bottleneck) as Arc;
  let text = state.step === 0 ? "No flow yet, so the residual graph is the network itself. " : `Flow value ${valueAt(r, state.step)}. `;
  if (state.step === 0 && net.edges.some(([, , c]) => c >= INF / 2)) text += "Unlabelled arcs have infinite residual capacity. ";
  text += `Breadth-first search finds the shortest augmenting path ${verts.join(" → ")} (${aug.path.length} arcs). Its bottleneck is ${aug.bottleneck}, on ${arcName(net, bottleArc)}.`;
  for (const a of aug.path.filter((x) => x.dir === -1)) {
    text += ` The arc ${arcName(net, a)} is a backward arc: pushing along it cancels ${aug.bottleneck} unit${aug.bottleneck === 1 ? "" : "s"} of flow on ${edgeName(net, a.e)}.`;
  }
  return text;
}

export function stepLabel(state: State): string {
  return `${state.step} / ${state.run.augments.length}`;
}

export function render(props: Props = {}): string {
  const state = initialState(props);
  const p = state.preset;
  return `<figure class="ap" data-preset="${esc(p.id)}">
<div class="ap-chart" data-part="chart">${chart(state)}</div>
<p class="ap-tally" data-part="tally">${tally(state)}</p>
<div class="ap-steps">
<button type="button" name="first" aria-label="Back to the start" disabled>⏮</button>
<button type="button" name="prev" aria-label="Previous augmentation" disabled>◀</button>
<button type="button" name="next" aria-label="Next augmentation" disabled>▶</button>
<button type="button" name="last" aria-label="Finish the run" disabled>⏭</button>
<output name="step">${stepLabel(state)}</output>
<span class="ap-views">
<button type="button" name="residual" aria-pressed="true" disabled>Residual graph</button>
<button type="button" name="flow" aria-pressed="false" disabled>Flow</button>
</span>
</div>
<p class="ap-narration" data-part="narration" aria-live="polite">${narration(state)}</p>
<p class="ap-key"><span><i class="ap-key-path"></i>next augmenting path</span><span><i class="ap-key-back"></i>backward arc</span><span><i class="ap-key-reach"></i>reachable from s</span><span><i class="ap-key-cut"></i>cut edge</span></p>
</figure>`;
}
