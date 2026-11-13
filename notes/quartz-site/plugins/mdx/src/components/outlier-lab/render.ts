// Build-time markup for the outlier figure: the whole figure in its default
// state, computed from the same data and model the browser uses, with the
// controls disabled until the script arrives.

import { esc } from "../../shared/format";
import data from "../../../../../../content/ml/serving-systems/quantization/outlier-layer.json";
import { chips, controls, floatMaskOf, readout, strip } from "./draw";
import { DEFAULTS, loadLayer, quantize, type LayerData } from "./model";

export interface Props {
  base?: string;
}

export function render(props: Props = {}): string {
  const L = loadLayer(data as LayerData);
  const set = { ...DEFAULTS };
  const r = quantize(L, set);
  return [
    `<figure class="ol" data-base="${esc(props.base ?? "")}">`,
    controls(set),
    `<p class="ol-readout" data-part="readout" aria-live="polite">${readout(L, r, set)}</p>`,
    `<div data-part="strip">${strip(L, r, set, floatMaskOf(L, set))}</div>`,
    `<p class="ol-sub">Output error per token</p>`,
    `<div class="ol-chips" data-part="chips">${chips(L, r)}</div>`,
    `<figcaption>Real inputs reaching the feed-forward output projection (<code>wo</code>) of encoder layer 8 in Google's T5 v1.1 base, LM-adapted, for the first 24 tokens of a Go blog post, times 16 of the layer's 768 output columns. Your browser quantizes them and redoes the multiply; error is relative to the exact product. Weights always get one scale per output column; the buttons change how the inputs are scaled. Bars in red are the channels LLM.int8() keeps in floating point.</figcaption>`,
    `</figure>`,
  ].join("");
}
