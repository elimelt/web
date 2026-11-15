// Browser side of the Count-Min figure.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { analyze, PAGES, sampleIndices } from "./model";
import { chart, counts, readout } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.cml");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  let seed = Number(figure.dataset.seed) || 1;
  const idx = sampleIndices(PAGES);
  const draw = () => {
    const logW = Number(input("logw").value);
    const d = Number(input("d").value);
    output("w-out").value = (2 ** logW).toLocaleString("en-US");
    output("d-out").value = String(d);
    const s = analyze(counts(), logW, d, seed, idx);
    part("chart").innerHTML = chart(s);
    part("readout").innerHTML = readout(s);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const rb = button("rerun");
  const rerun = () => {
    seed = (seed + 1) | 0;
    schedule();
  };
  figure.addEventListener("input", schedule);
  rb.addEventListener("click", rerun);
  enableControls(figure);
  draw();
  return () => {
    figure.removeEventListener("input", schedule);
    rb.removeEventListener("click", rerun);
    cancel();
  };
}
