// Markup for the BM25 scoring figure, shared by render.ts (build time) and
// client.ts (redraws when a slider moves).

import { esc, num } from "../../shared/format";
import { idf, rankAll, relRank, type Data, type Preset, type Scored } from "./model";

export const SHOW = 5;
export type Controls = "k1" | "b" | "both";

/** Term colors: the five series colors, then the same with a lighter fill. */
const swatch = (j: number) => `bm-t${j % 10}`;

export const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n.toLocaleString("en-US")}${suffix}`;
};

const shorten = (t: string, n = 110) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function termTable(data: Data, p: Preset): string {
  const rows = p.terms
    .map((t, j) => {
      const rep = p.qtf[j] > 1 ? ` ×${p.qtf[j]}` : "";
      return `<tr><td><span class="bm-key ${swatch(j)}" aria-hidden="true"></span>${esc(t)}${rep}</td><td>${esc(p.words[j])}</td><td>${p.df[j].toLocaleString("en-US")}</td><td>${num(idf(data.N, p.df[j]), 2)}</td></tr>`;
    })
    .join("");
  return `<table class="bm-terms"><thead><tr><th>Term</th><th>From</th><th>df</th><th>idf</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function bar(p: Preset, s: Scored, max: number): string {
  const segs = s.parts
    .map((x, j) => (x > 0 ? `<span class="bm-seg ${swatch(j)}" style="width:${((100 * x) / max).toFixed(2)}%" title="${esc(p.terms[j])}: ${num(x, 2)}"></span>` : ""))
    .join("");
  return `<span class="bm-bar" aria-hidden="true">${segs}</span>`;
}

function row(p: Preset, s: Scored, r: number, max: number, rel: Set<number>): string {
  const isRel = rel.has(s.i);
  const title = p.titles[String(s.i)] ?? `document ${p.ids[s.i]}`;
  const mark = isRel ? `<span class="bm-rel" title="judged relevant">relevant</span>` : "";
  const parts = s.parts
    .map((x, j) => (x > 0 ? `${esc(p.terms[j])} ${num(x, 2)}` : ""))
    .filter(Boolean)
    .join(" + ");
  return `<li class="bm-row${isRel ? " bm-is-rel" : ""}"><span class="bm-rank">${r}</span><span class="bm-title">${esc(shorten(title))} ${mark}</span>${bar(p, s, max)}<span class="bm-score" title="${parts}">${num(s.score, 2)}</span></li>`;
}

export function ranking(data: Data, p: Preset, k1: number, b: number): { html: string; rank: number | null } {
  const ranked = rankAll(data, p, k1, b);
  const rel = new Set(p.rel.filter((x) => x >= 0));
  const rr = relRank(p, ranked);
  const shown = ranked.slice(0, SHOW);
  const extra = rr !== null && rr > SHOW ? ranked[rr - 1] : null;
  const max = Math.max(1e-9, ...shown.map((s) => s.score), extra ? extra.score : 0);
  let html = `<ol class="bm-list">${shown.map((s, i) => row(p, s, i + 1, max, rel)).join("")}`;
  if (extra) html += `<li class="bm-gap" aria-hidden="true">⋮</li>${row(p, extra, rr!, max, rel)}`;
  html += `</ol>`;
  return { html, rank: rr };
}

export function readout(data: Data, p: Preset, rank: number | null): string {
  const n = data.N.toLocaleString("en-US");
  const bm = rank === null ? `BM25 gives the relevant abstract a score of 0 (it contains no query term)` : `BM25 ranks the relevant abstract ${ordinal(rank)} of ${n}`;
  const dense = `the dense model (all-MiniLM-L6-v2, recorded) ranks it ${ordinal(p.dense.rank)}, at cosine ${num(p.dense.cos, 3)}`;
  return `${bm}; ${dense}. ${p.docs.length.toLocaleString("en-US")} of the ${n} abstracts contain at least one query term; the rest score 0.`;
}

export const slider = (name: "k1" | "b", value: number, hidden: boolean) => {
  const [min, max, step, label] = name === "k1" ? [0, 3, 0.1, "<i>k</i><sub>1</sub>"] : [0, 1, 0.05, "<i>b</i>"];
  return `<label class="bm-slider"${hidden ? " hidden" : ""}><span><span class="bm-name">${label}</span> <output name="${name}-out">${num(value, 2)}</output></span><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}" disabled></label>`;
};

export function figureHtml(data: Data, qid: string, k1: number, b: number, controls: Controls, caption: string): string {
  const p = data.presets[qid];
  const { html, rank } = ranking(data, p, k1, b);
  return `<figure class="bm" data-qid="${esc(qid)}">
<p class="bm-query"><span class="bm-label">Query ${esc(qid)}</span> ${esc(p.query)}</p>
${termTable(data, p)}
<div class="bm-controls">${slider("k1", k1, controls === "b")}${slider("b", b, controls === "k1")}</div>
<div data-part="list">${html}</div>
<p class="bm-readout" data-part="readout" aria-live="polite">${readout(data, p, rank)}</p>
<figcaption>BM25 (Lucene's form) computed in the browser from the recorded SciFact index entries for this query's terms, so the ranks are over all ${data.N.toLocaleString("en-US")} abstracts. Bar segments are each term's contribution; hover a score for the sum. The dense rank is recorded, not computed. ${esc(caption)}</figcaption>
</figure>`;
}
