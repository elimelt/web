// Browser side of the real-time schedule figure: reruns both schedules and
// the schedulability tests when a task's execution time changes.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { chartHtml, testsHtml, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.rts");
  if (!figure) return () => {};
  const s: State = JSON.parse(figure.dataset.state ?? "{}");
  const parts = lookup(figure);
  const chart = parts.part("chart");
  const tests = parts.part("tests");
  const sched = frameScheduler(() => {
    chart.innerHTML = chartHtml(s);
    tests.innerHTML = testsHtml(s);
  });
  const inputs = s.tasks.map((_, i) => parts.input(`c${i}`));
  const onInput = () => {
    inputs.forEach((el, i) => {
      s.tasks[i].c = Number(el.value);
      parts.output(`c${i}`).textContent = el.value;
    });
    sched.schedule();
  };
  for (const el of inputs) el.addEventListener("input", onInput);
  enableControls(figure);
  return () => {
    sched.cancel();
    for (const el of inputs) el.removeEventListener("input", onInput);
  };
}
