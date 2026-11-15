// Browser side of the pipeline schedule figure: reruns the simulation when
// the number of stages, microbatches or chunks per device changes.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { chartHtml, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ps");
  if (!figure) return () => {};
  const s: State = JSON.parse(figure.dataset.state ?? "{}");
  const parts = lookup(figure);
  const chart = parts.part("chart");
  const names = (["p", "m", "v"] as const).filter((n) => figure.querySelector(`input[name="${n}"]`));
  const sched = frameScheduler(() => {
    chart.innerHTML = chartHtml(s);
  });
  const onInput = () => {
    for (const n of names) {
      const value = Number(parts.input(n).value);
      s[n] = value;
      parts.output(n).textContent = String(value);
    }
    sched.schedule();
  };
  const inputs = names.map((n) => parts.input(n));
  for (const el of inputs) el.addEventListener("input", onInput);
  enableControls(figure);
  return () => {
    sched.cancel();
    for (const el of inputs) el.removeEventListener("input", onInput);
  };
}
