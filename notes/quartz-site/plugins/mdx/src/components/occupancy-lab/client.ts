// Browser side of the occupancy figure: four controls, and a redraw of the
// limit bars, the bytes-in-flight bar and the readout after each change.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { occupancy, presetKey, PRESETS, type Launch } from "./model";
import { flightHtml, limitsHtml, readout } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.occ");
  if (!figure) return () => {};
  const { part, input, output } = lookup(figure);
  const select = (name: string) => figure.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  const state: Launch = { ...PRESETS[presetKey(figure.dataset.preset)] };

  const draw = () => {
    const o = occupancy(state);
    part("limits").innerHTML = limitsHtml(o);
    part("flight").innerHTML = flightHtml(o, state);
    part("readout").textContent = readout(state);
    output("regs-out").value = String(state.regs);
    output("smem-out").value = `${state.smemKB} KB`;
  };
  const frame = frameScheduler(draw);

  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (!figure.contains(target)) return;
    const v = Number(target.value);
    if (target.name === "threads") state.threads = v;
    else if (target.name === "bytes") state.bytesPerThread = v;
    else if (target.name === "regs") state.regs = v;
    else if (target.name === "smem") state.smemKB = v;
    else return;
    frame.schedule();
  };

  // Keep the controls in step with the preset even if the browser restored old form values.
  select("threads").value = String(state.threads);
  select("bytes").value = String(state.bytesPerThread);
  input("regs").value = String(state.regs);
  input("smem").value = String(state.smemKB);
  enableControls(figure);
  draw();
  figure.addEventListener("input", onInput);
  figure.addEventListener("change", onInput);
  return () => {
    frame.cancel();
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("change", onInput);
  };
}
