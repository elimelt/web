// Build-time markup and the pure drawing functions of the skip list and treap figure.

import { esc, num } from "../../shared/format";
import { mulberry32 } from "../../shared/random";
import titlesJson from "../../../../../../content/algorithms/probabilistic/search-structure-experiments/titles.json";
import { SMALL, harmonicTable, run, skipExpected, treapExpected, treapPath, type Run, type Step } from "./model";

export const DATA = titlesJson as { titles: string[]; order: number[]; eligible: number };
export const PS = [0.5, 0.25];

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const short = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** The drawn skip list, one row per key in sorted order, levels left to right, with the search for key m. */
export function skipChart(v: Run, m: number, narrow: boolean): string {
  const s = v.smallSkip;
  const W = 340;
  const labelW = narrow ? 150 : 170;
  const top = 18;
  const rowH = 17;
  const H = top + (SMALL + 1) * rowH + 4;
  const col = Math.min(16, (W - labelW - 8) / s.height);
  const cx = (i: number) => labelW + 6 + col * i + col / 2;
  const cy = (row: number) => top + row * rowH + rowH / 2; // row 0 is the head, key k is row k + 1
  const steps: Step[] = [];
  const cost = s.search(m, steps);
  const moved = new Set(steps.filter((st) => st.moved).map((st) => `${st.level}:${st.key}`));
  const stopped = new Set(steps.filter((st) => !st.moved).map((st) => `${st.level}:${st.key}`));
  const parts: string[] = [];
  for (let i = 0; i < s.height; i++) {
    parts.push(`<text class="st-tick" x="${cx(i).toFixed(1)}" y="11" text-anchor="middle">${i + 1}</text>`);
    // The level-i list: from the head down through every key taller than i.
    let prev = 0;
    for (let k = 0; k < SMALL; k++) {
      if (s.lv[k] > i) {
        parts.push(`<line class="st-link" x1="${cx(i).toFixed(1)}" x2="${cx(i).toFixed(1)}" y1="${cy(prev).toFixed(1)}" y2="${cy(k + 1).toFixed(1)}"/>`);
        prev = k + 1;
      }
    }
  }
  // The search path: down each level's list, then one level to the left.
  const pts: string[] = [];
  let row = 0;
  for (let i = s.height - 1; i >= 0; i--) {
    pts.push(`${cx(i).toFixed(1)},${cy(row).toFixed(1)}`);
    for (const st of steps) if (st.level === i && st.moved) row = st.key + 1;
    pts.push(`${cx(i).toFixed(1)},${cy(row).toFixed(1)}`);
  }
  pts.push(`${cx(0).toFixed(1)},${cy(m + 1).toFixed(1)}`);
  parts.push(`<polyline class="st-path" points="${pts.join(" ")}"/>`);
  const box = (x: number, y: number, cls: string) =>
    `<rect class="${cls}" x="${(x - col / 2 + 1.5).toFixed(1)}" y="${(y - rowH / 2 + 2).toFixed(1)}" width="${(col - 3).toFixed(1)}" height="${rowH - 4}" rx="2"/>`;
  for (let i = 0; i < s.height; i++) parts.push(box(cx(i), cy(0), "st-box st-head"));
  parts.push(`<text class="st-label" x="${labelW}" y="${(cy(0) + 4).toFixed(1)}" text-anchor="end">head</text>`);
  for (let k = 0; k < SMALL; k++) {
    const title = DATA.titles[v.smallKeys[k]];
    parts.push(`<text class="st-label${k === m ? " st-target" : ""}" x="${labelW}" y="${(cy(k + 1) + 4).toFixed(1)}" text-anchor="end"><tspan class="st-num">${k + 1} </tspan>${esc(short(title, narrow ? 21 : 24))}<title>${esc(title)}</title></text>`);
    for (let i = 0; i < s.lv[k]; i++) {
      const key = `${i}:${k}`;
      const cls = moved.has(key) ? "st-box st-moved" : stopped.has(key) ? "st-box st-stop" : k === m && i === 0 ? "st-box st-found" : "st-box";
      parts.push(box(cx(i), cy(k + 1), cls));
    }
  }
  const aria = `Skip list of ${SMALL} article titles with ${s.height} levels; searching for ${DATA.titles[v.smallKeys[m]]} makes ${cost} comparisons.`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

/** The drawn treap, keys left to right in sorted order at their depth, with the path to key m. */
export function treapChart(v: Run, m: number): string {
  const t = v.smallTreap;
  const W = 340;
  const rowH = 26;
  const H = 14 + t.height * rowH;
  const x = (k: number) => 14 + (k * (W - 28)) / (SMALL - 1);
  const y = (k: number) => 2 + t.depth[k] * rowH - rowH / 2 + 4;
  const path = treapPath(t, m);
  const onPath = new Set(path);
  const parts: string[] = [];
  for (let k = 0; k < SMALL; k++) {
    for (const c of [t.left[k], t.right[k]]) {
      if (c < 0) continue;
      const cls = onPath.has(k) && onPath.has(c) ? "st-edge st-edge-path" : "st-edge";
      parts.push(`<line class="${cls}" x1="${x(k).toFixed(1)}" y1="${y(k).toFixed(1)}" x2="${x(c).toFixed(1)}" y2="${y(c).toFixed(1)}"/>`);
    }
  }
  for (let k = 0; k < SMALL; k++) {
    const cls = k === m ? "st-node st-found" : onPath.has(k) ? "st-node st-moved" : "st-node";
    parts.push(`<g class="${cls}"><circle cx="${x(k).toFixed(1)}" cy="${y(k).toFixed(1)}" r="8.5"/><text x="${x(k).toFixed(1)}" y="${(y(k) + 3.5).toFixed(1)}" text-anchor="middle">${k + 1}</text><title>${esc(DATA.titles[v.smallKeys[k]])}, priority ${num(t.pri[k], 3)}</title></g>`);
  }
  const aria = `Treap of the same ${SMALL} titles, height ${t.height}; the search for ${DATA.titles[v.smallKeys[m]]} makes ${path.length} comparisons.`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

/** Comparisons for every title in sorted order in both full structures, with their expectations. */
export function costChart(v: Run, narrow: boolean): string {
  const n = v.skipCost.length;
  const W = narrow ? 360 : 640;
  const L = { left: 34, right: 12, top: 10 };
  const ph = narrow ? 190 : 210;
  const H = L.top + ph + 34;
  const pw = W - L.left - L.right;
  let ymax = 0;
  for (let k = 0; k < n; k++) ymax = Math.max(ymax, v.skipCost[k], v.treapDepth[k]);
  ymax = Math.ceil((ymax + 1) / 10) * 10;
  const x = (k: number) => L.left + (k / (n - 1)) * pw;
  const y = (c: number) => L.top + (1 - c / ymax) * ph;
  const parts: string[] = [];
  for (let g = 0; g <= ymax; g += 10) {
    parts.push(`<line class="st-grid" x1="${L.left}" x2="${W - L.right}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}"/>`);
    parts.push(`<text class="st-tick" x="${L.left - 5}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end">${g}</text>`);
  }
  for (const k of [0, 499, 999, 1499, 1999]) {
    if (k < n) parts.push(`<text class="st-tick" x="${x(k).toFixed(1)}" y="${L.top + ph + 15}" text-anchor="middle">${fmt(k + 1)}</text>`);
  }
  for (let k = 0; k < n; k++) {
    parts.push(`<circle class="st-dot-skip" cx="${x(k).toFixed(1)}" cy="${y(v.skipCost[k]).toFixed(1)}" r="1.3"/>`);
    parts.push(`<circle class="st-dot-treap" cx="${x(k).toFixed(1)}" cy="${y(v.treapDepth[k]).toFixed(1)}" r="1.3"/>`);
  }
  const Hn = harmonicTable(n);
  const curve = (f: (m: number) => number, cls: string) => {
    const pts: string[] = [];
    for (let k = 0; k < n; k += k < 20 || k > n - 21 ? 1 : 10) pts.push(`${x(k).toFixed(1)},${y(f(k + 1)).toFixed(1)}`);
    pts.push(`${x(n - 1).toFixed(1)},${y(f(n)).toFixed(1)}`);
    return `<polyline class="${cls}" points="${pts.join(" ")}"/>`;
  };
  parts.push(curve((mm) => skipExpected(n, v.p, mm), "st-exp-skip"));
  parts.push(curve((mm) => treapExpected(n, mm, Hn), "st-exp-treap"));
  parts.push(`<text class="st-axis" x="${L.left + pw / 2}" y="${H - 3}" text-anchor="middle">position of the title in sorted order</text>`);
  const aria = `Comparisons to find each of ${n} titles in a skip list and a treap, with their expected values.`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

const mean = (a: Int32Array) => a.reduce((s, x) => s + x, 0) / a.length;
const max = (a: Int32Array) => a.reduce((s, x) => Math.max(s, x), 0);

export function readout(v: Run, m: number): string {
  const n = v.skipCost.length;
  const title = DATA.titles[v.smallKeys[m]];
  const sc = v.smallSkip.search(m);
  const tc = treapPath(v.smallTreap, m).length;
  const Hn = harmonicTable(n);
  let es = 0;
  for (let k = 1; k <= n; k++) es += skipExpected(n, v.p, k);
  es /= n;
  const et = 2 * (1 + 1 / n) * Hn[n] - 3;
  return (
    `<p>Finding <strong>${esc(title)}</strong> among the ${SMALL} drawn titles takes <strong>${sc}</strong> comparisons in the skip list and <strong>${tc}</strong> in the treap.</p>` +
    `<p>Over all ${fmt(n)} titles, the skip list with <i>p</i> = ${v.p === 0.5 ? "1/2" : "1/4"} has ${v.skipHeight} levels and makes ${num(mean(v.skipCost), 2)} comparisons per search on average (expected ${num(es, 2)}), at most ${max(v.skipCost)}. ` +
    `The treap has height ${v.treapHeight} and mean depth ${num(mean(v.treapDepth), 2)} (expected ${num(et, 2)}).</p>`
  );
}

export function initialRun(): Run {
  return run(DATA.order, 0.5, 1, mulberry32);
}

export function render(_props: Record<string, unknown>): string {
  const v = initialRun();
  const m = 0;
  const options = v.smallKeys.map((k, i) => `<option value="${i}"${i === m ? " selected" : ""}>${i + 1}. ${esc(DATA.titles[k])}</option>`).join("");
  return [
    `<figure class="st">`,
    `<div class="st-controls">`,
    `<label class="st-field"><span>Search for</span><select name="key" disabled>${options}</select></label>`,
    `<label class="st-field st-narrow"><span>Level probability <i>p</i></span><select name="p" disabled>${PS.map((p) => `<option value="${p}">${p === 0.5 ? "1/2" : "1/4"}</option>`).join("")}</select></label>`,
    `<button type="button" name="reseed" disabled>New random draws</button>`,
    `</div>`,
    `<div class="st-pair">`,
    `<div><p class="st-title">Skip list (levels 1, 2, … across)</p><div class="st-chart" data-part="skip">${skipChart(v, m, false)}</div></div>`,
    `<div><p class="st-title">Treap (same keys, numbered as in the skip list)</p><div class="st-chart" data-part="treap">${treapChart(v, m)}</div></div>`,
    `</div>`,
    `<div class="st-legend"><span class="st-key st-key-moved">moved to</span><span class="st-key st-key-stop">compared, ends a level</span><span class="st-key st-key-found">found</span></div>`,
    `<div class="st-readout" data-part="readout" aria-live="polite">${readout(v, m)}</div>`,
    `<p class="st-title">Comparisons to find each of the ${fmt(DATA.order.length)} titles</p>`,
    `<div class="st-legend"><span class="st-key st-key-skip">skip list</span><span class="st-key st-key-treap">treap</span><span class="st-key st-key-exp">expected for each position</span></div>`,
    `<div class="st-chart" data-part="cost">${costChart(v, false)}</div>`,
    `<figcaption>The keys are ${fmt(DATA.order.length)} English Wikipedia article titles drawn at random from the ${fmt(DATA.eligible)} articles with titles of at most 32 characters that had 20 or more views in the hour ending 12:00 UTC on 4 March 2026, inserted in random order. The drawn structures hold the first ${SMALL} titles inserted. Levels and priorities come from a seeded generator in the browser; a skip-list comparison is counted for each move, for each comparison that ends a level, and for the final equality test, and a treap search makes one comparison per node on its path.</figcaption>`,
    `</figure>`,
  ].join("");
}
