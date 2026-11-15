// Browser side of the schedule timeline: reruns the schedules when the one
// control moves, or swaps two jobs when the reader clicks one.

import { enableControls, frameScheduler } from "../../shared/dom";
import { simulate } from "./model";
import { chartHtml, readoutText, type State } from "./render";

const fmtValue = (s: State, v: number): string => (s.control === "boost" && v === 0 ? "never" : String(v));

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.st");
  if (!figure) return () => {};
  const initial: State = JSON.parse(figure.dataset.state ?? "{}");
  const s: State = structuredClone(initial);
  const chart = figure.querySelector<HTMLElement>('[data-part="chart"]')!;
  const readout = figure.querySelector<HTMLElement>('[data-part="readout"]')!;
  const slider = figure.querySelector<HTMLInputElement>('input[name="value"]');
  const out = figure.querySelector<HTMLOutputElement>('output[name="value"]');
  const reset = figure.querySelector<HTMLButtonElement>('button[name="reset"]');

  const draw = () => {
    chart.innerHTML = chartHtml(s, true);
    const text = readoutText(s);
    readout.textContent = text;
    readout.hidden = !text;
  };
  const sched = frameScheduler(draw);

  const onInput = () => {
    if (!slider) return;
    const v = Number(slider.value);
    if (s.control === "arrival") s.jobs[s.job].arrival = v;
    else if (s.control === "quantum") s.params.quantum = v;
    else if (s.control === "boost") s.params.boost = v;
    if (out) out.textContent = fmtValue(s, v);
    sched.schedule();
  };

  const total = () => simulate("order", s.jobs, s.params, s.order).done.reduce((a, b) => a + b, 0);
  const onClick = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-pos]");
    if (!button || button.disabled) return;
    const k = Number(button.dataset.pos);
    if (k >= s.order.length - 1) return;
    const before = total();
    const first = s.order[k];
    const second = s.order[k + 1];
    s.order[k] = second;
    s.order[k + 1] = first;
    s.swapped = { first, second, before, after: total() };
    draw();
    chart.querySelector<HTMLButtonElement>(`button[data-pos="${k}"]`)?.focus();
  };
  const onReset = () => {
    s.order = [...initial.order];
    s.swapped = undefined;
    draw();
  };

  slider?.addEventListener("input", onInput);
  chart.addEventListener("click", onClick);
  reset?.addEventListener("click", onReset);
  enableControls(figure);
  draw();
  return () => {
    sched.cancel();
    slider?.removeEventListener("input", onInput);
    chart.removeEventListener("click", onClick);
    reset?.removeEventListener("click", onReset);
  };
}
