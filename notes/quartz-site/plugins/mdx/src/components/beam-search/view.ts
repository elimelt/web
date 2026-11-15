// Markup for the beam search figure. Shared by render.ts (build time, with
// the recorded data bundled) and client.ts (which fetches the same data), so
// the page shows the finished default run before the script arrives.

import { esc, num } from "../../shared/format";
import { best, EOS, length, search, value, type Hyp, type Prepared, type Run, type Scoring } from "./model";

/** Target vocabulary size of the recorded model. */
export const VOCAB_SIZE = 31538;

export interface State {
  k: number;
  scoring: Scoring;
  /** 0 is the start (beam holds only the start token); i is after the i-th expansion. */
  step: number;
  run: Run;
}

export function makeState(p: Prepared, k: number, scoring: Scoring): State {
  const run = search(p, k);
  return { k, scoring, step: run.steps.length, run };
}

const SCORE_NAMES: Record<Scoring, string> = { raw: "log p", norm: "log p / length" };

/** A hypothesis as text, with its newest piece in bold (or struck through when pruned). */
function hypHtml(p: Prepared, tokens: number[], mark: "new" | "cut" | "none", ended = false): string {
  const v = p.data.vocab;
  const pieces = tokens.map((t) => (t === EOS ? "▁</s>" : v[t]));
  if (ended) pieces.push("▁</s>");
  const text = (s: string) => esc(s.replace(/▁/g, " "));
  if (!pieces.length) return `<span class="bs-dim">(start)</span>`;
  const head = pieces.slice(0, -1).join("");
  let last = pieces[pieces.length - 1];
  const space = last.startsWith("▁") ? " " : "";
  if (space) last = last.slice(1);
  const tag = mark === "new" ? "b" : mark === "cut" ? "s" : "span";
  return `${text(head).trimStart()}${space}<${tag}>${text(last)}</${tag}>`.trim();
}

const finishedSoFar = (s: State): Hyp[] => s.run.steps.slice(0, s.step).flatMap((x) => x.finished);

export function beamTable(p: Prepared, s: State): string {
  if (s.step === 0) {
    return `<table class="bs-table"><thead><tr><th>Beam</th><th>log p</th></tr></thead><tbody><tr class="bs-kept"><td>${hypHtml(p, [], "none")}</td><td>${num(0, 2)}</td></tr></tbody></table>`;
  }
  const st = s.run.steps[s.step - 1];
  const rows: string[] = [];
  for (const h of st.kept) rows.push(`<tr class="bs-kept"><td>${hypHtml(p, h.tokens, "new")}</td><td>${num(h.score, 2)}</td><td>kept</td></tr>`);
  for (const h of st.finished) rows.push(`<tr class="bs-fin"><td>${hypHtml(p, h.tokens, "new", true)}</td><td>${num(h.score, 2)}</td><td>finished</td></tr>`);
  for (const h of st.pruned) rows.push(`<tr class="bs-pruned"><td>${hypHtml(p, h.tokens, "cut")}</td><td>${num(h.score, 2)}</td><td>pruned</td></tr>`);
  return `<table class="bs-table"><thead><tr><th>Candidates after step ${s.step}</th><th>log p</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

export function finishedTable(p: Prepared, s: State): string {
  const fin = finishedSoFar(s);
  if (!fin.length) return `<p class="bs-dim">No hypothesis has ended yet.</p>`;
  const done = s.step === s.run.steps.length;
  const bi = best(fin, s.scoring);
  const order = fin.map((_, i) => i).sort((a, b) => value(fin[b], s.scoring) - value(fin[a], s.scoring) || a - b);
  const rows = order.map((i) => {
    const h = fin[i];
    const cls = i === bi ? (done ? "bs-best" : "bs-lead") : "";
    return `<tr class="${cls}"><td>${hypHtml(p, h.tokens, "none")}</td><td>${length(h)}</td><td>${num(h.score, 2)}</td><td>${num(h.score / length(h), 3)}</td></tr>`;
  });
  const col = (sc: Scoring, label: string) => `<th${s.scoring === sc ? ` class="bs-sortcol"` : ""}>${label}</th>`;
  return `<table class="bs-table bs-fintable"><thead><tr><th>Finished, best ${s.scoring === "raw" ? "log p" : "per token"} first</th><th>tokens</th>${col("raw", "log p")}${col("norm", "per token")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

export function narration(p: Prepared, s: State): string {
  const n = s.run.steps.length;
  if (s.step === 0) return `The beam holds only the start token. Each step extends every hypothesis in the beam by all ${VOCAB_SIZE.toLocaleString("en-US")} target tokens and keeps the ${s.k === 1 ? "single best extension" : `${s.k} best extensions`} by summed log-probability.`;
  const st = s.run.steps[s.step - 1];
  const prev = s.step === 1 ? 1 : s.run.steps[s.step - 2].kept.length;
  const parts = [`Step ${s.step}: ${prev} hypothes${prev === 1 ? "is" : "es"} × ${VOCAB_SIZE.toLocaleString("en-US")} tokens = ${(prev * VOCAB_SIZE).toLocaleString("en-US")} candidates; the table lists the ${2 * s.k} best.`];
  if (st.finished.length) parts.push(`${st.finished.length} ended with &lt;/s&gt; among the ${s.k} best and left the beam.`);
  const cut = st.pruned.filter((h) => h.tokens[h.tokens.length - 1] !== EOS);
  if (cut.length && st.kept.length && !(s.step === n && st.finished.length)) {
    const worst = st.kept[st.kept.length - 1].score;
    parts.push(`The best pruned extension scores ${num(cut[0].score, 2)}, below the lowest kept score, ${num(worst, 2)}.`);
  }
  if (s.step < n) return parts.join(" ");
  const fin = s.run.finished;
  const r = fin[best(fin, "raw")];
  const m = fin[best(fin, "norm")];
  const stop = fin.length >= s.k ? `${s.k === 1 ? "The hypothesis" : `${fin.length} hypotheses`} finished, so the search stopped.` : "The length limit closed the search.";
  if (r === m) return `${parts.join(" ")} ${stop} Both scores pick the same output, ${length(r)} tokens long.`;
  const chosen = s.scoring === "raw" ? r : m;
  const other = s.scoring === "raw" ? m : r;
  return `${parts.join(" ")} ${stop} ${s.scoring === "raw" ? "Raw log-probability" : "The per-token average"} picks the ${length(chosen)}-token output (${SCORE_NAMES[s.scoring]} ${num(value(chosen, s.scoring), s.scoring === "raw" ? 2 : 3)}); ${s.scoring === "raw" ? "the per-token average would pick" : "raw log-probability would pick"} the ${length(other)}-token one (log p ${num(other.score, 2)}, ${num(other.score / length(other), 3)} per token).`;
}

export const stepLabel = (s: State): string => `step ${s.step} / ${s.run.steps.length}`;

export function controls(p: Prepared, s: State): string {
  const ks = Array.from({ length: p.data.kmax }, (_, i) => i + 1)
    .map((k) => `<button type="button" name="k" value="${k}" aria-pressed="${k === s.k}" disabled>${k}</button>`)
    .join("");
  const sc = (["raw", "norm"] as Scoring[])
    .map((v) => `<button type="button" name="scoring" value="${v}" aria-pressed="${v === s.scoring}" disabled>${v === "raw" ? "log p" : "log p / length"}</button>`)
    .join("");
  return `<div class="bs-controls">
<div class="bs-group" role="group" aria-label="Beam width"><span class="bs-label">Beam width</span>${ks}</div>
<div class="bs-group" role="group" aria-label="Final score"><span class="bs-label">Final score</span>${sc}</div>
</div>`;
}

export function figureHtml(p: Prepared, s: State, src: string): string {
  const d = p.data;
  return `<figure class="bs" data-src="${esc(src)}" data-k="${s.k}" data-scoring="${s.scoring}">
<dl class="bs-src"><dt>Source</dt><dd>${esc(d.source)}</dd><dt>Reference</dt><dd>${esc(d.reference)}</dd></dl>
${controls(p, s)}
<div class="bs-steps">
<button type="button" name="first" aria-label="Back to the start" disabled>⏮</button>
<button type="button" name="prev" aria-label="Previous step" disabled>◀</button>
<button type="button" name="next" aria-label="Next step" disabled>▶</button>
<button type="button" name="last" aria-label="Run to the end" disabled>⏭</button>
<output name="step">${stepLabel(s)}</output>
</div>
<p class="bs-narration" data-part="narration" aria-live="polite">${narration(p, s)}</p>
<div class="bs-detail" data-part="beam">${beamTable(p, s)}</div>
<div class="bs-detail" data-part="finished">${finishedTable(p, s)}</div>
<figcaption>Next-token log-probabilities recorded from the OpenNMT-py Transformer-base English–German model on newstest2021 line ${d.line}, replayed in the browser. Length counts the end-of-sentence token.</figcaption>
</figure>`;
}
