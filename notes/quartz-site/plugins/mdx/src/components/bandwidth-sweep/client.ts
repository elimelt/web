// Browser side of the bandwidth sweep figure: four thread-count buttons and,
// for copy and triad, a box that adds the write-allocate reads.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { preset, THREADS } from "./model";
import { chartSvg, readoutHtml } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.bw");
  if (!figure) return () => {};
  const p = preset({ kernels: figure.dataset.kernels, threads: figure.dataset.threads, bus: figure.dataset.bus });
  const ui = lookup(figure);
  const box = figure.querySelector<HTMLInputElement>('input[name="bus"]');
  let t = p.threads;
  const draw = () => {
    const bus = box ? box.checked : false;
    ui.part("chart").innerHTML = chartSvg(p, t, bus);
    ui.part("readout").innerHTML = readoutHtml(p, t, bus);
    for (const n of THREADS) ui.button(`t${n}`).setAttribute("aria-pressed", String(n === t));
  };
  const frame = frameScheduler(draw);
  const onClick = (event: Event) => {
    const b = (event.target as HTMLElement).closest<HTMLButtonElement>("button[name^='t']");
    if (!b || !figure.contains(b)) return;
    t = Number(b.value);
    frame.schedule();
  };
  const onChange = (event: Event) => {
    if ((event.target as HTMLInputElement).name === "bus") frame.schedule();
  };
  enableControls(figure);
  figure.addEventListener("click", onClick);
  figure.addEventListener("change", onChange);
  draw();
  return () => {
    frame.cancel();
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("change", onChange);
  };
}
