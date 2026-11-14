// Browser side of the hash ring figure: one scenario per copy, one or two
// controls, and a redraw of the ring, bars, table strip and readout after
// each action.

import { enableControls } from "../../shared/dom";
import { act, initial, POINT_STEPS, scenarioKey, settled, view, type State } from "./model";
import { barsHtml, ringSvg, stripHtml } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.hr");
  if (!figure) return () => {};
  const scenario = scenarioKey(figure.dataset.scenario);
  let state: State = initial(scenario, Number(figure.dataset.seed ?? 0) || 0);
  const part = (name: string) => figure.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  const button = (name: string) => figure.querySelector<HTMLButtonElement>(`button[name="${name}"]`);

  const draw = () => {
    const v = view(state);
    part("ring").innerHTML = ringSvg(v);
    part("bars").innerHTML = barsHtml(v);
    part("strip").innerHTML = stripHtml(v);
    part("readout").textContent = v.readout;
    const add = button("add");
    if (add) {
      add.textContent = state.added ? "Remove server F" : "Add server F";
      add.setAttribute("aria-pressed", String(state.added));
    }
    const move = button("move");
    if (move) move.disabled = settled(state);
    const out = figure.querySelector<HTMLOutputElement>('output[name="points-out"]');
    if (out) out.value = String(state.points);
  };

  const onClick = (event: Event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[name]");
    if (!target || !figure.contains(target)) return;
    state = act(state, target.name);
    draw();
  };
  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.name !== "points") return;
    state = act(state, "points", POINT_STEPS[Number(target.value)]);
    draw();
  };

  enableControls(figure);
  draw();
  figure.addEventListener("click", onClick);
  figure.addEventListener("input", onInput);
  return () => {
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("input", onInput);
  };
}
