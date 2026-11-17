// Browser side of the cache-line ping-pong figure: each core button runs one
// access on the model, Random 20 runs twenty accesses in a seeded random
// order, and the parts are redrawn from the render functions.

import { enableControls, lookup } from "../../shared/dom";
import { cores, describe, fresh, randomSchedule, step } from "./model";
import { core, counts } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.lp");
  if (!figure) return () => {};
  const { part, button } = lookup(figure);
  const preset = figure.dataset.preset ?? "packed";
  const n = cores(preset);
  let m = fresh(preset);
  let seed = 1;

  const draw = () => {
    for (let c = 0; c < n; c++) part(`core${c}`).innerHTML = core(m, c);
    part("counts").innerHTML = counts(m);
    part("event").textContent = describe(m, m.trace[m.trace.length - 1]);
    button("reset").disabled = m.trace.length === 0;
  };

  const onClick = (ev: Event) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.name === "reset") m = fresh(preset);
    else if (b.name === "random") for (const c of randomSchedule(n, 20, seed++)) step(m, c);
    else if (b.name.startsWith("core")) step(m, Number(b.name.slice(4)));
    else return;
    draw();
  };

  figure.addEventListener("click", onClick);
  enableControls(figure);
  draw();
  return () => figure.removeEventListener("click", onClick);
}
