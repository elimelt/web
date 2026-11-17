// Browser side of the roofline figure: the level buttons or the batch slider
// pick which recorded points to highlight, and the chart and readout are
// redrawn from the same functions the build used.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { GEMM_M, H100_M, LEVELS, presetById, type Level } from "./model";
import { START, gemmChart, gemmText, h100Chart, h100Text, levelsChart, levelsText } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.rl");
  if (!figure) return () => {};
  const preset = presetById(figure.dataset.preset);
  const { part } = lookup(figure);
  const cleanups: (() => void)[] = [];

  if (preset.id === "levels") {
    let level = START.levels as Level;
    const buttons = LEVELS.map((l) => figure.querySelector<HTMLButtonElement>(`button[data-level="${l}"]`)!);
    const draw = () => {
      for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.level === level));
      part("chart").innerHTML = levelsChart(level);
      part("readout").innerHTML = levelsText(level);
    };
    for (const b of buttons) {
      const onClick = () => {
        level = b.dataset.level as Level;
        draw();
      };
      b.addEventListener("click", onClick);
      cleanups.push(() => b.removeEventListener("click", onClick));
    }
  } else {
    const ms = preset.id === "gemm" ? GEMM_M : H100_M;
    const slider = figure.querySelector<HTMLInputElement>('input[name="m"]')!;
    const out = figure.querySelector<HTMLOutputElement>('output[name="m-out"]')!;
    const { schedule, cancel } = frameScheduler(() => {
      const m = ms[Number(slider.value)];
      out.value = String(m);
      part("chart").innerHTML = preset.id === "gemm" ? gemmChart(m) : h100Chart(m);
      part("readout").innerHTML = preset.id === "gemm" ? gemmText(m) : h100Text(m);
    });
    slider.addEventListener("input", schedule);
    cleanups.push(() => slider.removeEventListener("input", schedule), cancel);
    // Back and forward navigation can restore an earlier slider value.
    schedule();
  }
  enableControls(figure);
  return () => cleanups.forEach((c) => c());
}
