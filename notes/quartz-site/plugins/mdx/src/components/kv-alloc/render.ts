// Build-time markup for the KV allocation figure. The build replays the
// default slice and allocator, so the page shows a real memory map and chart
// before any script runs; the browser fetches the same slice and redraws.

import slicesJson from "../../../../../../content/ml/serving-systems/memory-management/slices.json";
import { esc } from "../../shared/format";
import { chartSvg, KIND_LABELS, legend, mapSvg, nowText, summaryText, TRACE_LABELS, TRACES, type Slices, type TraceKey, type View } from "./draw";
import { BLOCK_SIZES, config, KINDS, run, stateAt, type Kind } from "./model";

const slices = slicesJson as unknown as Slices;

export interface Props {
  kind?: string;
  trace?: string;
  block?: number;
  src?: string;
  caption?: string;
}

export function parseView(p: { kind?: string; trace?: string; block?: number | string }): Omit<View, "t"> {
  const kind = (KINDS as string[]).includes(p.kind ?? "") ? (p.kind as Kind) : "max";
  const trace = (TRACES as string[]).includes(p.trace ?? "") ? (p.trace as TraceKey) : "conv";
  const block = (BLOCK_SIZES as readonly number[]).includes(Number(p.block)) ? Number(p.block) : 16;
  return { kind, trace, block };
}

export const generatedTokens = (reqs: [number, number][]) => reqs.reduce((a, [, g]) => a + g, 0);

/** The iteration the figure opens on: halfway through the part of the replay in which requests wait. */
export const defaultT = (steady: number, n: number) => Math.max(1, Math.min(n, Math.round(steady / 2)));

export function render(props: Props = {}): string {
  const v = parseView(props);
  const reqs = slices[v.trace];
  const cfg = config(v.kind, v.block);
  const { samples, summary } = run(reqs, cfg);
  const n = samples.length;
  const t = defaultT(summary.steadyIterations, n);
  const sim = stateAt(reqs, cfg, t);
  const seg = (name: string, items: [string, string][], current: string, label: string) =>
    `<div class="kva-seg" role="group" aria-label="${label}">${items
      .map(([value, text]) => `<button type="button" name="${name}" value="${value}" aria-pressed="${value === current}" disabled>${esc(text)}</button>`)
      .join("")}</div>`;
  const blockSel = `<label class="kva-block">Block <select name="block" disabled>${BLOCK_SIZES.map((b) => `<option value="${b}"${b === v.block ? " selected" : ""}>${b}</option>`).join("")}</select> tokens</label>`;
  return [
    `<figure class="kva" data-kind="${v.kind}" data-trace="${v.trace}" data-block="${v.block}" data-src="${esc(props.src ?? "")}">`,
    `<div class="kva-bar">`,
    seg("kind", KINDS.map((k) => [k, KIND_LABELS[k]]), v.kind, "Allocator"),
    blockSel,
    seg("trace", TRACES.map((k) => [k, TRACE_LABELS[k]]), v.trace, "Trace"),
    `</div>`,
    `<div class="kva-label">KV memory, ${cfg.budget / 8192} GiB, one row per 4 GiB</div>`,
    `<div data-part="map">${mapSvg(sim, cfg.budget)}</div>`,
    `<div class="kva-legend">${legend()}</div>`,
    `<div data-part="chart">${chartSvg(samples, cfg.budget, t)}</div>`,
    `<div class="kva-play"><button type="button" name="play" disabled>Play</button>`,
    `<input type="range" name="t" min="1" max="${n}" value="${t}" aria-label="Iteration" disabled></div>`,
    `<p class="kva-now" data-part="now" aria-live="polite">${nowText(sim.last, t, n, sim, cfg.budget)}</p>`,
    `<p class="kva-sum" data-part="summary">${summaryText(summary, v.kind, generatedTokens(reqs))}</p>`,
    props.caption ? `<figcaption>${esc(props.caption)}</figcaption>` : "",
    `</figure>`,
  ].join("");
}
