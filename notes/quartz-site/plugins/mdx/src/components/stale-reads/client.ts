// Browser side of the stale-read figure: the sliders and selects rerun the
// Monte Carlo for the reader's setting; the time slider only moves the marker
// and rewrites the readout from the cached run.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { clampSetting, PRESETS, presetKey, run, TIMES, type Result, type Setting } from "./model";
import { chart, fmtTime, legend, readout } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.sr");
  if (!figure) return () => {};
  const { part, input, output } = lookup(figure);
  const form = figure.querySelector<HTMLFormElement>("form.sr-controls")!;
  const profile = form.querySelector<HTMLSelectElement>('select[name="profile"]')!;
  const failure = form.querySelector<HTMLSelectElement>('select[name="f"]')!;
  const preset = PRESETS[presetKey(figure.dataset.preset)];
  const compare: Result | null = preset.compare ? run(preset.compare) : null;

  let setting: Setting = { ...preset.main };
  let tIndex = TIMES.indexOf(preset.t);
  let result: Result = run(setting);
  let dirty = false;

  const read = (): Setting =>
    clampSetting({
      profile: profile.value,
      N: Number(input("N").value),
      R: Number(input("R").value),
      W: Number(input("W").value),
      f: Number(failure.value),
    });

  const { schedule, cancel } = frameScheduler(() => {
    if (dirty) {
      result = run(setting);
      dirty = false;
    }
    part("plot").innerHTML = chart(result, compare, tIndex);
    part("legend").innerHTML = legend(setting, preset.compare);
    part("readout").innerHTML = readout(setting, result, tIndex);
  });

  const onInput = (event: Event) => {
    const name = (event.target as HTMLInputElement | HTMLSelectElement).name;
    if (name === "t") {
      tIndex = Number(input("t").value);
      output("t-out").value = fmtTime(TIMES[tIndex]);
      schedule();
      return;
    }
    const next = read();
    for (const k of ["R", "W"] as const) {
      input(k).max = String(next.N);
      input(k).value = String(next[k]);
      output(`${k}-out`).value = String(next[k]);
    }
    output("N-out").value = String(next.N);
    setting = next;
    dirty = true;
    schedule();
  };
  const onSubmit = (event: Event) => event.preventDefault();

  input("R").max = String(setting.N);
  input("W").max = String(setting.N);
  enableControls(figure);
  form.addEventListener("input", onInput);
  form.addEventListener("change", onInput);
  form.addEventListener("submit", onSubmit);
  return () => {
    cancel();
    form.removeEventListener("input", onInput);
    form.removeEventListener("change", onInput);
    form.removeEventListener("submit", onSubmit);
  };
}
