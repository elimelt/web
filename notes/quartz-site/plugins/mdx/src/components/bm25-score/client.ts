// Browser side of the BM25 scoring figure: re-scores and re-ranks the
// recorded index slice whenever k1 or b moves.

import recorded from "../../../../../../content/ml/nlp/reading/information-retrieval-experiments/bm25-figure.json";
import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { num } from "../../shared/format";
import type { Data } from "./model";
import { ranking, readout } from "./view";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.bm");
  if (!figure) return () => {};
  const data = recorded as unknown as Data;
  const qid = figure.dataset.qid ?? "";
  const p = data.presets[qid];
  if (!p) return () => {};
  const { input, output, part } = lookup(figure);
  const draw = () => {
    const k1 = Number(input("k1").value);
    const b = Number(input("b").value);
    output("k1-out").value = num(k1, 2);
    output("b-out").value = num(b, 2);
    const { html, rank } = ranking(data, p, k1, b);
    part("list").innerHTML = html;
    part("readout").innerHTML = readout(data, p, rank);
  };
  const { schedule, cancel } = frameScheduler(draw);
  figure.addEventListener("input", schedule);
  enableControls(figure);
  return () => {
    figure.removeEventListener("input", schedule);
    cancel();
  };
}
