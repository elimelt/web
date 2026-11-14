// Browser side of the lock throughput charts: pointing at the chart, or the
// arrow keys, picks the thread count whose measured values the readout lists.

import { frameScheduler, lookup, svgPoint } from "../../shared/dom";
import { PRESETS, presetKey } from "./model";
import { chart, readout, scales, startThreads } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ls");
  if (!figure) return () => {};
  const { part } = lookup(figure);
  const key = presetKey(figure.dataset.preset);
  const threads = PRESETS[key].threads;
  const { x } = scales(PRESETS[key]);
  let selected = startThreads(key);
  let shown = selected;

  const { schedule, cancel } = frameScheduler(() => {
    if (shown === selected) return;
    shown = selected;
    part("plot").innerHTML = chart(key, selected);
    part("readout").innerHTML = readout(key, selected);
  });

  const nearest = (event: PointerEvent): number | null => {
    const svg = part("plot").querySelector<SVGSVGElement>("svg");
    const pt = svg && svgPoint(svg, event);
    if (!pt) return null;
    let best = threads[0];
    for (const t of threads) if (Math.abs(x(t) - pt.x) < Math.abs(x(best) - pt.x)) best = t;
    return best;
  };
  const onPointer = (event: PointerEvent) => {
    const t = nearest(event);
    if (t !== null) {
      selected = t;
      schedule();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    const i = threads.indexOf(selected);
    if (event.key === "ArrowRight" && i < threads.length - 1) selected = threads[i + 1];
    else if (event.key === "ArrowLeft" && i > 0) selected = threads[i - 1];
    else return;
    event.preventDefault();
    schedule();
  };

  const plot = part("plot");
  plot.addEventListener("pointermove", onPointer);
  plot.addEventListener("pointerdown", onPointer);
  plot.addEventListener("keydown", onKey);
  return () => {
    cancel();
    plot.removeEventListener("pointermove", onPointer);
    plot.removeEventListener("pointerdown", onPointer);
    plot.removeEventListener("keydown", onKey);
  };
}
