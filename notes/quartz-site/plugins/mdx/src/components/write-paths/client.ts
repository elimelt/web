// Browser side of the write-paths figure: enables the controls, replays the
// stream to the chosen point when a control changes, and redraws the parts
// render() drew at build time.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { btreeSvg, chartSvg, eventText, lsmSvg, replay, streamLength, tableHtml, type State } from "./render";
import type { Run } from "./model";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.wp");
  if (!figure) return () => {};
  const { part, input, output, button } = lookup(figure);
  const select = (name: string) => figure.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  const state: State = JSON.parse(figure.dataset.state ?? "{}");
  let run: Run = replay(state);

  const draw = () => {
    const len = streamLength(state.workload);
    const at = input("at");
    at.max = String(len);
    at.value = String(run.pos);
    output("at-out").value = `${run.pos} of ${len}`;
    output("key-out").value = String(state.key);
    part("event").textContent = eventText(run);
    part("btree").innerHTML = btreeSvg(run, state.key);
    part("lsm").innerHTML = lsmSvg(run, state.key);
    part("table").innerHTML = tableHtml(run, state.key);
    part("chart").innerHTML = chartSvg(run, state);
    button("step").disabled = run.done;
  };
  const frame = frameScheduler(draw);

  const onInput = (event: Event) => {
    const t = event.target as HTMLInputElement | HTMLSelectElement;
    if (!figure.contains(t)) return;
    if (t.name === "key") {
      state.key = Number(t.value);
    } else if (t.name === "at") {
      // Replay from the start: the stream is at most 192 writes.
      state.at = Number(t.value);
      run = replay(state);
    } else if (t.name === "workload" || t.name === "batch") {
      if (t.name === "workload") state.workload = t.value as State["workload"];
      else state.batch = Number(t.value);
      state.at = Math.min(state.at, streamLength(state.workload));
      run = replay(state);
    } else return;
    frame.schedule();
  };
  const onClick = (event: Event) => {
    const t = event.target as HTMLButtonElement;
    if (t.name === "step") {
      run.step();
      state.at = run.pos;
    } else if (t.name === "reset") {
      state.at = 0;
      run = replay(state);
    } else return;
    frame.schedule();
  };

  // Keep the controls in step with the state if the browser restored old form values.
  select("workload").value = state.workload;
  select("batch").value = String(state.batch);
  input("key").value = String(state.key);
  enableControls(figure);
  draw();
  figure.addEventListener("input", onInput);
  figure.addEventListener("change", onInput);
  figure.addEventListener("click", onClick);
  return () => {
    frame.cancel();
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("change", onInput);
    figure.removeEventListener("click", onClick);
  };
}
