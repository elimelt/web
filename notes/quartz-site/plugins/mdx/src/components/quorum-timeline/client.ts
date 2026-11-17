// Browser side of the quorum timeline: the buttons and the slider change the
// setting, and the diagram, legend and readout are recomputed from the model.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { PRESETS, presetKey, type Op, type Setting } from "./model";
import { chart, legend, NARROW_PX, readout, W, W_NARROW } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.qt");
  if (!figure) return () => {};
  const { part } = lookup(figure);
  const form = figure.querySelector<HTMLFormElement>("form.qt-controls")!;
  const preset = PRESETS[presetKey(figure.dataset.preset)];
  const s: Setting = { ...preset.setting, rtts: [...preset.setting.rtts], down: [...preset.setting.down] };

  const sync = () => {
    for (const b of form.querySelectorAll<HTMLButtonElement>("button")) {
      const v = b.value;
      const on = b.name === "down" ? s.down[Number(v) - 1] : b.name === "via" ? s.via === Number(v) : s.op === v;
      b.setAttribute("aria-pressed", String(on));
    }
  };
  const { schedule, cancel } = frameScheduler(() => {
    sync();
    part("plot").innerHTML = chart(s, figure.clientWidth < NARROW_PX ? W_NARROW : W);
    part("legend").innerHTML = legend(s);
    part("readout").innerHTML = readout(s);
  });

  const onClick = (event: Event) => {
    const b = (event.target as Element).closest("button");
    if (!b || !form.contains(b)) return;
    if (b.name === "down") s.down[Number(b.value) - 1] = !s.down[Number(b.value) - 1];
    else if (b.name === "via") s.via = Number(b.value);
    else if (b.name === "op") s.op = b.value as Op;
    schedule();
  };
  const onInput = (event: Event) => {
    const el = event.target as HTMLInputElement;
    if (el.name !== "rtt") return;
    const r = preset.rttChoices![Number(el.value)];
    s.rtts = s.rtts.map(() => r);
    form.querySelector<HTMLOutputElement>('output[name="rtt-out"]')!.value = `${r} ms`;
    schedule();
  };
  const onSubmit = (event: Event) => event.preventDefault();

  // The build renders the wide layout; a narrow figure redraws with a
  // narrower coordinate system so the text stays legible.
  let narrow = false;
  const onResize = () => {
    const now = figure.clientWidth < NARROW_PX;
    if (now !== narrow) {
      narrow = now;
      schedule();
    }
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(figure);

  enableControls(figure);
  form.addEventListener("click", onClick);
  form.addEventListener("input", onInput);
  form.addEventListener("submit", onSubmit);
  return () => {
    cancel();
    ro.disconnect();
    form.removeEventListener("click", onClick);
    form.removeEventListener("input", onInput);
    form.removeEventListener("submit", onSubmit);
  };
}
