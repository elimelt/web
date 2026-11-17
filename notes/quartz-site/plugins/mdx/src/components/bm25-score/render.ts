// Build-time markup for the BM25 scoring figure: the ranking for the preset
// query at the preset k1 and b, from the same recorded data the client uses.

import recorded from "../../../../../../content/ml/nlp/reading/information-retrieval-experiments/bm25-figure.json";
import type { Data } from "./model";
import { figureHtml, type Controls } from "./view";

export interface Props {
  query?: string | number;
  k1?: number;
  b?: number;
  controls?: string;
  caption?: string;
}

export function render(props: Props = {}): string {
  const data = recorded as unknown as Data;
  const qid = String(props.query ?? Object.keys(data.presets)[0]);
  if (!data.presets[qid]) throw new Error(`BM25Score: no recorded query ${qid}`);
  const clamp = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  const k1 = clamp(props.k1, 0, 3, 0.9);
  const b = clamp(props.b, 0, 1, 0.4);
  const controls: Controls = props.controls === "k1" || props.controls === "b" ? props.controls : "both";
  return figureHtml(data, qid, k1, b, controls, props.caption ?? "");
}
