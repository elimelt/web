// Browser side of the MVCC lab. Every redraw replays the schedule from the
// start up to the current step, so Back, jumping to a step, switching the
// isolation level and reordering steps are all the same operation.

import { enableControls, lookup } from "../../shared/dom";
import { canMove, move, type Level } from "./model";
import { graphSvg, horizonText, noteText, rowsHtml, ssiText, startView, stateOf, stepsHtml, txnsHtml, verdictHtml, whyHtml, type View } from "./render";
import { scenarios } from "./scenarios";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.mv");
  if (!figure) return () => {};
  const { part, button } = lookup(figure);
  const select = figure.querySelector<HTMLSelectElement>('select[name="scenario"]')!;
  const levelButtons = [...figure.querySelectorAll<HTMLButtonElement>('button[name="level"]')];

  // Back and forward navigation can restore an earlier select value.
  let v: View = startView(select.value);

  const draw = () => {
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && figure.contains(active) ? keyOf(active) : null;
    const s = stateOf(v);
    figure.dataset.scenario = v.key;
    part("story").textContent = scenarios[v.key].story;
    part("steps").innerHTML = stepsHtml(v, s);
    part("note").textContent = noteText(v, s);
    part("rows").innerHTML = rowsHtml(v, s);
    part("horizon").textContent = horizonText(s);
    part("txns").innerHTML = txnsHtml(v, s);
    part("why").innerHTML = whyHtml(v, s);
    part("graph").innerHTML = graphSvg(s);
    const vd = verdictHtml(v, s);
    part("verdict").textContent = vd.text;
    part("verdict").dataset.tone = vd.tone;
    part("ssi").textContent = ssiText(s);
    for (const b of levelButtons) b.setAttribute("aria-pressed", String(b.value === v.level));
    enableControls(figure);
    button("back").disabled = v.done === 0;
    button("reset").disabled = v.done === 0 && v.steps === scenarios[v.key].steps;
    button("next").disabled = v.done >= v.steps.length;
    button("end").disabled = v.done >= v.steps.length;
    button("earlier").disabled = v.picked < 0 || !canMove(v.steps, v.picked, -1);
    button("later").disabled = v.picked < 0 || !canMove(v.steps, v.picked, 1);
    if (focusKey) {
      const el = figure.querySelector<HTMLElement>(focusKey);
      if (el && !(el as HTMLButtonElement).disabled) el.focus();
    }
  };

  const keyOf = (el: HTMLElement): string | null => {
    if (el.dataset.step) return `[data-step="${el.dataset.step}"]`;
    if (el.dataset.txn) return `[data-txn="${el.dataset.txn}"]`;
    if (el.matches(".mv-bar button, .mv-levels button")) return `button[name="${(el as HTMLButtonElement).name}"]${el.matches(".mv-levels button") ? `[value="${(el as HTMLButtonElement).value}"]` : ""}`;
    return null;
  };

  const onClick = (event: Event) => {
    const target = event.target as Element;
    const chip = target.closest<HTMLButtonElement>("button[data-step]");
    if (chip) {
      const i = Number(chip.dataset.step);
      v = { ...v, picked: v.picked === i ? -1 : i, done: i + 1, focus: v.steps[i].t };
      return draw();
    }
    const txn = target.closest<HTMLButtonElement>("button[data-txn]");
    if (txn) {
      v = { ...v, focus: Number(txn.dataset.txn) };
      return draw();
    }
    const b = target.closest<HTMLButtonElement>("button[name]");
    if (!b || !figure.contains(b)) return;
    if (b.name === "level") v = { ...v, level: b.value as Level };
    else if (b.name === "next") v = { ...v, done: Math.min(v.steps.length, v.done + 1), focus: v.steps[v.done]?.t ?? v.focus };
    else if (b.name === "back") v = { ...v, done: Math.max(0, v.done - 1) };
    else if (b.name === "end") v = { ...v, done: v.steps.length };
    else if (b.name === "reset") v = { ...startView(v.key), level: v.level };
    else if ((b.name === "earlier" || b.name === "later") && v.picked >= 0) {
      const dir = b.name === "earlier" ? -1 : 1;
      if (canMove(v.steps, v.picked, dir)) {
        const steps = move(v.steps, v.picked, dir);
        const picked = v.picked + dir;
        v = { ...v, steps, picked, done: Math.max(v.done, picked + 1) };
      }
    } else return;
    draw();
  };

  const onChange = () => {
    v = startView(select.value);
    draw();
  };

  figure.addEventListener("click", onClick);
  select.addEventListener("change", onChange);
  draw();
  return () => {
    figure.removeEventListener("click", onClick);
    select.removeEventListener("change", onChange);
  };
}
