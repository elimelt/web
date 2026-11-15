// Browser side of the set cover figure: step through the greedy picks.

import { enableControls, lookup } from "../../shared/dom";
import { chart, initialState, narration, stepLabel, table, tally } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.sg");
  if (!figure) return () => {};
  const { part, button, output } = lookup(figure);
  const state = initialState({ preset: figure.dataset.preset });
  const total = state.picks.length;

  const draw = () => {
    part("chart").innerHTML = chart(state);
    part("tally").innerHTML = tally(state);
    part("narration").innerHTML = narration(state);
    part("table").innerHTML = table(state);
    output("step").value = stepLabel(state);
    button("first").disabled = button("prev").disabled = state.step === 0;
    button("next").disabled = button("last").disabled = state.step === total;
  };

  const onClick = (e: Event) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b || b.disabled || !figure.contains(b)) return;
    if (b.name === "first") state.step = 0;
    else if (b.name === "prev") state.step = Math.max(0, state.step - 1);
    else if (b.name === "next") state.step = Math.min(total, state.step + 1);
    else if (b.name === "last") state.step = total;
    else return;
    draw();
  };

  figure.addEventListener("click", onClick);
  enableControls(figure);
  draw();
  return () => figure.removeEventListener("click", onClick);
}
