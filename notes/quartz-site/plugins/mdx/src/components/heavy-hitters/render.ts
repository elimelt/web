// Markup for the heavy-hitter figure. The build renders the default view
// (Space-Saving with 64 counters after the whole recorded substream), which
// figure_ref.py computed; the client loads the substream and recomputes every
// view from the model.

import { esc, num } from "../../shared/format";
import initialJson from "../../../../../../content/algorithms/probabilistic/heavy-hitter-experiments/initial.json";
import metaJson from "../../../../../../content/algorithms/probabilistic/heavy-hitter-experiments/meta.json";
import { ALGS, BUDGETS, TOP, type Alg } from "./model";

export interface Meta {
  records: number;
  keys: number;
  views: number;
  hourStart: number[];
  top: string[];
}
export const META = metaJson as Meta;

/** What the chart and the readout need, whether computed now or at build time. */
export interface View {
  alg: Alg;
  budget: number;
  t: number;
  n: number;
  top: number[];
  truth: number[];
  est: number[];
  lo: number[];
  hi: number[];
  reported: boolean[];
  hits: number;
  maxErr: number;
  bound: number;
}

interface Initial {
  top: number[];
  truth: number[];
  est: number[];
  lo: number[];
  hi: number[];
  reported: number[];
  hits: number;
  maxErr: number;
  bound: number;
  n: number;
}

export const DEFAULT_ALG: Alg = "ss";
export const DEFAULT_BUDGET = 64;

export function initialView(): View {
  const i = initialJson as Initial;
  const rep = new Set(i.reported);
  return {
    alg: DEFAULT_ALG,
    budget: DEFAULT_BUDGET,
    t: META.records,
    n: i.n,
    top: i.top,
    truth: i.truth,
    est: i.est,
    lo: i.lo,
    hi: i.hi,
    reported: i.top.map((k) => rep.has(k)),
    hits: i.hits,
    maxErr: i.maxErr,
    bound: i.bound,
  };
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

/** A page's label: its title for the 20 most viewed keys of the day, its rank otherwise. */
export function keyLabel(key: number): string {
  const name = META.top[key];
  if (name === undefined) return `page ranked ${fmt(key + 1)}`;
  const sp = name.indexOf(" ");
  const project = name.slice(0, sp);
  const title = name.slice(sp + 1).replace(/_/g, " ");
  return `${title} (${project})`;
}

function clip(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, n - 1).join("") + "…";
}

export function budgetText(budget: number): string {
  return `${budget} (${fmt(budget * 16)} bytes)`;
}

/** Hour of the day (0 to 24) that a record position falls in. */
export function hourOf(t: number): number {
  let h = 0;
  while (h < 24 && META.hourStart[h + 1] <= t - 1) h++;
  return t === 0 ? 0 : h;
}

export function positionText(t: number): string {
  if (t === 0) return "no records yet";
  if (t >= META.records) return `all ${fmt(META.records)} records`;
  return `${fmt(t)} records, hour ${hourOf(t)}`;
}

export function chart(v: View, narrow = false): string {
  const W = narrow ? 360 : 600;
  const labelW = narrow ? 128 : 210;
  const L = { left: labelW + 14, right: 12, top: 24, bottom: 34 };
  const rowH = 19;
  const H = L.top + TOP * rowH + L.bottom;
  const pw = W - L.left - L.right;
  let lo = Infinity;
  let hi = 1;
  for (let i = 0; i < v.top.length; i++) {
    lo = Math.min(lo, Math.max(1, v.truth[i]), Math.max(1, v.lo[i]), Math.max(1, v.est[i]));
    hi = Math.max(hi, v.truth[i], v.hi[i], v.est[i]);
  }
  if (!isFinite(lo)) lo = 1;
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.max(e0 + 1, Math.ceil(Math.log10(hi * 1.02)));
  const x = (val: number) => L.left + ((Math.log10(Math.max(val, 10 ** e0)) - e0) / (e1 - e0)) * pw;
  const parts: string[] = [];
  for (let e = e0; e <= e1; e++) {
    for (const m of [1, 2, 5]) {
      const val = m * 10 ** e;
      if (val > 10 ** e1 || (m > 1 && e === e1)) continue;
      const xx = x(val).toFixed(1);
      parts.push(`<line class="hh-grid${m === 1 ? "" : " hh-grid-minor"}" x1="${xx}" x2="${xx}" y1="${L.top - 4}" y2="${L.top + TOP * rowH}"/>`);
      if (m === 1 || (!narrow && e1 - e0 <= 3))
        parts.push(`<text class="hh-tick" x="${xx}" y="${L.top + TOP * rowH + 14}" text-anchor="middle">${val < 1000 ? val : narrow ? (val >= 1e6 ? `${val / 1e6}M` : `${val / 1000}k`) : fmt(val)}</text>`);
    }
  }
  parts.push(`<text class="hh-axis" x="${L.left + pw / 2}" y="${H - 4}" text-anchor="middle">views (log scale)</text>`);
  parts.push(`<text class="hh-head" x="${labelW}" y="${L.top - 9}" text-anchor="end">true top ${TOP} so far</text>`);
  for (let i = 0; i < v.top.length; i++) {
    const y = L.top + i * rowH + rowH / 2;
    const label = clip(keyLabel(v.top[i]), narrow ? 17 : 30);
    parts.push(`<text class="hh-label${v.reported[i] ? " hh-rep" : ""}" x="${labelW}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(label)}</text>`);
    parts.push(`<rect class="${v.reported[i] ? "hh-mark-on" : "hh-mark-off"}" x="${labelW + 4}" y="${(y - 4).toFixed(1)}" width="7" height="7"/>`);
    const a = Math.max(v.lo[i], 10 ** e0);
    const b = Math.max(v.hi[i], 10 ** e0);
    if (b > a) parts.push(`<line class="hh-int" x1="${x(a).toFixed(1)}" x2="${x(b).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
    parts.push(`<circle class="hh-true" cx="${x(v.truth[i]).toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`);
    const ex = v.est[i] < 10 ** e0 ? L.left - 2 : x(v.est[i]);
    parts.push(`<path class="hh-est" d="M${ex.toFixed(1)},${(y - 5).toFixed(1)}l5,5l-5,5l-5,-5z"/>`);
  }
  const algName = ALGS.find((a) => a.id === v.alg)!.label;
  const aria = `For the ${TOP} pages with the most views in the first ${fmt(v.t)} records, the true view count, the estimate from ${algName} with ${v.budget} counters' worth of memory, and the interval the summary guarantees, on a log scale.`;
  return `<svg class="hh-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

export function readout(v: View): string {
  const name = ALGS.find((a) => a.id === v.alg)!.label;
  const head = `After ${positionText(v.t)} (${fmt(v.n)} views), ${name} with memory for ${v.budget} counters reports <strong>${v.hits} of the ${Math.min(TOP, v.top.length)}</strong> most viewed pages among its ${TOP} largest ${v.alg === "mg" || v.alg === "ss" ? "counters" : "candidates"}.`;
  if (v.t === 0) return "No records processed yet.";
  const err = `The largest error on those pages is ${fmt(v.maxErr)} views (${num((100 * v.maxErr) / Math.max(1, v.n), 2)}% of the views so far).`;
  const bound =
    v.alg === "mg"
      ? `Misra–Gries guarantees an underestimate by at most (n − counted)/(k + 1) = ${fmt(v.bound)} views.`
      : v.alg === "ss"
        ? `Space-Saving guarantees an overestimate by at most its smallest counter, ${fmt(v.bound)} views.`
        : v.alg === "cms"
          ? `Count-Min overestimates by at most e·n/w = ${fmt(v.bound)} views for each key with probability at least 1 − e<sup>−4</sup> (98%).`
          : `Count Sketch errs by at most √(3/w)·‖a‖<sub>2</sub> = ${fmt(v.bound)} views for each key with probability at least 0.79.`;
  return `${head} ${err} ${bound}`;
}

export function eventText(alg: Alg, ev: { t: number; key: number; c: number; kind: string; evicted: number; amount: number; kept: boolean } | null): string {
  if (!ev) return "";
  const who = `Record ${fmt(ev.t + 1)}: ${esc(keyLabel(ev.key))}, ${fmt(ev.c)} view${ev.c === 1 ? "" : "s"}.`;
  switch (ev.kind) {
    case "add":
      return `${who} Its counter rises by ${fmt(ev.c)}.`;
    case "new":
      return `${who} It takes a free counter.`;
    case "replace":
      return `${who} No free counter, so it takes over the smallest one (${esc(keyLabel(ev.evicted))}, ${fmt(ev.amount)} views), starting at ${fmt(ev.amount + ev.c)} with an error bound of ${fmt(ev.amount)}.`;
    case "decrement":
      return ev.kept
        ? `${who} No free counter, so every counter and the new page lose ${fmt(ev.amount)}; the counters that reach zero are freed and the page keeps the remaining ${fmt(ev.c - ev.amount)}.`
        : `${who} No free counter, so every counter loses ${fmt(ev.amount)} and the page's ${fmt(ev.c)} view${ev.c === 1 ? " is" : "s are"} discarded; counters that reach zero are freed.`;
    default:
      return ev.evicted >= 0
        ? `${who} The sketch is updated; the page's new estimate exceeds the smallest candidate's, so it replaces ${esc(keyLabel(ev.evicted))} in the candidate set.`
        : ev.kept
          ? `${who} The sketch is updated and the page is among the candidates.`
          : `${who} The sketch is updated; the page's estimate is below every candidate's, so the candidate set is unchanged.`;
  }
}

export interface Props {
  base?: string;
}

export function render(props: Props): string {
  const base = typeof props.base === "string" ? props.base : "";
  const v = initialView();
  const algs = ALGS.map((a) => `<option value="${a.id}"${a.id === DEFAULT_ALG ? " selected" : ""}>${esc(a.label)}</option>`).join("");
  const bi = BUDGETS.indexOf(DEFAULT_BUDGET);
  return [
    `<figure class="hh" data-base="${esc(base)}">`,
    `<div class="hh-controls">`,
    `<label class="hh-select hh-wide"><span>Summary</span><select name="alg" disabled>${algs}</select></label>`,
    `<label class="hh-select"><span>Record order</span><select name="order" disabled><option value="file" selected>As recorded</option><option value="shuffled">Shuffled</option></select></label>`,
    `<label class="hh-slider"><span>Memory, in counters <output name="budget-out">${budgetText(DEFAULT_BUDGET)}</output></span><input type="range" name="budget" min="0" max="${BUDGETS.length - 1}" step="1" value="${bi}" disabled></label>`,
    `</div>`,
    `<div class="hh-controls">`,
    `<label class="hh-slider hh-wide"><span>Position <output name="pos-out">${positionText(META.records)}</output></span><input type="range" name="pos" min="0" max="${META.records}" step="1" value="${META.records}" disabled></label>`,
    `<button type="button" name="step" disabled>Next record</button>`,
    `<button type="button" name="hour" disabled>Next hour</button>`,
    `<button type="button" name="reshuffle" disabled>Shuffle again</button>`,
    `</div>`,
    `<div class="hh-legend" aria-hidden="true"><span class="hh-key hh-key-true">true views</span><span class="hh-key hh-key-est">estimate</span><span class="hh-key hh-key-int">guaranteed interval</span><span class="hh-key hh-key-rep">reported in the top ${TOP}</span></div>`,
    `<div class="hh-plot" data-part="chart">${chart(v)}</div>`,
    `<p class="hh-readout" data-part="readout" aria-live="polite">${readout(v)}</p>`,
    `<p class="hh-readout hh-event" data-part="event"></p>`,
    `<figcaption>The summaries run in the browser on a recorded substream of the benchmark: the ${fmt(META.records)} records, in file order, whose key hash falls in a fixed 1/4,096 of the hash range (${fmt(META.keys)} pages, ${fmt(META.views)} views over the 24 hours). Memory is counted in 16-byte counters; Count Sketch and Count-Min spend three quarters of it on 4-byte cells (5 and 4 rows) and a quarter on 16-byte candidate entries. Space-Saving and Misra–Gries intervals are deterministic; the sketch intervals hold for each key with the stated probability over the hash functions. "As recorded" is hour by hour; within an hour the records are grouped by project and listed largely in title order.</figcaption>`,
    `</figure>`,
  ].join("");
}
