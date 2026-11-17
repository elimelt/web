// Browser side of the join crossover charts: the buttons switch the table,
// its physical order and random_page_cost; pointing at the chart, or the
// arrow keys, picks the k whose values the readout lists.

import { enableControls, frameScheduler, lookup, svgPoint } from "../../shared/dom";
import { ks, presetKey, type Layout, type Rpc } from "./model";
import { chart, readout, scales, startK, summaryLine, viewOf } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.jx");
  if (!figure) return () => {};
  const { part } = lookup(figure);
  const v = viewOf(presetKey(figure.dataset.preset));
  let k = startK(v);

  const { schedule, cancel } = frameScheduler(() => {
    part("plot").innerHTML = chart(v, k);
    part("readout").innerHTML = readout(v, k);
    part("summary").textContent = summaryLine(v);
    for (const b of figure.querySelectorAll<HTMLButtonElement>(".jx-seg button")) {
      const cur = b.name === "scale" ? v.scale : b.name === "layout" ? v.layout : v.rpc;
      b.setAttribute("aria-pressed", String(b.value === cur));
    }
  });

  const onClick = (event: Event) => {
    const b = (event.target as Element).closest<HTMLButtonElement>(".jx-seg button");
    if (!b) return;
    if (b.name === "scale") v.scale = b.value;
    else if (b.name === "layout") v.layout = b.value as Layout;
    else if (b.name === "rpc") v.rpc = b.value as Rpc;
    const pts = ks(v.scale, v.layout);
    if (!pts.includes(k)) k = startK(v);
    schedule();
  };

  const onPointer = (event: PointerEvent) => {
    const svg = part("plot").querySelector<SVGSVGElement>("svg");
    const pt = svg && svgPoint(svg, event);
    if (!pt) return;
    const { x, pts } = scales(v);
    let best = pts[0];
    for (const q of pts) if (Math.abs(x(q) - pt.x) < Math.abs(x(best) - pt.x)) best = q;
    if (best !== k) {
      k = best;
      schedule();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    const pts = ks(v.scale, v.layout);
    const i = pts.indexOf(k);
    if (event.key === "ArrowRight" && i < pts.length - 1) k = pts[i + 1];
    else if (event.key === "ArrowLeft" && i > 0) k = pts[i - 1];
    else return;
    event.preventDefault();
    schedule();
  };

  const plot = part("plot");
  const bar = figure.querySelector(".jx-bar")!;
  bar.addEventListener("click", onClick);
  plot.addEventListener("pointermove", onPointer);
  plot.addEventListener("pointerdown", onPointer);
  plot.addEventListener("keydown", onKey);
  enableControls(figure);
  return () => {
    cancel();
    bar.removeEventListener("click", onClick);
    plot.removeEventListener("pointermove", onPointer);
    plot.removeEventListener("pointerdown", onPointer);
    plot.removeEventListener("keydown", onKey);
  };
}
