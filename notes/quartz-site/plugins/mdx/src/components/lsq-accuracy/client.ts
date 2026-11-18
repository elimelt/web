// Browser side of the least-squares accuracy figure: reruns the sweep when the
// residual slider moves or the reader asks for new random matrices.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { presetById, sweep } from "./model";
import { chart, readoutText, tanLabel } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.lq");
  if (!figure) return () => {};
  presetById(figure.dataset.preset);
  const { input, output, part, button } = lookup(figure);
  const slider = input("tan");
  const reseed = button("reseed");
  let base = 0;

  const draw = () => {
    const logTan = Number(slider.value);
    output("tan-out").value = tanLabel(logTan);
    const points = sweep(logTan, base);
    part("chart").innerHTML = chart(points, logTan);
    part("readout").innerHTML = readoutText(points, logTan);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const onReseed = () => {
    base += 1;
    schedule();
  };
  slider.addEventListener("input", schedule);
  reseed.addEventListener("click", onReseed);
  enableControls(figure);
  draw();
  return () => {
    slider.removeEventListener("input", schedule);
    reseed.removeEventListener("click", onReseed);
    cancel();
  };
}
