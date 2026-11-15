// Browser side of the slowdown-by-size chart: the load buttons redraw it.

import { enableControls } from "../../shared/dom";
import { chartSvg, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.sb");
  if (!figure) return () => {};
  const s: State = JSON.parse(figure.dataset.state ?? "{}");
  const chart = figure.querySelector<HTMLElement>('[data-part="chart"]')!;
  const buttons = [...figure.querySelectorAll<HTMLButtonElement>('button[name="load"]')];
  const onClick = (event: Event) => {
    const b = event.currentTarget as HTMLButtonElement;
    s.load = b.value;
    for (const x of buttons) x.setAttribute("aria-pressed", String(x === b));
    chart.innerHTML = chartSvg(s);
  };
  for (const b of buttons) b.addEventListener("click", onClick);
  enableControls(figure);
  return () => {
    for (const b of buttons) b.removeEventListener("click", onClick);
  };
}
