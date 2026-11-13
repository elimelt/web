// Markup for the interval-greedy figure. The build renders it from a preset
// with the run finished, so the page shows a complete result before any
// script loads; the client redraws the same parts with these functions as the
// reader edits the input or steps through the run.

import {
  commonTime,
  depthProfile,
  HORIZON,
  label,
  optima,
  ORDERS,
  PRESETS,
  RULES,
  runPartition,
  runSchedule,
  conflictCounts,
  stabTimes,
  staysAhead,
  type Interval,
  type Mode,
  type Order,
  type Rule,
} from "./model";

export interface State {
  intervals: Interval[];
  mode: Mode;
  rule: Rule;
  order: Order;
  /** Intervals processed so far, 0..n. */
  step: number;
  /** Which optimal subset the stays-ahead table compares against. */
  optimum: number;
  selected: number | null;
  /** Drawing width in CSS pixels; the client measures it. */
  width: number;
  /** While dragging, rows keep the order they had when the drag began. */
  frozenOrder?: number[];
}

export interface Props {
  preset?: string;
}

export function initialState(props: Props = {}): State {
  const preset = PRESETS.find((p) => p.id === props.preset) ?? PRESETS[0];
  const intervals = preset.intervals.map((a) => ({ ...a }));
  return {
    intervals,
    mode: preset.mode,
    rule: preset.mode === "schedule" ? (preset.rule as Rule) : "finish",
    order: preset.mode === "partition" ? (preset.rule as Order) : "start",
    step: intervals.length,
    optimum: 0,
    selected: null,
    width: 640,
  };
}

const span = (a: Interval): string => `[${a.s}, ${a.f})`;
const name = (iv: Interval[], i: number): string => `<b>${label(i)}</b> ${span(iv[i])}`;
const list = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const ruleName = (r: Rule): string => RULES.find((x) => x.id === r)!.name.toLowerCase();

interface Geometry {
  W: number;
  left: number;
  plot: number;
  x: (t: number) => number;
  rowH: number;
  barH: number;
}

function geometry(width: number): Geometry {
  const W = Math.max(300, Math.round(width));
  const left = 26;
  const plot = W - left - 10;
  return { W, left, plot, x: (t) => left + (t / HORIZON) * plot, rowH: 24, barH: 16 };
}

function axis(g: Geometry, y: number): string {
  const every = g.W < 440 ? 4 : 2;
  const parts: string[] = [];
  for (let t = 0; t <= HORIZON; t += every) {
    parts.push(
      `<line class="ig-grid" x1="${g.x(t)}" x2="${g.x(t)}" y1="${y + 4}" y2="${y + 8}"/>`,
      `<text class="ig-tick" x="${g.x(t)}" y="${y}" text-anchor="middle">${t}</text>`,
    );
  }
  return parts.join("");
}

function bar(g: Geometry, a: Interval, y: number, cls: string, text: string, attrs = ""): string {
  const x0 = g.x(a.s);
  const w = Math.max(2, g.x(a.f) - x0);
  const inside = w >= 18 && text ? `<text class="ig-in" x="${x0 + w / 2}" y="${y + g.barH / 2 + 4}" text-anchor="middle">${text}</text>` : "";
  return `<g class="ig-bar ${cls}" ${attrs}><rect x="${x0}" y="${y}" width="${w}" height="${g.barH}" rx="3"/>${inside}</g>`;
}

function rowBar(g: Geometry, state: State, i: number, y: number, cls: string): string {
  const a = state.intervals[i];
  const sel = state.selected === i ? " ig-selected" : "";
  const attrs = `data-i="${i}" tabindex="0" role="button" aria-label="Interval ${label(i)} from ${a.s} to ${a.f}. Drag to move, drag an end to resize; arrow keys move it, shift and arrow keys change its finish."`;
  return (
    `<text class="ig-label" x="${g.left - 8}" y="${y + g.barH / 2 + 4}" text-anchor="end">${label(i)}</text>` +
    bar(g, a, y, `ig-edit${sel} ${cls}`, "", attrs) +
    `<rect class="ig-handle" data-i="${i}" data-end="s" x="${g.x(a.s) - 6}" y="${y - 2}" width="10" height="${g.barH + 4}"/>` +
    `<rect class="ig-handle" data-i="${i}" data-end="f" x="${g.x(a.f) - 4}" y="${y - 2}" width="10" height="${g.barH + 4}"/>`
  );
}

function laneTitle(g: Geometry, y: number, text: string): string {
  return `<text class="ig-lane" x="${g.left}" y="${y}">${text}</text>`;
}

export function scheduleChart(state: State): string {
  const g = geometry(state.width);
  const iv = state.intervals;
  const run = runSchedule(iv, state.rule);
  const rows = state.frozenOrder ?? run.order;
  const best = optima(iv);
  const opt = best.sets[state.optimum % Math.max(1, best.sets.length)] ?? [];
  const done = run.steps.slice(0, state.step);
  const status = new Map(done.map((s) => [s.index, s]));
  const current = state.step > 0 ? run.steps[state.step - 1] : null;
  const parts: string[] = [axis(g, 14)];
  const top = 26;
  rows.forEach((i, r) => {
    const s = status.get(i);
    const cls = !s ? "ig-pending" : s.kept ? "ig-kept" : "ig-skip";
    parts.push(rowBar(g, state, i, top + r * g.rowH, `${cls}${current?.index === i ? " ig-current" : ""}`));
  });
  if (current && !current.kept && current.blocker !== null) {
    const r = rows.indexOf(current.blocker);
    if (r >= 0) parts.push(`<rect class="ig-ring" x="${g.x(iv[current.blocker].s) - 3}" y="${top + r * g.rowH - 3}" width="${g.x(iv[current.blocker].f) - g.x(iv[current.blocker].s) + 6}" height="${g.barH + 6}" rx="5"/>`);
  }
  let y = top + rows.length * g.rowH + 14;
  const kept = done.filter((s) => s.kept).map((s) => s.index);
  parts.push(laneTitle(g, y, `Greedy keeps ${kept.length}${state.step < iv.length ? " so far" : ""}`));
  y += 6;
  for (const i of kept) parts.push(bar(g, iv[i], y, "ig-kept", label(i)));
  y += g.rowH + 14;
  parts.push(laneTitle(g, y, `Optimum: ${best.size}, found by checking all ${2 ** iv.length} subsets`));
  y += 6;
  for (const i of opt) parts.push(bar(g, iv[i], y, "ig-opt", label(i)));
  y += g.rowH;
  if (state.rule === "finish" && state.step === iv.length) {
    for (const t of stabTimes(iv, run.kept)) {
      parts.push(`<line class="ig-stab" x1="${g.x(t) - 1}" x2="${g.x(t) - 1}" y1="${top - 4}" y2="${top + rows.length * g.rowH - 4}"/>`);
    }
  }
  const aria = `${iv.length} intervals scanned by ${ruleName(state.rule)}. Greedy keeps ${run.kept.map(label).join(", ") || "none"} (${run.kept.length}); an optimal choice is ${opt.map(label).join(", ")} (${best.size}).`;
  return `<svg class="ig-svg" viewBox="0 0 ${g.W} ${y + 4}" width="${g.W}" height="${y + 4}" role="img" aria-label="${aria}">${parts.join("")}</svg>`;
}

export function partitionChart(state: State): string {
  const g = geometry(state.width);
  const iv = state.intervals;
  const run = runPartition(iv, state.order);
  const rows = state.frozenOrder ?? run.order;
  const done = run.steps.slice(0, state.step);
  const room = new Map(done.map((s) => [s.index, s.room]));
  const current = state.step > 0 ? run.steps[state.step - 1] : null;
  const blockers = new Set(current?.opened ? current.blockers : []);
  const profile = depthProfile(iv);
  const parts: string[] = [axis(g, 14)];
  const top = 26;
  rows.forEach((i, r) => {
    const y = top + r * g.rowH;
    const placed = room.get(i);
    const cls = placed === undefined ? "ig-pending" : "ig-kept";
    const extra = (current?.index === i ? " ig-current" : "") + (blockers.has(i) ? " ig-blocker" : "");
    parts.push(rowBar(g, state, i, y, cls + extra));
    if (placed !== undefined) {
      const x = g.x(iv[i].f) + 8;
      const anchor = x > g.W - 30 ? `x="${g.x(iv[i].s) - 8}" text-anchor="end"` : `x="${x}"`;
      parts.push(`<text class="ig-tick" ${anchor} y="${y + g.barH / 2 + 4}">room ${placed + 1}</text>`);
    }
  });
  let y = top + rows.length * g.rowH + 14;
  const roomsUsed = Math.max(0, ...done.map((s) => s.room + 1));
  parts.push(laneTitle(g, y, `First fit uses ${roomsUsed} room${roomsUsed === 1 ? "" : "s"}${state.step < iv.length ? " so far" : ""}`));
  y += 6;
  const lanesTop = y;
  for (let r = 0; r < roomsUsed; r++) {
    parts.push(`<text class="ig-label" x="${g.left - 8}" y="${y + g.barH / 2 + 4}" text-anchor="end">${r + 1}</text>`);
    for (const s of done.filter((d) => d.room === r)) {
      const cls = "ig-kept" + (current?.index === s.index ? " ig-current" : "") + (blockers.has(s.index) ? " ig-blocker" : "");
      parts.push(bar(g, iv[s.index], y, cls, label(s.index)));
    }
    y += g.rowH;
  }
  if (current?.opened && current.blockers.length) {
    const t = iv[current.index].s;
    parts.push(`<line class="ig-witness" x1="${g.x(t)}" x2="${g.x(t)}" y1="${top - 4}" y2="${y - 6}"/>`);
  }
  y += 10;
  parts.push(laneTitle(g, y, `Depth: at most ${profile.max} interval${profile.max === 1 ? "" : "s"} overlap at any moment`));
  y += 6;
  const h = 30;
  const unit = h / Math.max(1, profile.max);
  profile.depth.forEach((d, t) => {
    if (d) parts.push(`<rect class="ig-depth${d === profile.max ? " ig-depth-max" : ""}" x="${g.x(t) + 0.5}" y="${y + h - d * unit}" width="${g.x(t + 1) - g.x(t) - 1}" height="${d * unit}"><title>${d} at [${t}, ${t + 1})</title></rect>`);
  });
  y += h + 4;
  void lanesTop;
  const aria = `${iv.length} intervals placed by first fit in ${ORDERS.find((o) => o.id === state.order)!.name.toLowerCase()} order, using ${run.rooms.length} rooms; the depth is ${profile.max}.`;
  return `<svg class="ig-svg" viewBox="0 0 ${g.W} ${y}" width="${g.W}" height="${y}" role="img" aria-label="${aria}">${parts.join("")}</svg>`;
}

export function narration(state: State): string {
  const iv = state.intervals;
  const n = iv.length;
  if (n === 0) return "No intervals. Add one to start.";
  if (state.mode === "schedule") {
    const run = runSchedule(iv, state.rule);
    if (state.step === 0) return `Nothing scanned yet. ${RULES.find((r) => r.id === state.rule)!.name} scans the rows from top to bottom and keeps each interval that overlaps nothing it already kept.`;
    const step = run.steps[state.step - 1];
    const counts = state.rule === "conflicts" ? ` It overlaps ${conflictCounts(iv)[step.index]} other intervals in the input.` : "";
    const verdict = step.kept
      ? "It overlaps nothing kept so far, so greedy keeps it."
      : `It overlaps ${name(iv, step.blocker!)}, which greedy already kept, so it is skipped.`;
    let text = `Step ${state.step} of ${n}: ${name(iv, step.index)}.${counts} ${verdict}`;
    if (state.step === n) {
      const best = optima(iv, 1).size;
      text += run.kept.length === best ? ` Greedy finishes with ${best}, the optimum.` : ` Greedy finishes with ${run.kept.length}; the optimum is ${best}.`;
      if (state.rule === "finish") text += ` The dashed lines are the proof: each sits just before a kept interval ends, every interval crosses one, and ${run.kept.length} disjoint intervals need ${run.kept.length} different lines, so no answer beats ${run.kept.length}.`;
    }
    return text;
  }
  const run = runPartition(iv, state.order);
  const profile = depthProfile(iv);
  if (state.step === 0) return `Nothing placed yet. First fit takes the rows from top to bottom and puts each interval in the lowest-numbered room where it overlaps nothing.`;
  const step = run.steps[state.step - 1];
  let text = `Step ${state.step} of ${n}: ${name(iv, step.index)} `;
  if (!step.opened) text += `fits in room ${step.room + 1}.`;
  else if (step.blockers.length === 0) text += "opens room 1.";
  else {
    const who = step.blockers.map((b, r) => `${name(iv, b)} in room ${r + 1}`);
    text += `overlaps ${list(who)}, so it opens room ${step.room + 1}. `;
    const ids = [...step.blockers, step.index];
    const t = commonTime(iv, ids);
    text +=
      t !== null
        ? `${ids.length === 2 ? "Both" : `All ${ids.length}`} contain time ${t}, so ${ids.length} intervals overlap there and no assignment can use fewer than ${ids.length} rooms.`
        : `They don't all overlap at one moment, so nothing forces a room ${step.room + 1}${profile.max < step.room + 1 ? `: the depth is only ${profile.max}` : ""}.`;
  }
  if (state.step === n) {
    text += run.rooms.length === profile.max ? ` Done: ${run.rooms.length} rooms, equal to the depth, so no assignment uses fewer.` : ` Done: ${run.rooms.length} rooms, but the depth is ${profile.max}, so ${profile.max} would do.`;
  }
  return text;
}

/** The stays-ahead table, or nothing in partition mode. */
export function detail(state: State): string {
  if (state.mode !== "schedule" || state.intervals.length === 0) return "";
  const iv = state.intervals;
  const run = runSchedule(iv, state.rule);
  const best = optima(iv);
  const k = state.optimum % Math.max(1, best.sets.length);
  const opt = best.sets[k] ?? [];
  const { rows, firstFailure } = staysAhead(iv, run.kept, opt);
  const cell = (i: number | null) => (i === null ? "–" : `${label(i)} ends at ${iv[i].f}`);
  const body = rows
    .map((row) => {
      const mark = row.holds === null ? "–" : row.holds ? "yes" : "no";
      const cls = row.r === firstFailure ? ` class="ig-fail"` : "";
      return `<tr${cls}><td>${row.r}</td><td>${cell(row.greedy)}</td><td>${cell(row.optimum)}</td><td>${mark}</td></tr>`;
    })
    .join("");
  const which = best.total > 1 ? `optimal choice ${k + 1} of ${best.total}` : "the only optimal choice";
  let summary: string;
  if (firstFailure !== null) {
    const row = rows[firstFailure - 1];
    summary = `The lemma fails at <i>r</i> = ${firstFailure}: greedy's ${ordinal(firstFailure)} interval ends at ${iv[row.greedy!].f}, after the optimum's ends at ${iv[row.optimum!].f}.`;
    if (run.kept.length < best.size) summary += " A rule that loses must fail this check against every optimal choice; try the others.";
  } else if (run.kept.length < best.size) {
    summary = "";
  } else {
    summary = state.rule === "finish" ? "The lemma holds in every row, as the proof says it must for every optimal choice." : `The lemma holds here, but nothing guarantees it for ${ruleName(state.rule)}.`;
  }
  const next = best.total > 1 ? `<button type="button" name="next-optimum" disabled>Compare with another optimum</button>` : "";
  return (
    `<div class="ig-detail-head"><span>Greedy stays ahead? Greedy's picks and ${which}, each sorted by finish time, for the finished run.</span>${next}</div>` +
    `<table class="ig-table"><thead><tr><th><i>r</i></th><th>Greedy's <i>r</i>th</th><th>Optimum's <i>r</i>th</th><th><i>f</i>(<i>i<sub>r</sub></i>) ≤ <i>f</i>(<i>j<sub>r</sub></i>)</th></tr></thead><tbody>${body}</tbody></table>` +
    (summary ? `<p class="ig-summary">${summary}</p>` : "")
  );
}

const ordinal = (r: number): string => `${r}${r % 10 === 1 && r !== 11 ? "st" : r % 10 === 2 && r !== 12 ? "nd" : r % 10 === 3 && r !== 13 ? "rd" : "th"}`;

export function chart(state: State): string {
  return state.mode === "schedule" ? scheduleChart(state) : partitionChart(state);
}

export function stepLabel(state: State): string {
  return `${state.step} / ${state.intervals.length}`;
}

export function render(props: Props = {}): string {
  const state = initialState(props);
  const tab = (mode: Mode, text: string) =>
    `<button type="button" role="tab" name="mode" value="${mode}" aria-selected="${state.mode === mode}" disabled>${text}</button>`;
  const ruleOptions = RULES.map((r) => `<option value="${r.id}"${r.id === state.rule ? " selected" : ""}>${r.name}</option>`).join("");
  const orderOptions = ORDERS.map((o) => `<option value="${o.id}"${o.id === state.order ? " selected" : ""}>${o.name}</option>`).join("");
  const presetOptions = PRESETS.map((p) => `<option value="${p.id}"${p.id === (props.preset ?? PRESETS[0].id) ? " selected" : ""}>${p.name}</option>`).join("");
  return `<figure class="ig" data-preset="${props.preset ?? PRESETS[0].id}" data-mode="${state.mode}">
<div class="ig-tabs" role="tablist" aria-label="Problem">${tab("schedule", "Keep the most intervals")}${tab("partition", "Fit all in the fewest rooms")}</div>
<div class="ig-controls">
<label class="ig-field ig-only-schedule">Greedy rule <select name="rule" disabled>${ruleOptions}</select></label>
<label class="ig-field ig-only-partition">Processing order <select name="order" disabled>${orderOptions}</select></label>
<label class="ig-field">Input <select name="preset" disabled>${presetOptions}<option value="edited" hidden>Your edits</option></select></label>
</div>
<div class="ig-buttons">
<button type="button" name="add" disabled>Add interval</button>
<button type="button" name="remove" disabled>Remove selected</button>
<button type="button" name="random" disabled>Random input</button>
<button type="button" name="search" disabled>Find an input where this rule loses</button>
</div>
<div class="ig-chart" data-part="chart">${chart(state)}</div>
<div class="ig-steps">
<button type="button" name="first" aria-label="Back to the start" disabled>⏮</button>
<button type="button" name="prev" aria-label="Previous step" disabled>◀</button>
<button type="button" name="play" disabled>Play</button>
<button type="button" name="next" aria-label="Next step" disabled>▶</button>
<button type="button" name="last" aria-label="Finish the run" disabled>⏭</button>
<output name="step">${stepLabel(state)}</output>
</div>
<p class="ig-narration" data-part="narration" aria-live="polite">${narration(state)}</p>
<div class="ig-detail" data-part="detail">${detail(state)}</div>
<p class="ig-status" data-part="status" aria-live="polite"></p>
</figure>`;
}
