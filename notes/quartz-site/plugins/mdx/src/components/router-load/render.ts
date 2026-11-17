// Build-time markup for the router load figure: the whole figure in its
// default state (8 experts, block 12, all four texts), computed with the same
// model the browser runs, controls disabled until the script arrives.

import { esc } from "../../shared/format";
import data from "../../../../../../content/ml/serving-systems/mixture-of-experts/router-e8-layer11.json";
import { chart, controls, LEGEND, readout } from "./draw";
import { DEFAULTS, loadRoutes, simulate, type RouterData } from "./model";

export interface Props {
  base?: string;
}

export function render(props: Props = {}): string {
  const r = loadRoutes(data as RouterData);
  const s = { ...DEFAULTS };
  const res = simulate(r, s);
  return [
    `<figure class="rl" data-base="${esc(props.base ?? "")}">`,
    controls(r.model, r.layer, s),
    `<p class="rl-readout" data-part="readout" aria-live="polite">${readout(r, s, res)}</p>`,
    `<div data-part="chart">${chart(r, s, res)}</div>`,
    LEGEND,
    `<figcaption>Expert choices recorded from Google's released Switch-Base checkpoints (top-1 routing) on 8,192 tokens each of Go blog prose, Go source code, Shakespeare and math-heavy Markdown. Your browser forms batches from those choices and gives each expert room for ⌈c·B/N⌉ tokens; tokens past that are the ones a fixed-capacity layer drops. Independent tokens resemble a decode batch (one token from each of many requests); whole sequences resemble prefill.</figcaption>`,
    `</figure>`,
  ].join("");
}
