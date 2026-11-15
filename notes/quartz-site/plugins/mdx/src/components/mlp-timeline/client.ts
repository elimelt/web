// Browser side of the MLP timeline: three sliders, one simulation per change,
// and a redraw of the timeline, readout and chart once per frame.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { clamp, LIMITS, simulate } from "./model";
import { chartSvg, readoutHtml, timelineSvg, type Params } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.mt");
  if (!figure) return () => {};
  const ui = lookup(figure);
  const names = ["chains", "latency", "buffers"] as const;
  const read = (): Params => {
    const p = {} as Params;
    for (const n of names) p[n] = clamp(Number(ui.input(n).value), LIMITS[n]);
    return p;
  };
  const draw = () => {
    const p = read();
    const r = simulate(p.chains, p.buffers, p.latency);
    ui.part("timeline").innerHTML = timelineSvg(p, r);
    ui.part("readout").innerHTML = readoutHtml(p, r);
    ui.part("chart").innerHTML = chartSvg(p);
    ui.output("chains-out").value = String(p.chains);
    ui.output("latency-out").value = `${p.latency} ns`;
    ui.output("buffers-out").value = String(p.buffers);
  };
  const frame = frameScheduler(draw);
  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if ((names as readonly string[]).includes(target.name)) frame.schedule();
  };
  enableControls(figure);
  figure.addEventListener("input", onInput);
  draw();
  return () => {
    frame.cancel();
    figure.removeEventListener("input", onInput);
  };
}
