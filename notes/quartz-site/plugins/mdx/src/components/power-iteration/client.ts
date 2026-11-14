// Browser side of the power iteration figure: enables the slider and reruns
// the iteration whenever it moves. The eigenvectors stay fixed, so the
// orthogonal matrix is built once per figure.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { N, SEED, orthogonal, presetById, run } from "./model";
import { chart, ratioLabel, readoutText } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.pi");
  if (!figure) return () => {};
  const preset = presetById(figure.dataset.preset);
  const { input, output, part } = lookup(figure);
  const slider = input("ratio");
  const q = orthogonal(N, SEED);

  const draw = () => {
    const ratio = Number(slider.value);
    output("ratio-out").value = ratioLabel(ratio);
    const r = run(ratio, preset.steps, SEED, N, q);
    part("chart").innerHTML = chart(r, preset);
    part("readout").innerHTML = readoutText(r, preset);
  };
  const { schedule, cancel } = frameScheduler(draw);
  slider.addEventListener("input", schedule);
  enableControls(figure);
  // Back and forward navigation can restore an earlier slider value.
  draw();
  return () => {
    slider.removeEventListener("input", schedule);
    cancel();
  };
}
