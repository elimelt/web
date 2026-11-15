// Browser side of the augmenting-path figure: step through the augmentations
// and switch between the residual graph and the flow.

import { enableControls, lookup } from "../../shared/dom";
import { chart, initialState, narration, stepLabel, tally, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ap");
  if (!figure) return () => {};
  const { part, button, output } = lookup(figure);
  const state: State = initialState({ preset: figure.dataset.preset });

  const draw = () => {
    const total = state.run.augments.length;
    part("chart").innerHTML = chart(state);
    part("tally").innerHTML = tally(state);
    part("narration").innerHTML = narration(state);
    output("step").value = stepLabel(state);
    button("first").disabled = button("prev").disabled = state.step === 0;
    button("next").disabled = button("last").disabled = state.step === total;
    button("residual").setAttribute("aria-pressed", String(state.view === "residual"));
    button("flow").setAttribute("aria-pressed", String(state.view === "flow"));
  };

  const onClick = (e: Event) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b || b.disabled || !figure.contains(b)) return;
    const total = state.run.augments.length;
    if (b.name === "first") state.step = 0;
    else if (b.name === "prev") state.step = Math.max(0, state.step - 1);
    else if (b.name === "next") state.step = Math.min(total, state.step + 1);
    else if (b.name === "last") state.step = total;
    else if (b.name === "residual" || b.name === "flow") state.view = b.name;
    else return;
    draw();
  };

  figure.addEventListener("click", onClick);
  enableControls(figure);
  draw();
  return () => figure.removeEventListener("click", onClick);
}
