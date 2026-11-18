// Browser side of the transfer-time figure: the rate, round-trip and sender
// buttons choose the path, the slider chooses the size the readout describes,
// and the chart, legend and readout are redrawn with the build's functions.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { SIZES, sizeLabel, type Cc } from "./model";
import { chart, legend, readout, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.tt");
  if (!figure) return () => {};
  const { part, input, output } = lookup(figure);
  const ds = figure.dataset;
  const s: State = { rate: Number(ds.rate), rtt: Number(ds.rtt), cc: ds.cc as Cc, size: Number(ds.size) };
  const slider = input("size");
  const out = output("size-out");
  const buttons = [...figure.querySelectorAll<HTMLButtonElement>(".tt-group button")];
  const { schedule, cancel } = frameScheduler(() => {
    s.size = Number(slider.value);
    out.value = sizeLabel(SIZES[s.size]);
    for (const b of buttons) {
      const v = b.dataset.rate ?? b.dataset.rtt ?? b.dataset.cc;
      const cur = b.dataset.rate ? s.rate : b.dataset.rtt ? s.rtt : s.cc;
      b.setAttribute("aria-pressed", String(String(cur) === v));
    }
    part("legend").innerHTML = legend(s.cc);
    part("chart").innerHTML = chart(s);
    part("readout").innerHTML = readout(s);
  });
  const cleanups: (() => void)[] = [];
  for (const b of buttons) {
    const onClick = () => {
      if (b.dataset.rate) s.rate = Number(b.dataset.rate);
      else if (b.dataset.rtt) s.rtt = Number(b.dataset.rtt);
      else s.cc = b.dataset.cc as Cc;
      schedule();
    };
    b.addEventListener("click", onClick);
    cleanups.push(() => b.removeEventListener("click", onClick));
  }
  slider.addEventListener("input", schedule);
  cleanups.push(() => slider.removeEventListener("input", schedule), cancel);
  // Back and forward navigation can restore an earlier slider value.
  schedule();
  enableControls(figure);
  return () => cleanups.forEach((c) => c());
}
