// Browser side of the retry lab: the buttons and sliders change the setting,
// and the diagram, bars and readout are recomputed from the model.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { LOSS_STEPS, type Mode } from "./model";
import { bars, initialState, ladder, legend, NARROW_PX, pct, readout, traceText, W, W_NARROW } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.rl");
  if (!figure) return () => {};
  const { part, output } = lookup(figure);
  const form = figure.querySelector<HTMLFormElement>("form.rl-controls")!;
  const s = initialState({ mode: figure.dataset.mode, q: figure.dataset.q, r: figure.dataset.r, seed: figure.dataset.seed });

  const sync = () => {
    for (const b of form.querySelectorAll<HTMLButtonElement>('button[name="mode"]')) {
      b.setAttribute("aria-pressed", String(b.value === s.mode));
    }
    output("q-out").value = pct(s.q);
    output("r-out").value = pct(s.r);
    output("sends-out").value = String(s.sends);
  };
  const { schedule, cancel } = frameScheduler(() => {
    sync();
    const w = figure.clientWidth < NARROW_PX ? W_NARROW : W;
    part("trace-text").textContent = traceText(s);
    part("ladder").innerHTML = ladder(s, w);
    part("bars").innerHTML = bars(s, w);
    part("legend").innerHTML = legend(s);
    part("readout").innerHTML = readout(s);
  });

  const onClick = (event: Event) => {
    const b = (event.target as Element).closest("button");
    if (!b || !figure.contains(b)) return;
    if (b.name === "mode") s.mode = b.value as Mode;
    else if (b.name === "resample") s.seed = (s.seed * 1103515245 + 12345) >>> 0;
    else return;
    schedule();
  };
  const onInput = (event: Event) => {
    const el = event.target as HTMLInputElement;
    const v = Number(el.value);
    if (el.name === "q") s.q = LOSS_STEPS[v];
    else if (el.name === "r") s.r = LOSS_STEPS[v];
    else if (el.name === "sends") s.sends = v;
    else return;
    schedule();
  };
  const onSubmit = (event: Event) => event.preventDefault();

  // The build renders the wide layout; a narrow figure redraws with a
  // narrower coordinate system so the labels stay legible.
  let narrow = false;
  const ro = new ResizeObserver(() => {
    const now = figure.clientWidth < NARROW_PX;
    if (now !== narrow) {
      narrow = now;
      schedule();
    }
  });
  ro.observe(figure);

  enableControls(figure);
  figure.addEventListener("click", onClick);
  form.addEventListener("input", onInput);
  form.addEventListener("submit", onSubmit);
  return () => {
    cancel();
    ro.disconnect();
    figure.removeEventListener("click", onClick);
    form.removeEventListener("input", onInput);
    form.removeEventListener("submit", onSubmit);
  };
}
