// Browser side of the race stepper: each button runs one line of its thread
// on the model, then the parts are redrawn from the render functions.

import { enableControls, lookup } from "../../shared/dom";
import { done, fresh, step, summary, type ThreadId } from "./model";
import { memory, order, thread } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.rs");
  if (!figure) return () => {};
  const { part, button } = lookup(figure);
  const preset = figure.dataset.preset ?? "counter";
  let m = fresh(preset);

  const draw = () => {
    part("mem").innerHTML = memory(m);
    for (const t of ["A", "B"] as ThreadId[]) {
      part(`thread${t}`).innerHTML = thread(m, t);
      button(`step${t}`).disabled = done(m, t);
    }
    const sum = summary(m);
    part("summary").textContent = sum.text;
    part("summary").dataset.tone = sum.tone;
    part("order").textContent = order(m);
    button("reset").disabled = m.trace.length === 0;
  };

  const onClick = (event: Event) => {
    const b = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.name === "stepA") step(m, "A");
    else if (b.name === "stepB") step(m, "B");
    else if (b.name === "reset") m = fresh(preset);
    else return;
    draw();
  };

  figure.addEventListener("click", onClick);
  enableControls(figure);
  draw();
  return () => figure.removeEventListener("click", onClick);
}
