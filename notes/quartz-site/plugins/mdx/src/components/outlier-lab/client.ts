// Browser side of the outlier figure. The build already drew the default
// state. When the figure first scrolls into view this fetches the layer's
// data (about 230 KB), then every control redoes the quantized multiply.

import { enableControls, frameScheduler, lookup, whenVisible } from "../../shared/dom";
import { num } from "../../shared/format";
import { chips, floatMaskOf, readout, strip, THRESHOLDS } from "./draw";
import { DEFAULTS, loadLayer, quantize, type Layer, type LayerData, type Method, type Settings } from "./model";

export function mount(root: HTMLElement): () => void {
  const fig = root.querySelector<HTMLElement>("figure.ol");
  if (!fig) return () => {};
  const { part, input, output } = lookup(fig);
  const alpha = input("alpha");
  const thr = input("threshold");
  const set: Settings = { ...DEFAULTS };
  let layer: Layer | null = null;
  let alive = true;

  const draw = () => {
    if (!layer) return;
    const r = quantize(layer, set);
    part("readout").innerHTML = readout(layer, r, set);
    part("strip").innerHTML = strip(layer, r, set, floatMaskOf(layer, set));
    part("chips").innerHTML = chips(layer, r);
    for (const b of fig.querySelectorAll<HTMLButtonElement>("button[name]")) {
      const on = b.name === "method" ? b.value === set.method : b.value === String(set.bits);
      b.setAttribute("aria-pressed", String(on));
    }
    // FP8 has its own width; the integer bits do not apply to it
    for (const b of fig.querySelectorAll<HTMLButtonElement>('button[name="bits"]')) b.disabled = set.method === "fp8";
    alpha.disabled = set.method !== "smooth";
    thr.disabled = set.method !== "int8";
    output("alpha-out").textContent = num(set.alpha, 2);
    output("thr-out").textContent = String(set.threshold);
  };
  const frame = frameScheduler(draw);

  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[name]");
    if (!b || !fig.contains(b) || b.disabled) return;
    if (b.name === "method") set.method = b.value as Method;
    if (b.name === "bits") set.bits = Number(b.value);
    frame.schedule();
  };
  const onInput = () => {
    set.alpha = Number(alpha.value);
    set.threshold = THRESHOLDS[Number(thr.value)];
    frame.schedule();
  };

  const stopWatching = whenVisible(fig, (visible) => {
    if (!visible || layer) return;
    stopWatching();
    const url = `${fig.dataset.base ?? ""}outlier-layer.json`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.json() as Promise<LayerData>;
      })
      .then((d) => {
        if (!alive) return;
        layer = loadLayer(d);
        enableControls(fig);
        fig.addEventListener("click", onClick);
        alpha.addEventListener("input", onInput);
        thr.addEventListener("input", onInput);
        draw();
      })
      .catch((err) => {
        part("readout").textContent = `The figure's data didn't load (${err.message}); the picture above is the default setting.`;
      });
  });

  return () => {
    alive = false;
    stopWatching();
    frame.cancel();
    fig.removeEventListener("click", onClick);
    alpha.removeEventListener("input", onInput);
    thr.removeEventListener("input", onInput);
  };
}
