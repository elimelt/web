// Browser side of the Hamming figure: click a received bit to flip it.

import { enableControls, lookup } from "../../shared/dom";
import { scenarioById } from "./model";
import { body, startView, type View } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.hm");
  if (!figure) return () => {};
  const { part, button } = lookup(figure);
  const start = startView(scenarioById(figure.dataset.scenario));
  let v: View = { ...start, received: [...start.received] };

  const draw = (focus?: string) => {
    part("body").innerHTML = body(v);
    enableControls(figure);
    button("reset").disabled = v.received.every((b, i) => b === start.received[i]);
    if (focus) figure.querySelector<HTMLElement>(focus)?.focus();
  };

  const onClick = (event: Event) => {
    const target = event.target as Element;
    const bit = target.closest<HTMLButtonElement>("button.hm-bit");
    if (bit) {
      const p = Number(bit.dataset.p);
      const received = [...v.received];
      received[p] ^= 1;
      v = { ...v, received };
      return draw(`button.hm-bit[data-p="${p}"]`);
    }
    if (target.closest('button[name="reset"]')) {
      v = { ...start, received: [...start.received] };
      draw();
    }
  };

  figure.addEventListener("click", onClick);
  draw();
  return () => figure.removeEventListener("click", onClick);
}
