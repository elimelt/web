// Browser side of the fan-out tail figure: the slider sets the fan-out, and
// the two buttons choose which recorded leaf distribution the prediction
// uses. The second is available only at the fan-outs that were measured.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { FANOUTS, type Basis } from "./model";
import { chart, readout } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ft");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  const slider = input("k");
  const alone = button("alone");
  const loaded = button("loaded");
  let basis: Basis = "alone";

  const draw = () => {
    const k = Number(slider.value);
    output("k-out").value = String(k);
    const canLoad = Boolean(FANOUTS[k]);
    loaded.disabled = !canLoad;
    const b: Basis = canLoad ? basis : "alone";
    alone.setAttribute("aria-pressed", String(b === "alone"));
    loaded.setAttribute("aria-pressed", String(b === "loaded"));
    part("chart").innerHTML = chart(k, b);
    part("readout").innerHTML = readout(k, b);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const pick = (b: Basis) => () => {
    basis = b;
    schedule();
  };
  const onAlone = pick("alone");
  const onLoaded = pick("loaded");
  slider.addEventListener("input", schedule);
  alone.addEventListener("click", onAlone);
  loaded.addEventListener("click", onLoaded);
  enableControls(figure);
  draw();
  return () => {
    cancel();
    slider.removeEventListener("input", schedule);
    alone.removeEventListener("click", onAlone);
    loaded.removeEventListener("click", onLoaded);
  };
}
