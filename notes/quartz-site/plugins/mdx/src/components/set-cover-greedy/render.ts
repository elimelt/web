// Markup for the greedy set cover figure. The build renders the finished run;
// the client redraws the same parts with these functions as the reader steps.

import { esc } from "../../shared/format";
import { fraction, greedy, harmonic, optimum, preset, prices, type Instance, type Pick } from "./model";

export interface Props {
  preset?: string;
}

export interface State {
  id: string;
  inst: Instance;
  showPrices: boolean;
  picks: Pick[];
  opt: { cost: number; sets: number[] };
  step: number;
}

export function initialState(props: Props = {}): State {
  const p = preset(props.preset);
  const picks = greedy(p.instance);
  return { id: p.id, inst: p.instance, showPrices: p.prices, picks, opt: optimum(p.instance), step: picks.length };
}

const W = 600;
const money = (x: number): string => x.toFixed(2);
const spansAllRows = (inst: Instance, j: number) => inst.sets[j].rect[0] === 0 && inst.sets[j].rect[1] === inst.rows - 1;

interface Geo {
  left: number;
  top: number;
  cell: number;
  H: number;
}

function geometry(inst: Instance): Geo {
  const left = inst.rows > 1 ? 66 : 8;
  const brackets = inst.sets.filter((_, j) => spansAllRows(inst, j) && inst.sets[j].cells.length > 1).length;
  const top = brackets ? 40 : 8;
  const cell = Math.min(56, (W - left - 8) / inst.cols);
  const below = inst.sets.some((s) => s.cells.length === 1) ? 26 : 6;
  return { left, top, cell, H: top + inst.rows * cell + below };
}

export function chart(state: State): string {
  const { inst } = state;
  const g = geometry(inst);
  const owner = new Map<number, number>();
  state.picks.slice(0, state.step).forEach((p, k) => p.covered.forEach((e) => owner.set(e, k)));
  const price = prices(state.picks, state.step);
  const parts: string[] = [];
  // Brackets above the grid for sets that span every row.
  inst.sets.forEach((s, j) => {
    if (!spansAllRows(inst, j) || s.cells.length === 1) return;
    const x0 = g.left + s.rect[2] * g.cell + 3;
    const x1 = g.left + (s.rect[3] + 1) * g.cell - 3;
    const y = g.top - 8;
    const picked = state.picks.slice(0, state.step).findIndex((p) => p.set === j);
    const cls = picked >= 0 ? " sg-picked" : "";
    const label = x1 - x0 > 70 ? s.name : s.name.replace("Block ", "B");
    parts.push(
      `<g class="sg-bracket${cls}"><path d="M${x0} ${y + 5}V${y}H${x1}V${y + 5}"/>` +
        `<text x="${(x0 + x1) / 2}" y="${y - 6}" text-anchor="middle">${esc(label)}</text></g>`,
    );
  });
  // Row labels on the left for sets that are one whole row.
  inst.sets.forEach((s, j) => {
    if (inst.rows === 1 || s.rect[0] !== s.rect[1]) return;
    const y = g.top + (s.rect[0] + 0.5) * g.cell + 4;
    const opt = state.opt.sets.includes(j) ? " sg-opt" : "";
    parts.push(`<text class="sg-rowname${opt}" x="${g.left - 8}" y="${y}" text-anchor="end">${esc(s.name.replace(" row", ""))}</text>`);
  });
  // The elements.
  for (let r = 0; r < inst.rows; r++) {
    for (let c = 0; c < inst.cols; c++) {
      const e = r * inst.cols + c;
      const x = g.left + c * g.cell;
      const y = g.top + r * g.cell;
      const k = owner.get(e);
      const cls = k === undefined ? "sg-open" : k === state.step - 1 ? "sg-new" : "sg-done";
      const text = k === undefined ? "" : state.showPrices ? fraction(price.get(e)!) : String(k + 1);
      const size = text.length > 3 ? " sg-small" : "";
      parts.push(
        `<g class="sg-cell ${cls}"><rect x="${x + 2}" y="${y + 2}" width="${g.cell - 4}" height="${g.cell - 4}" rx="4"/>` +
          (text ? `<text class="${size.trim()}" x="${x + g.cell / 2}" y="${y + g.cell / 2 + 4}" text-anchor="middle">${text}</text>` : "") +
          `</g>`,
      );
    }
  }
  // Costs under singletons.
  inst.sets.forEach((s) => {
    if (s.cells.length !== 1) return;
    const e = s.cells[0];
    const x = g.left + ((e % inst.cols) + 0.5) * g.cell;
    const y = g.top + (Math.floor(e / inst.cols) + 1) * g.cell + 16;
    parts.push(`<text class="sg-cost" x="${x}" y="${y}" text-anchor="middle">${fraction(s.cost)}</text>`);
  });
  const n = inst.rows * inst.cols;
  const aria = `${n} elements and ${inst.sets.length} sets. After ${state.step} greedy picks, ${owner.size} elements are covered.`;
  return `<svg class="sg-svg" viewBox="0 0 ${W} ${g.H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

/** The comparison greedy made for the current pick (or is about to make, at step 0). */
export function table(state: State): string {
  const { inst } = state;
  const k = Math.max(0, state.step - 1);
  const pick = state.picks[k];
  if (!pick) return "";
  const chosen = state.step > 0 ? pick.set : -1;
  const head = inst.weighted ? `<th>Set</th><th>Cost</th><th>New</th><th>Cost per new</th>` : `<th>Set</th><th>New elements</th>`;
  const rows = inst.sets
    .map((s, j) => {
      const f = pick.fresh[j];
      const picked = state.picks.slice(0, state.step - (state.step > 0 ? 1 : 0)).some((p) => p.set === j);
      const cls = j === chosen ? ` class="sg-chosen"` : picked || f === 0 ? ` class="sg-idle"` : "";
      const per = f ? money(s.cost / f) : "–";
      return inst.weighted
        ? `<tr${cls}><td>${esc(s.name)}</td><td>${s.cells.length === 1 ? fraction(s.cost) : money(s.cost)}</td><td>${f}</td><td>${per}</td></tr>`
        : `<tr${cls}><td>${esc(s.name)}</td><td>${f}</td></tr>`;
    })
    .join("");
  const caption = state.step === 0 ? "What greedy compares for its first pick" : `What greedy compared for pick ${state.step}`;
  return `<p class="sg-tcap">${caption}</p><table class="sg-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function tally(state: State): string {
  const done = state.picks.slice(0, state.step);
  const cost = done.reduce((a, p) => a + state.inst.sets[p.set].cost, 0);
  const optNames = state.opt.sets.map((j) => state.inst.sets[j].name).join(" + ");
  const greedyPart = state.inst.weighted ? `greedy paid <b>${money(cost)}</b> for ${done.length} sets` : `greedy <b>${done.length}</b> sets`;
  const optPart = state.inst.weighted ? `optimum <b>${money(state.opt.cost)}</b> (${esc(optNames)})` : `optimum <b>${state.opt.sets.length}</b> (${esc(optNames)})`;
  return `<span>${greedyPart}</span><span>${optPart}</span>`;
}

export function narration(state: State): string {
  const { inst, picks } = state;
  if (state.step === 0) return `Nothing picked yet. Greedy repeatedly takes the set with the ${inst.weighted ? "lowest cost per newly covered element" : "most uncovered elements"}.`;
  const p = picks[state.step - 1];
  const s = inst.sets[p.set];
  const f = p.covered.length;
  // The best set greedy passed over.
  let alt = -1;
  let altVal = Infinity;
  p.fresh.forEach((g, j) => {
    if (!g || j === p.set) return;
    const v = inst.sets[j].cost / g;
    if (v < altVal) {
      alt = j;
      altVal = v;
    }
  });
  let text = `Pick ${state.step}: ${esc(s.name)} `;
  if (inst.weighted) {
    text += `costs ${fraction(s.cost)} for ${f} new element${f === 1 ? "" : "s"}, ${money(p.price)} each.`;
    if (alt >= 0) text += ` The best alternative, ${esc(inst.sets[alt].name)}, would cost ${money(altVal)} per element.`;
  } else {
    text += `covers ${f} new element${f === 1 ? "" : "s"}.`;
    if (alt >= 0) text += ` The best alternative, ${esc(inst.sets[alt].name)}, would cover ${p.fresh[alt]}.`;
  }
  if (state.showPrices) text += ` Each newly covered element is charged ${fraction(p.price)}, so this pick's charges add up to ${inst.weighted ? `its cost, ${fraction(s.cost)}` : "1"}.`;
  if (state.step === picks.length) text += " " + summary(state);
  return text;
}

function summary(state: State): string {
  const { inst, picks, opt } = state;
  if (inst.weighted) {
    const paid = picks.reduce((a, p) => a + inst.sets[p.set].cost, 0);
    return `Greedy paid ${money(paid)} = H<sub>${inst.cols}</sub>, while ${esc(inst.sets[opt.sets[0]].name)} alone costs ${money(opt.cost)}.`;
  }
  if (!state.showPrices) return `Greedy finished with ${picks.length} sets. The two rows alone cover everything.`;
  const price = prices(picks, picks.length);
  const per = opt.sets.map((j) => {
    const sum = inst.sets[j].cells.reduce((a, e) => a + (price.get(e) ?? 0), 0);
    return `${esc(inst.sets[j].name)} ${money(sum)}`;
  });
  const d = Math.max(...opt.sets.map((j) => inst.sets[j].cells.length));
  return `The charges add up to ${picks.length}, the number of sets greedy used. Inside each optimal set they add up to at most H<sub>${d}</sub> = ${money(harmonic(d))} (here ${per.join(", ")}), so greedy uses at most ${opt.sets.length} × ${money(harmonic(d))} sets.`;
}

export function stepLabel(state: State): string {
  return `${state.step} / ${state.picks.length}`;
}

export function render(props: Props = {}): string {
  const state = initialState(props);
  return `<figure class="sg" data-preset="${esc(state.id)}">
<div class="sg-chart" data-part="chart">${chart(state)}</div>
<p class="sg-tally" data-part="tally">${tally(state)}</p>
<div class="sg-steps">
<button type="button" name="first" aria-label="Back to the start" disabled>⏮</button>
<button type="button" name="prev" aria-label="Previous pick" disabled>◀</button>
<button type="button" name="next" aria-label="Next pick" disabled>▶</button>
<button type="button" name="last" aria-label="Finish the run" disabled>⏭</button>
<output name="step">${stepLabel(state)}</output>
</div>
<p class="sg-narration" data-part="narration" aria-live="polite">${narration(state)}</p>
<div class="sg-detail" data-part="table">${table(state)}</div>
</figure>`;
}
