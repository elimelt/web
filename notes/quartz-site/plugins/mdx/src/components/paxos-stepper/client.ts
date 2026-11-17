// Browser side of the Paxos stepper. The page already holds the figure for
// its preset; this enables the controls and redraws the parts after every
// step. Back pops a stack of earlier states.

import { manual, apply, describeNext, nextAction, presets, startPreset, summarize, type PId, type Sim } from "./model";
import { counts, flight, history, procButtons, svg } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.px");
  if (!figure) return () => {};
  const key = startPreset(figure.dataset.preset);
  const adoptBox = figure.querySelector<HTMLInputElement>('input[name="adopt"]');
  const button = (name: string) => figure.querySelector<HTMLButtonElement>(`.px-bar button[name="${name}"]`)!;
  const part = (name: string) => figure.querySelector<HTMLElement>(`[data-part="${name}"]`)!;

  const fresh = (): Sim => presets[key].build(adoptBox ? adoptBox.checked : true);
  let stack: Sim[] = [fresh()];
  const cur = () => stack[stack.length - 1];

  const draw = () => {
    const s = cur();
    const active = document.activeElement as HTMLElement | null;
    const barName = active && active.matches(".px-bar button") ? (active as HTMLButtonElement).name : null;
    part("diagram").innerHTML = svg(s);
    part("flight").innerHTML = flight(s);
    part("procs").innerHTML = procButtons(s);
    part("history").innerHTML = history(s);
    part("counts").innerHTML = counts(s);
    part("next").textContent = describeNext(s);
    const sum = summarize(s);
    part("headline").textContent = sum.headline;
    part("headline").dataset.tone = sum.tone;
    for (const el of figure.querySelectorAll<HTMLButtonElement>("[data-part] button")) el.disabled = el.hasAttribute("data-locked");
    button("next").disabled = nextAction(s) === null;
    button("back").disabled = stack.length < 2;
    if (barName) {
      const b = button(barName);
      (b.disabled ? button("reset") : b).focus();
    }
  };

  const push = (next: Sim) => {
    if (next === cur()) return;
    stack.push(next);
    if (stack.length > 500) stack = stack.slice(-500);
    draw();
  };

  const onClick = (event: Event) => {
    const target = event.target as Element;
    const bar = target.closest<HTMLButtonElement>(".px-bar button");
    if (bar) {
      if (bar.name === "next") push(apply(cur(), { type: "next" }));
      else if (bar.name === "back" && stack.length > 1) {
        stack.pop();
        draw();
      } else if (bar.name === "reset") {
        stack = [fresh()];
        draw();
      }
      return;
    }
    const msg = target.closest<HTMLButtonElement>("button[data-msg]");
    if (msg) {
      push(manual(cur(), { type: msg.dataset.act === "drop" ? "drop" : "deliver", id: Number(msg.dataset.msg) }));
      return;
    }
    const proc = target.closest<HTMLButtonElement>("button[data-p]");
    if (proc) {
      const p = proc.dataset.p as PId;
      const act = proc.dataset.act;
      push(manual(cur(), act === "start" ? { type: "start", p } : act === "crash" ? { type: "crash", p } : { type: "recover", p }));
    }
  };
  const onChange = (event: Event) => {
    if (event.target === adoptBox) {
      stack = [fresh()];
      draw();
    }
  };
  const onSubmit = (event: Event) => event.preventDefault();

  figure.addEventListener("click", onClick);
  figure.addEventListener("change", onChange);
  figure.addEventListener("submit", onSubmit);
  if (adoptBox) adoptBox.disabled = false;
  for (const b of figure.querySelectorAll<HTMLButtonElement>(".px-bar button")) b.disabled = false;
  draw();

  return () => {
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("change", onChange);
    figure.removeEventListener("submit", onSubmit);
  };
}
