// Browser side of the checksum figure: clicking a bit flips it and redraws
// the sums and the verdict.

import { enableControls, lookup } from "../../shared/dom";
import { scenarioById } from "./model";
import { body } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.cs");
  if (!figure) return () => {};
  const { part, button } = lookup(figure);
  const start = scenarioById(figure.dataset.scenario).words;
  let words = [...start];

  const draw = (focus?: string) => {
    part("body").innerHTML = body(words);
    enableControls(figure);
    button("reset").disabled = words.every((w, i) => w === start[i]);
    if (focus) figure.querySelector<HTMLElement>(focus)?.focus();
  };

  const onClick = (event: Event) => {
    const target = event.target as Element;
    const bit = target.closest<HTMLButtonElement>("button.cs-bit");
    if (bit) {
      const w = Number(bit.dataset.w);
      const b = Number(bit.dataset.b);
      words[w] ^= 1 << b;
      return draw(`button.cs-bit[data-w="${w}"][data-b="${b}"]`);
    }
    if (target.closest('button[name="reset"]')) {
      words = [...start];
      draw();
    }
  };

  figure.addEventListener("click", onClick);
  draw();
  return () => figure.removeEventListener("click", onClick);
}
