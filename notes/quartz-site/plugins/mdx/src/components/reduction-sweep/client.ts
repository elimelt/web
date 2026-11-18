// Browser side of the reductions figure: preset and series buttons, the
// dispatch-cost slider and its shortcuts, and a cursor that follows the
// pointer across the chart.

import { enableControls, frameScheduler, lookup, svgPoint } from "../../shared/dom";
import { DISPATCH_US, PRESET_IDS, PRESETS, sliderToUs, usLabel, usToSlider, VARIANTS, type PresetId } from "./model";
import { chartSvg, initialState, NARROW, nearestIndex, readoutHtml, WIDE, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.rs");
  if (!figure) return () => {};
  const ui = lookup(figure);
  const pressed = PRESET_IDS.find((id) => ui.button(`preset-${id}`).getAttribute("aria-pressed") === "true") ?? "chain";
  const s: State = initialState(pressed);
  const narrow = () => figure.clientWidth < 500;
  let wasNarrow = narrow();

  const draw = () => {
    wasNarrow = narrow();
    ui.part("chart").innerHTML = chartSvg(s, wasNarrow);
    ui.part("readout").innerHTML = readoutHtml(s);
    for (const id of PRESET_IDS) ui.button(`preset-${id}`).setAttribute("aria-pressed", String(s.preset === id));
    for (const v of VARIANTS) ui.button(`v-${v.id}`).setAttribute("aria-pressed", String(s.shown.has(v.id)));
    ui.button("model").setAttribute("aria-pressed", String(s.model));
    ui.part("dispatch").hidden = !s.model;
    ui.output("d-out").value = usLabel(s.dUs);
    ui.input("dispatch").value = String(usToSlider(s.dUs));
  };
  const frame = frameScheduler(draw);

  const onClick = (event: Event) => {
    const b = (event.target as Element).closest("button");
    if (!b || !figure.contains(b)) return;
    if (b.name.startsWith("preset-")) {
      const id = b.name.slice(7) as PresetId;
      s.preset = id;
      s.shown = new Set(PRESETS[id].shown);
      s.model = PRESETS[id].model;
    } else if (b.name.startsWith("v-")) {
      const id = b.name.slice(2);
      if (s.shown.has(id)) s.shown.delete(id);
      else s.shown.add(id);
      s.preset = null;
    } else if (b.name === "model") {
      s.model = !s.model;
    } else if (b.name.startsWith("d-")) {
      s.dUs = DISPATCH_US[b.name.slice(2) as keyof typeof DISPATCH_US];
    } else return;
    frame.schedule();
  };
  const onInput = (event: Event) => {
    const t = event.target as HTMLInputElement;
    if (t.name !== "dispatch") return;
    s.dUs = sliderToUs(Number(t.value));
    frame.schedule();
  };
  const onMove = (event: PointerEvent) => {
    const svg = ui.part("chart").querySelector<SVGSVGElement>("svg");
    if (!svg || !(event.target as Element).closest('[data-part="hit"]')) return;
    const p = svgPoint(svg, event);
    if (!p) return;
    const i = nearestIndex(wasNarrow ? NARROW : WIDE, p.x);
    if (i !== s.cursor) {
      s.cursor = i;
      frame.schedule();
    }
  };
  const onResize = () => {
    if (narrow() !== wasNarrow) frame.schedule();
  };

  enableControls(figure);
  figure.addEventListener("click", onClick);
  figure.addEventListener("input", onInput);
  figure.addEventListener("pointermove", onMove);
  figure.addEventListener("pointerdown", onMove);
  window.addEventListener("resize", onResize);
  draw();
  return () => {
    frame.cancel();
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("pointermove", onMove);
    figure.removeEventListener("pointerdown", onMove);
    window.removeEventListener("resize", onResize);
  };
}
