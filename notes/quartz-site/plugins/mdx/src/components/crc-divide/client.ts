// Browser side of the CRC division figure: step through the XORs, and in
// the receiver's scenarios flip received bits to see what the remainder does.

import { enableControls, lookup } from "../../shared/dom";
import { body, controls, startView, stateOf, type View } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.cd");
  if (!figure) return () => {};
  const { part, button } = lookup(figure);
  let v: View = startView(figure.dataset.scenario);

  const draw = (focus?: string) => {
    const total = stateOf(v).steps.length;
    v = { ...v, done: Math.min(v.done, total) };
    part("body").innerHTML = body(v);
    enableControls(figure);
    for (const [name, off] of Object.entries(controls(v, total))) button(name).disabled = off;
    if (focus) figure.querySelector<HTMLElement>(focus)?.focus();
  };

  const onClick = (event: Event) => {
    const target = event.target as Element;
    const bit = target.closest<HTMLButtonElement>("button.cd-bit");
    if (bit) {
      const i = Number(bit.dataset.i);
      const errors = v.errors.includes(i) ? v.errors.filter((e) => e !== i) : [...v.errors, i];
      v = { ...v, errors, done: 0 };
      return draw(`button.cd-bit[data-i="${i}"]`);
    }
    const b = target.closest<HTMLButtonElement>("button[name]");
    if (!b) return;
    const total = stateOf(v).steps.length;
    if (b.name === "next") v = { ...v, done: v.done + 1 };
    else if (b.name === "back") v = { ...v, done: Math.max(0, v.done - 1) };
    else if (b.name === "all") v = { ...v, done: total };
    else return;
    draw();
    if (button(b.name).disabled) button(b.name === "back" ? "next" : "back").focus();
  };

  figure.addEventListener("click", onClick);
  draw();
  return () => figure.removeEventListener("click", onClick);
}
