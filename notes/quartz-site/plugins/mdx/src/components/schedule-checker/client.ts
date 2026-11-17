// Browser side of the schedule checker. Every change recomputes the whole
// figure from the current schedule; nothing here is incremental.

import { enableControls, lookup } from "../../shared/dom";
import { canMove, move } from "../mvcc-lab/model";
import { presets } from "./presets";
import { ansiText, edited, graphSvg, gridHtml, phenHtml, startView, verdictText, type View } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.sc");
  if (!figure) return () => {};
  const { part, button } = lookup(figure);
  const select = figure.querySelector<HTMLSelectElement>('select[name="preset"]')!;
  let v: View = startView(select.value);

  const draw = () => {
    const focused = document.activeElement as HTMLElement | null;
    const focusStep = focused && figure.contains(focused) ? focused.dataset.step : undefined;
    figure.dataset.preset = v.key;
    part("story").textContent = presets[v.key].story;
    part("grid").innerHTML = gridHtml(v);
    part("graph").innerHTML = graphSvg(v.steps);
    const vd = verdictText(v.steps);
    part("verdict").textContent = vd.text;
    part("verdict").dataset.tone = vd.tone;
    part("phen").innerHTML = phenHtml(v.steps);
    part("ansi").textContent = ansiText(v.steps);
    enableControls(figure);
    button("earlier").disabled = v.picked < 0 || !canMove(v.steps, v.picked, -1);
    button("later").disabled = v.picked < 0 || !canMove(v.steps, v.picked, 1);
    button("reset").disabled = !edited(v) && v.picked < 0;
    if (focusStep !== undefined) figure.querySelector<HTMLElement>(`[data-step="${v.picked >= 0 ? v.picked : focusStep}"]`)?.focus();
  };

  const onClick = (event: Event) => {
    const target = event.target as Element;
    const chip = target.closest<HTMLButtonElement>("button[data-step]");
    if (chip && figure.contains(chip)) {
      const i = Number(chip.dataset.step);
      v = { ...v, picked: v.picked === i ? -1 : i };
      draw();
      return;
    }
    const b = target.closest<HTMLButtonElement>("button[name]");
    if (!b || !figure.contains(b)) return;
    if (b.name === "earlier" || b.name === "later") {
      const dir = b.name === "earlier" ? -1 : 1;
      if (v.picked >= 0 && canMove(v.steps, v.picked, dir)) v = { ...v, steps: move(v.steps, v.picked, dir), picked: v.picked + dir };
    } else if (b.name === "reset") v = startView(v.key);
    draw();
  };
  const onChange = () => {
    v = startView(select.value);
    draw();
  };
  const onKey = (event: KeyboardEvent) => {
    if (v.picked < 0 || !(event.target as Element).closest?.("button[data-step]")) return;
    const dir = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!dir || !canMove(v.steps, v.picked, dir)) return;
    event.preventDefault();
    v = { ...v, steps: move(v.steps, v.picked, dir), picked: v.picked + dir };
    draw();
  };

  figure.addEventListener("click", onClick);
  figure.addEventListener("keydown", onKey);
  select.addEventListener("change", onChange);
  draw();
  return () => {
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("keydown", onKey);
    select.removeEventListener("change", onChange);
  };
}
