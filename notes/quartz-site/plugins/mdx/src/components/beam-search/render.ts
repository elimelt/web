// Build-time markup for the beam search figure: the finished run at the
// preset width and score, from the same recorded data the client fetches.

import recorded from "../../../../../../content/ml/nlp/decoding-strategies-experiments/beam-figure.json";
import { prepare, type Data, type Scoring } from "./model";
import { figureHtml, makeState } from "./view";

export interface Props {
  k?: number;
  scoring?: string;
  src?: string;
}

export function render(props: Props = {}): string {
  const p = prepare(recorded as unknown as Data);
  const k = Math.min(p.data.kmax, Math.max(1, Math.round(props.k ?? 3)));
  const scoring: Scoring = props.scoring === "norm" ? "norm" : "raw";
  return figureHtml(p, makeState(p, k, scoring), props.src ?? "");
}
