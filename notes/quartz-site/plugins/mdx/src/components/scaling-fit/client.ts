// Browser side of the scaling-law fitting figure: picks a dataset and a fit
// range, refits both models and redraws.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { chart, datasetFor, levels, readout, view } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.sf");
  if (!figure) return () => {};
  const { input, output, part } = lookup(figure);
  const slider = input("nmax");
  let d = datasetFor(figure.dataset.dataset);
  const draw = () => {
    const lv = levels(d);
    const idx = Math.min(Number(slider.value), lv.length - 1);
    output("nmax-out").value = String(lv[idx]);
    const v = view(d, lv[idx]);
    part("chart").innerHTML = chart(v);
    part("readout").innerHTML = readout(v);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const buttons = [...figure.querySelectorAll<HTMLButtonElement>(".sf-choices button")];
  const pick = (e: Event) => {
    const b = e.currentTarget as HTMLButtonElement;
    d = datasetFor(b.dataset.key);
    for (const o of buttons) o.setAttribute("aria-pressed", String(o === b));
    const lv = levels(d);
    slider.max = String(lv.length - 1);
    slider.value = String(lv.length - 1);
    schedule();
  };
  for (const b of buttons) b.addEventListener("click", pick);
  slider.addEventListener("input", schedule);
  enableControls(figure);
  draw();
  return () => {
    for (const b of buttons) b.removeEventListener("click", pick);
    slider.removeEventListener("input", schedule);
    cancel();
  };
}
