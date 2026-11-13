// Browser side of the benchmark-noise figure. The page already holds the
// figure rendered at build time; this enables its controls and redraws the
// output parts whenever they change.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { defaultState, type State } from "./model";
import { parts, speedupLabel } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.bn");
  if (!figure) return () => {};
  const seed = Number(figure.dataset.seed) || defaultState().seed;
  const state: State = defaultState(seed);
  const { input, output, part, button: named } = lookup(figure);
  const button = named("rerun");

  const draw = () => {
    state.speedup = Number(input("speedup").value) / 100;
    state.runs = Number(input("runs").value);
    for (const name of ["warmup", "pin", "freq", "quiet"] as const) state[name] = input(name).checked;
    output("speedup-out").value = speedupLabel(state.speedup);
    output("runs-out").value = String(state.runs);
    const next = parts(state);
    part("chart").innerHTML = next.chart;
    part("verdict").innerHTML = next.verdict;
    part("verdict").dataset.tone = next.tone;
    part("repeats").innerHTML = next.repeats;
    part("record").innerHTML = next.record;
  };
  const { schedule, cancel } = frameScheduler(draw);
  const rerun = () => {
    state.seed = (state.seed + 1) | 0;
    schedule();
  };

  figure.addEventListener("input", schedule);
  button.addEventListener("click", rerun);
  enableControls(figure);
  // Back and forward navigation can restore earlier control values, so draw
  // from the controls rather than assuming the defaults.
  draw();

  return () => {
    figure.removeEventListener("input", schedule);
    button.removeEventListener("click", rerun);
    cancel();
  };
}
