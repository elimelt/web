// Browser side of the TLB reach figure: a region slider, page-size buttons and
// a button that picks another of the benchmark's loads to walk.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { mulberry32 } from "../../shared/random";
import { clampIndex, fmtBytes, PAGE_SIZES, SIZES, type PageSize } from "./model";
import { addressSvg, chartSvg, readoutHtml, tableHtml, walkHtml, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.tr");
  if (!figure) return () => {};
  const ui = lookup(figure);
  const rand = mulberry32(4096);
  const s: State = {
    index: clampIndex(Number(ui.input("region").value)),
    page: (PAGE_SIZES.find((p) => ui.button(`page-${p}`).getAttribute("aria-pressed") === "true") ?? "4K") as PageSize,
    load: 0,
  };
  // Phones get the narrow chart and address geometry.
  const narrow = () => figure.clientWidth < 500;
  let wasNarrow = narrow();
  const draw = () => {
    wasNarrow = narrow();
    ui.part("chart").innerHTML = chartSvg(s, wasNarrow);
    ui.part("readout").innerHTML = readoutHtml(s);
    ui.part("addr").innerHTML = addressSvg(s, wasNarrow);
    ui.part("walk").innerHTML = walkHtml(s);
    ui.part("table").innerHTML = tableHtml(s);
    ui.output("region-out").value = fmtBytes(SIZES[s.index]);
    for (const p of PAGE_SIZES) ui.button(`page-${p}`).setAttribute("aria-pressed", String(p === s.page));
  };
  const frame = frameScheduler(draw);
  const loads = () => SIZES[s.index] / 4096;
  const onInput = (event: Event) => {
    const t = event.target as HTMLInputElement;
    if (t.name !== "region") return;
    s.index = clampIndex(Number(t.value));
    if (s.load >= loads()) s.load = Math.floor(rand() * loads());
    frame.schedule();
  };
  const onClick = (event: Event) => {
    const b = (event.target as Element).closest("button");
    if (!b || !figure.contains(b)) return;
    if (b.name === "next") s.load = Math.floor(rand() * loads());
    else if (b.name.startsWith("page-")) s.page = b.name.slice(5) as PageSize;
    else return;
    frame.schedule();
  };
  const onResize = () => {
    if (narrow() !== wasNarrow) frame.schedule();
  };
  enableControls(figure);
  figure.addEventListener("input", onInput);
  figure.addEventListener("click", onClick);
  window.addEventListener("resize", onResize);
  draw();
  return () => {
    frame.cancel();
    window.removeEventListener("resize", onResize);
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("click", onClick);
  };
}
