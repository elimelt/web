// Markup for the BPE figure: controls, the training text segmented after k
// merges, the pair counts that pick the next merge, the token-count curve,
// and the learned merges applied to a second text.

import { esc, num } from "../../shared/format";
import { display, encode, segmentation, train, type Rule, type Training, type Unit } from "./model";
import { PRESETS } from "./presets";

export const MAX_MERGES = 300;
export const MAX_CHARS = 5000;

export interface State {
  preset: number; // index into PRESETS, or -1 once the reader edits the text
  unit: Unit;
  rule: Rule;
  k: number;
  trainText: string;
  applyText: string;
}

export function startState(presetId?: string): State {
  const i = Math.max(0, PRESETS.findIndex((p) => p.id === presetId));
  return { preset: i, unit: "char", rule: "gpt2", k: 40, trainText: PRESETS[i].train, applyText: PRESETS[i].apply };
}

export function trainFor(s: State): Training {
  return train(s.trainText.slice(0, MAX_CHARS), s.unit, s.rule, MAX_MERGES);
}

function chips(seg: string[][], unit: Unit, fresh: string | null): string {
  let n = 0;
  return seg
    .map(
      (piece) =>
        `<span class="bp-piece">${piece
          .map((t) => {
            const d = display(t, unit);
            const cls = `bp-chip${n++ % 2 ? " bp-alt" : ""}${t === fresh ? " bp-new" : ""}${d.partial ? " bp-partial" : ""}`;
            return `<span class="${cls}">${esc(d.text)}</span>`;
          })
          .join("")}</span>`,
    )
    .join("");
}

const shown = (t: string, unit: Unit) => {
  const d = display(t, unit);
  return `<code class="${d.partial ? "bp-partial" : ""}">${esc(d.text)}</code>`;
};

export function stats(tr: Training, k: number): string {
  const step = tr.steps[k];
  const bytes = tr.bytes;
  const unitName = tr.unit === "char" ? "characters" : "bytes";
  return [
    `<span><b>${step.tokens}</b> tokens from ${tr.units} ${unitName}</span>`,
    `<span><b>${step.tokens ? num(bytes / step.tokens, 2) : "0"}</b> bytes per token</span>`,
    `<span><b>${tr.base} + ${k}</b> symbols: ${tr.base} distinct ${unitName} in the text, ${k} merged</span>`,
    `<span>${tr.order.length} pre-tokenized pieces, the floor on the token count</span>`,
  ].join("");
}

export function pairs(tr: Training, k: number): string {
  const step = tr.steps[k];
  const rows = step.candidates
    .map(
      (c, i) =>
        `<tr${i === 0 && k < tr.merges.length ? ' class="bp-best"' : ""}><td>${shown(c.left, tr.unit)} + ${shown(c.right, tr.unit)}</td><td>${c.count}</td></tr>`,
    )
    .join("");
  const note =
    k < tr.merges.length
      ? `Merge ${k + 1} takes the top pair.`
      : step.candidates.length
        ? "No pair occurs twice: training stops."
        : "No adjacent pairs remain.";
  return `<table class="bp-table"><thead><tr><th>adjacent pair</th><th>count</th></tr></thead><tbody>${rows}</tbody></table><p class="bp-note">${note}</p>`;
}

export function recent(tr: Training, k: number): string {
  const from = Math.max(0, k - 6);
  if (!k) return `<p class="bp-note">No merges yet: every token is one ${tr.unit === "char" ? "character" : "byte"}.</p>`;
  return `<ol class="bp-list" start="${from + 1}">${tr.merges
    .slice(from, k)
    .map((m) => `<li>${shown(m.left, tr.unit)} + ${shown(m.right, tr.unit)} → ${shown(m.left + m.right, tr.unit)} <small>${m.count}×</small></li>`)
    .join("")}</ol>`;
}

const W = 320, H = 130, L = 40, R = 8, T = 8, B = 26;

export function chart(tr: Training, k: number): string {
  const n = tr.merges.length;
  const ys = tr.steps.map((s) => s.tokens);
  const y0 = 0, y1 = Math.max(1, ys[0]);
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, n);
  const y = (v: number) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
  const line = ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const floor = tr.order.length;
  const kk = Math.min(k, n);
  return [
    `<svg class="bp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Token count against number of merges">`,
    `<line class="bp-axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>`,
    `<line class="bp-axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/>`,
    `<line class="bp-floor" x1="${L}" y1="${y(floor).toFixed(1)}" x2="${W - R}" y2="${y(floor).toFixed(1)}"/>`,
    `<text class="bp-small" x="${W - R}" y="${(y(floor) - 3).toFixed(1)}" text-anchor="end">pieces (${floor})</text>`,
    `<polyline class="bp-line" points="${line}"/>`,
    `<circle class="bp-dot" cx="${x(kk).toFixed(1)}" cy="${y(ys[kk]).toFixed(1)}" r="3.5"/>`,
    `<text class="bp-small" x="${L - 4}" y="${T + 4}" text-anchor="end">${y1}</text>`,
    `<text class="bp-small" x="${L - 4}" y="${H - B}" text-anchor="end">0</text>`,
    `<text class="bp-small" x="${L}" y="${H - 8}">0</text>`,
    `<text class="bp-small" x="${W - R}" y="${H - 8}" text-anchor="end">${n} merges</text>`,
    `<text class="bp-small" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">tokens after k merges</text>`,
    `</svg>`,
  ].join("");
}

export function text(tr: Training, k: number): string {
  const fresh = k ? tr.merges[k - 1].left + tr.merges[k - 1].right : null;
  return chips(segmentation(tr, k), tr.unit, fresh);
}

export function applied(tr: Training, s: State): string {
  const seg = encode(s.applyText.slice(0, MAX_CHARS), tr.merges, tr.unit, tr.rule, s.k);
  const n = seg.reduce((a, p) => a + p.length, 0);
  const bytes = new TextEncoder().encode(s.applyText.slice(0, MAX_CHARS)).length;
  return `<p class="bp-note"><b>${n}</b> tokens, ${n ? num(bytes / n, 2) : "0"} bytes per token, using the first ${s.k} merges.</p><div class="bp-text">${chips(seg, tr.unit, null)}</div>`;
}

export function counter(tr: Training, k: number): string {
  return `merge ${k} of ${tr.merges.length}`;
}

const pressed = (on: boolean) => `aria-pressed="${on}"`;

export function render(props: { preset?: string }): string {
  const s = startState(props.preset);
  const tr = trainFor(s);
  const k = Math.min(s.k, tr.merges.length);
  return [
    `<figure class="bp" data-preset="${esc(PRESETS[s.preset].id)}">`,
    `<div class="bp-controls">`,
    `<label class="bp-field">Training text <select name="preset" disabled>${PRESETS.map((p, i) => `<option value="${i}"${i === s.preset ? " selected" : ""}>${esc(p.label)}</option>`).join("")}<option value="-1">Your own text</option></select></label>`,
    `<span class="bp-group" role="group" aria-label="Base units"><span>Base units</span><button type="button" name="unit-char" ${pressed(true)} disabled>characters</button><button type="button" name="unit-byte" ${pressed(false)} disabled>UTF-8 bytes</button></span>`,
    `<span class="bp-group" role="group" aria-label="Pre-tokenizer"><span>Pre-tokenizer</span><button type="button" name="rule-gpt2" ${pressed(true)} disabled>GPT-2</button><button type="button" name="rule-o200k" ${pressed(false)} disabled>o200k</button></span>`,
    `</div>`,
    `<details class="bp-edit"><summary>Show or edit the training text</summary><textarea name="train" rows="6" spellcheck="false" disabled>${esc(s.trainText)}</textarea><p class="bp-note" data-part="source">${esc(PRESETS[s.preset].source)}</p></details>`,
    `<div class="bp-step">`,
    `<button type="button" name="back" aria-label="Undo one merge" disabled>◀</button>`,
    `<button type="button" name="play" disabled>Play</button>`,
    `<button type="button" name="next" aria-label="Do one merge" disabled>▶</button>`,
    `<input type="range" name="k" min="0" max="${tr.merges.length}" value="${k}" aria-label="Number of merges" disabled>`,
    `<output name="counter">${counter(tr, k)}</output>`,
    `</div>`,
    `<div class="bp-stats" data-part="stats">${stats(tr, k)}</div>`,
    `<div class="bp-panels">`,
    `<div class="bp-panel"><h4>Next merge</h4><div data-part="pairs">${pairs(tr, k)}</div></div>`,
    `<div class="bp-panel"><h4>Merges so far</h4><div data-part="recent">${recent(tr, k)}</div></div>`,
    `<div class="bp-panel bp-wide" data-part="chart">${chart(tr, k)}</div>`,
    `</div>`,
    `<h4>The training text after <span data-part="k">${k}</span> merges</h4>`,
    `<div class="bp-text" data-part="text">${text(tr, k)}</div>`,
    `<h4>The same merges applied to new text</h4>`,
    `<textarea name="apply" rows="3" spellcheck="false" disabled>${esc(s.applyText)}</textarea>`,
    `<div data-part="applied">${applied(tr, { ...s, k })}</div>`,
    `<figcaption>Byte-pair encoding trained in the browser on the text chosen above. Each piece from the pre-tokenizer starts as single ${"characters or bytes"}; every merge replaces all occurrences of the most frequent adjacent pair (ties go to the pair seen first) with one new symbol, and training stops once no pair occurs twice. Shaded boxes alternate between tokens, gaps separate pre-tokenized pieces, a middle dot is a space, and the tokens created by the latest merge are outlined. With UTF-8 bytes, a token that is not a whole character shows its bytes in hex.</figcaption>`,
    `</figure>`,
  ].join("");
}
