// Markup for the alignment table. The build renders the finished table for
// the default strings, with the traceback and the alignment, so the page is
// complete before any script runs; client.ts redraws the same parts with
// these functions as the reader steps, edits the strings or moves a slider.

import { esc } from "../../shared/format";
import {
  DEFAULT_X,
  DEFAULT_Y,
  DIAG,
  LEFT,
  MAX_LEN,
  UP,
  at,
  candidates,
  clean,
  cellOfStep,
  fill,
  filled,
  half,
  held,
  movesAt,
  preferred,
  steps,
  traceback,
  type Alignment,
  type Table,
} from "./model";

export interface State {
  x: string;
  y: string;
  /** Costs in half units. */
  gap: number;
  mismatch: number;
  /** Interior cells filled so far, 0..m*n. */
  step: number;
  twoRows: boolean;
  /** The cell whose candidates the narration shows. */
  inspect: [number, number] | null;
}

export interface Props {
  x?: string;
  y?: string;
}

export function initialState(props: Props = {}): State {
  const x = (typeof props.x === "string" && clean(props.x)) || DEFAULT_X;
  const y = (typeof props.y === "string" && clean(props.y)) || DEFAULT_Y;
  return { x, y, gap: 2, mismatch: 2, step: x.length * y.length, twoRows: false, inspect: null };
}

export interface View {
  table: Table;
  done: boolean;
  aln: Alignment | null;
  /** The cell being explained: the inspected cell, else the last one filled. */
  focus: [number, number] | null;
}

export function view(state: State): View {
  const table = fill(state.x, state.y, state.gap, state.mismatch);
  const done = state.step >= steps(table);
  const aln = done && !state.twoRows ? traceback(table) : null;
  let focus = state.inspect;
  if (!focus && !done && state.step > 0) focus = cellOfStep(table, state.step);
  return { table, done, aln, focus };
}

const ARROW: Record<number, string> = { [DIAG]: "↖", [UP]: "↑", [LEFT]: "←" };
const MOVE_NAME: Record<number, string> = { [DIAG]: "diagonal", [UP]: "up", [LEFT]: "left" };

export function grid(state: State, v: View = view(state)): string {
  const t = v.table;
  const onPath = new Set(v.aln ? v.aln.path.map(([i, j]) => `${i},${j}`) : []);
  const deps = new Map<string, boolean>();
  if (v.focus) for (const c of candidates(t, ...v.focus)) deps.set(`${c.from[0]},${c.from[1]}`, c.best);
  const out: string[] = [];
  const head = (text: string, cls = "") => `<div class="at-head ${cls}">${text}</div>`;
  out.push(head("", "at-corner"), head("ε", "at-eps"));
  for (const c of t.y) out.push(head(esc(c)));
  for (let i = 0; i <= t.m; i++) {
    out.push(head(i === 0 ? "ε" : esc(t.x[i - 1]), i === 0 ? "at-eps" : ""));
    for (let j = 0; j <= t.n; j++) {
      const isFilled = filled(t, state.step, i, j);
      const cls = ["at-cell"];
      let inner = "";
      if (isFilled) {
        const gone = state.twoRows && !held(t, state.step, i);
        if (gone) cls.push("at-gone");
        if (onPath.has(`${i},${j}`)) cls.push("at-path");
        const key = `${i},${j}`;
        if (deps.has(key)) cls.push(deps.get(key) ? "at-win" : "at-dep");
        if (v.focus && v.focus[0] === i && v.focus[1] === j) cls.push("at-focus");
        const arrow = i === 0 && j === 0 ? "" : ARROW[preferred(movesAt(t, i, j))];
        inner = `<span class="at-arrow" aria-hidden="true">${arrow}</span><span class="at-val">${half(at(t, i, j))}</span>`;
      } else {
        cls.push("at-empty");
      }
      const label = isFilled ? `OPT(${i}, ${j})` : `OPT(${i}, ${j}), not filled yet`;
      out.push(`<div class="${cls.join(" ")}" data-i="${i}" data-j="${j}"${isFilled ? ' tabindex="0" role="button"' : ""} aria-label="${label}">${inner}</div>`);
    }
  }
  return `<div class="at-grid" style="--at-cols: ${t.n + 2}" role="group" aria-label="The table OPT(i, j); rows are prefixes of the top string, columns prefixes of the bottom string">${out.join("")}</div>`;
}

const ch = (c: string) => `<code>${esc(c)}</code>`;

export function narration(state: State, v: View = view(state)): string {
  const t = v.table;
  if (v.focus) {
    const [i, j] = v.focus;
    if (i === 0 && j === 0) return "<b>OPT(0, 0) = 0</b>: two empty prefixes align for free.";
    const parts = candidates(t, i, j).map((c) => {
      const what = c.move === DIAG ? (c.add === 0 ? "match" : "mismatch") : "gap";
      const text = `${MOVE_NAME[c.move]} ${half(c.base)} + ${half(c.add)} (${what}) = ${half(c.total)}`;
      return c.best ? `<b>${text}</b>` : text;
    });
    const best = candidates(t, i, j).filter((c) => c.best).map((c) => MOVE_NAME[c.move]);
    const pairText = i > 0 && j > 0 ? `${ch(t.x[i - 1])} against ${ch(t.y[j - 1])}` : i === 0 ? `nothing against ${ch(t.y.slice(0, j))}` : `${ch(t.x.slice(0, i))} against nothing`;
    const tie = best.length > 1 ? `, a tie between ${best.join(" and ")}; the traceback prefers the first` : `, from the ${best[0]}`;
    return `<b>OPT(${i}, ${j}) = ${half(at(t, i, j))}</b>, ${pairText}: ${parts.join("; ")}. Minimum ${half(at(t, i, j))}${tie}.`;
  }
  if (state.step === 0)
    return "Row 0 and column 0 are the base cases: aligning a prefix against nothing costs one gap per character. Press <b>Step</b> to fill the first cell from its three neighbours.";
  if (state.twoRows)
    return `<b>Cost ${half(at(t, t.m, t.n))}</b>. A two-row implementation now holds only the last two rows: the cost survives, but the cells the traceback walks through are gone. Hirschberg's algorithm recomputes them by divide and conquer.`;
  return `<b>Cost ${half(at(t, t.m, t.n))}</b>. The shaded cells are the traceback: from the bottom-right corner, each step goes back the way that cell's minimum came, diagonal first on ties. Select a cell to see its three candidates.`;
}

export function alignmentBlock(state: State, v: View = view(state)): string {
  if (!v.done) return `<p class="at-dim">The alignment appears when the table is full.</p>`;
  if (!v.aln) return `<p class="at-dim">No alignment: two rows hold the cost but not the path back.</p>`;
  const a = v.aln;
  const cols = (row: string) =>
    Array.from(row)
      .map((c, k) => `<span class="at-k-${a.kinds[k]}">${esc(c)}</span>`)
      .join("");
  const marks = a.kinds.map((k) => (k === "match" ? "|" : k === "mismatch" ? "·" : " ")).join("");
  const sum = `${a.mismatches} mismatch${a.mismatches === 1 ? "" : "es"} × ${half(state.mismatch)} + ${a.gaps} gap${a.gaps === 1 ? "" : "s"} × ${half(state.gap)} = ${half(at(v.table, v.table.m, v.table.n))}`;
  return `<pre class="at-pre" aria-label="Alignment: ${esc(a.top)} over ${esc(a.bottom)}">${cols(a.top)}\n${marks}\n${cols(a.bottom)}</pre><p class="at-sum">${a.matches} match${a.matches === 1 ? "" : "es"}, ${sum}</p>`;
}

export function stats(state: State, v: View = view(state)): string {
  const t = v.table;
  const total = (t.m + 1) * (t.n + 1);
  const heldCells = state.twoRows ? Math.min(total, 2 * (t.n + 1)) : total;
  return `Filled ${Math.min(state.step, steps(t))} of ${steps(t)} cells · in memory: ${heldCells} of ${total} cells${state.twoRows ? " (two rows)" : " (full table)"}`;
}

const slider = (name: string, label: string, value: number, min: number) =>
  `<label class="at-slider"><span>${label} <output name="${name}-out">${half(value)}</output></span><input type="range" name="${name}" min="${min}" max="8" step="1" value="${value}" disabled></label>`;

const word = (name: string, label: string, value: string) =>
  `<label class="at-word"><span>${label}</span><input type="text" name="${name}" value="${esc(value)}" maxlength="${MAX_LEN}" autocomplete="off" autocapitalize="off" spellcheck="false" disabled></label>`;

export function render(props: Props = {}): string {
  const state = initialState(props);
  const v = view(state);
  return [
    `<figure class="at" data-x="${esc(state.x)}" data-y="${esc(state.y)}">`,
    `<form class="at-controls" onsubmit="return false">`,
    word("x", "Top string <i>x</i> (rows)", state.x),
    word("y", "Bottom string <i>y</i> (columns)", state.y),
    slider("gap", "Gap cost δ", state.gap, 1),
    slider("mismatch", "Mismatch cost α", state.mismatch, 0),
    `</form>`,
    `<div class="at-buttons">`,
    `<button type="button" name="reset" disabled>Reset</button>`,
    `<button type="button" name="step" disabled>Step</button>`,
    `<button type="button" name="play" disabled>Play</button>`,
    `<button type="button" name="fill" disabled>Fill</button>`,
    `<label class="at-check"><input type="checkbox" name="tworows" disabled> Keep two rows</label>`,
    `</div>`,
    `<div class="at-scroll" data-part="grid">${grid(state, v)}</div>`,
    `<p class="at-narration" data-part="narration" aria-live="polite">${narration(state, v)}</p>`,
    `<div class="at-aln" data-part="alignment">${alignmentBlock(state, v)}</div>`,
    `<p class="at-stats" data-part="stats">${stats(state, v)}</p>`,
    `<figcaption>The recurrence from this section, run in your browser. Row <i>i</i> and column <i>j</i> hold OPT(<i>i</i>, <i>j</i>), the cheapest alignment of the first <i>i</i> characters of <i>x</i> with the first <i>j</i> of <i>y</i>; the arrow in each cell is the move its minimum came from. The default pair is the example from Kleinberg and Tardos. Up to ${MAX_LEN} letters per string.</figcaption>`,
    `</figure>`,
  ].join("");
}
