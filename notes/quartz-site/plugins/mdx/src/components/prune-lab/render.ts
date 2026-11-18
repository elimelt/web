// Build-time markup for the pruning figure: the whole figure in its default
// state, computed from the same data and model the browser uses, with the
// controls disabled until the script arrives.

import { esc } from "../../shared/format";
import layerData from "../../../../../../content/ml/serving-systems/quantization/outlier-layer.json";
import pruneData from "../../../../../../content/ml/serving-systems/sparsity-and-pruning/prune-layer.json";
import { chips, controls, keptChart, readout, sweepChart } from "./draw";
import { DEFAULTS, loadLayer, loudest, prune, type LayerData, type PruneData } from "./model";

export interface Props {
  src?: string; // URL of outlier-layer.json
}

export function render(props: Props = {}): string {
  const P = pruneData as unknown as PruneData;
  const L = loadLayer(layerData as LayerData, P);
  const set = { ...DEFAULTS };
  const r = prune(L, set);
  const loud = loudest(L);
  return [
    `<figure class="pl" data-src="${esc(props.src ?? "")}">`,
    controls(L, set),
    `<p class="pl-readout" data-part="readout" aria-live="polite">${readout(L, r, set, loud)}</p>`,
    `<div data-part="kept">${keptChart(L, r)}</div>`,
    `<p class="pl-sub">Output error per token</p>`,
    `<div class="pl-chips" data-part="chips">${chips(L, r)}</div>`,
    `<div data-part="sweep">${sweepChart(P.sweep, L, set)}</div>`,
    `<figcaption>Top: your browser prunes 16 of the 768 output columns of the feed-forward output projection (<code>wo</code>) in encoder layer 8 of Google's T5 v1.1 base (LM-adapted), the layer the quantization figure uses, and multiplies by the real inputs of 24 tokens of a held-out Go blog post. Wanda weighs each weight by the RMS of its input channel over 128 calibration windows. "Whole layer" compares scores against a threshold computed over all 2048 × 768 weights. Bottom: perplexity of the whole model with every linear layer pruned the same way, measured offline with <code>run.py sweep</code> up to 70% sparsity; the vertical line follows the slider.</figcaption>`,
    `</figure>`,
  ].join("");
}
