// Browser side of the HyperLogLog error-curve figure.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { simulate, TRIALS } from "./model";
import { chart, readout } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.hle");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  let seed = Number(figure.dataset.seed) || 1;
  const draw = () => {
    const p = Number(input("p").value);
    output("p-out").value = `${p} (m = ${2 ** p} registers)`;
    const c = simulate(p, TRIALS, seed);
    part("chart").innerHTML = chart(c);
    part("readout").innerHTML = readout(c);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const rerun = () => {
    seed = (seed + 1) | 0;
    schedule();
  };
  const rb = button("rerun");
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
