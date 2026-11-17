// Browser side of the prefetch distance figure: one slider over the measured
// distances, and a redraw of the chart and readout once per frame.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { distances, preset } from "./model";
import { chartSvg, readoutHtml } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.pd");
  if (!figure) return () => {};
  const p = preset({ pages: figure.dataset.pages, work: figure.dataset.work, hints: figure.dataset.hints });
  const ds = distances(p);
  const ui = lookup(figure);
  const draw = () => {
    const i = Math.min(ds.length - 1, Math.max(0, Math.round(Number(ui.input("d").value) || 0)));
    const d = ds[i];
    ui.part("chart").innerHTML = chartSvg(p, d);
    ui.part("readout").innerHTML = readoutHtml(p, d);
    ui.output("d-out").value = d === 0 ? "none" : String(d);
  };
  const frame = frameScheduler(draw);
  const onInput = (event: Event) => {
    if ((event.target as HTMLInputElement).name === "d") frame.schedule();
  };
  enableControls(figure);
  figure.addEventListener("input", onInput);
  draw();
  return () => {
    frame.cancel();
    figure.removeEventListener("input", onInput);
  };
}
