// Browser side of the disk-queue figure: the buttons choose the scheduling
// policy and the slider the queue depth; each change reruns the simulation
// (cached per setting) and redraws the arm path and the table.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { POLICIES, QDS, type Policy } from "./model";
import { chart, readout, status } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.dq");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  const slider = input("qd");
  let policy = (figure.dataset.policy as Policy) ?? "fcfs";
  const buttons = POLICIES.map((p) => [p, button(p)] as const);

  const draw = () => {
    const qd = QDS[Number(slider.value)] ?? 1;
    output("qd-out").value = String(qd);
    for (const [p, b] of buttons) b.setAttribute("aria-pressed", String(p === policy));
    part("chart").innerHTML = chart(policy, qd);
    part("readout").innerHTML = readout(policy, qd);
    part("status").textContent = status(policy, qd);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const handlers = buttons.map(([p, b]) => {
    const h = () => {
      policy = p;
      schedule();
    };
    b.addEventListener("click", h);
    return [b, h] as const;
  });
  slider.addEventListener("input", schedule);
  enableControls(figure);
  draw();
  return () => {
    cancel();
    slider.removeEventListener("input", schedule);
    for (const [b, h] of handlers) b.removeEventListener("click", h);
  };
}
