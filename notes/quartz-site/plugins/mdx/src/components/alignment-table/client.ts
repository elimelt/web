// Browser side of the alignment table. The page already holds the finished
// table for the default strings; this enables the controls and redraws the
// grid, the narration and the alignment as the reader steps through the fill,
// edits the strings, moves the costs or switches to two rows.

import { enableControls, frameScheduler, lookup, prefersReducedMotion, whenVisible } from "../../shared/dom";
import { clean, half, steps, filled, fill } from "./model";
import { alignmentBlock, grid, initialState, narration, stats, view, type State } from "./render";

const PLAY_MS = 260;

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.at");
  if (!figure) return () => {};
  const { part, input, output, button } = lookup(figure);
  const state: State = initialState({ x: figure.dataset.x, y: figure.dataset.y });
  let timer = 0;
  let visible = true;

  const total = () => state.x.length * state.y.length;

  const draw = () => {
    const v = view(state);
    part("grid").innerHTML = grid(state, v);
    part("narration").innerHTML = narration(state, v);
    part("alignment").innerHTML = alignmentBlock(state, v);
    part("stats").textContent = stats(state, v);
    output("gap-out").value = half(state.gap);
    output("mismatch-out").value = half(state.mismatch);
    const done = state.step >= total();
    button("step").disabled = done;
    button("fill").disabled = done;
    button("reset").disabled = state.step === 0 && !state.inspect;
    button("play").textContent = timer ? "Pause" : "Play";
    button("play").disabled = total() === 0;
  };
  const scheduler = frameScheduler(draw);

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = 0;
  };

  const tick = () => {
    if (!visible) return;
    state.inspect = null;
    state.step = Math.min(total(), state.step + 1);
    if (state.step >= total()) stop();
    scheduler.schedule();
  };

  const play = () => {
    if (state.step >= total()) state.step = 0;
    state.inspect = null;
    timer = window.setInterval(tick, prefersReducedMotion() ? PLAY_MS * 3 : PLAY_MS);
  };

  const onClick = (e: Event) => {
    const target = e.target as Element;
    const cell = target.closest<HTMLElement>(".at-cell[data-i]");
    if (cell) {
      inspect(cell);
      return;
    }
    const b = target.closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    switch (b.name) {
      case "reset":
        stop();
        state.step = 0;
        state.inspect = null;
        break;
      case "step":
        stop();
        state.inspect = null;
        state.step = Math.min(total(), state.step + 1);
        break;
      case "play":
        if (timer) stop();
        else play();
        break;
      case "fill":
        stop();
        state.inspect = null;
        state.step = total();
        break;
      default:
        return;
    }
    draw();
  };

  const inspect = (cell: HTMLElement) => {
    const i = Number(cell.dataset.i);
    const j = Number(cell.dataset.j);
    const t = fill(state.x, state.y, state.gap, state.mismatch);
    if (!filled(t, state.step, i, j)) return;
    stop();
    const same = state.inspect && state.inspect[0] === i && state.inspect[1] === j;
    state.inspect = same ? null : [i, j];
    draw();
    part("grid").querySelector<HTMLElement>(`.at-cell[data-i="${i}"][data-j="${j}"]`)?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const cell = (e.target as Element).closest<HTMLElement>(".at-cell[data-i]");
    if (!cell || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    inspect(cell);
  };

  const onInput = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el.name === "x" || el.name === "y") {
      const value = clean(el.value);
      if (value !== el.value) el.value = value;
      state[el.name] = value;
    } else if (el.name === "gap" || el.name === "mismatch") {
      state[el.name] = Number(el.value);
    } else if (el.name === "tworows") {
      state.twoRows = el.checked;
      draw();
      return;
    } else return;
    stop();
    state.inspect = null;
    state.step = steps({ m: state.x.length, n: state.y.length });
    scheduler.schedule();
  };

  // The build rendered the default strings; a reader's browser may restore
  // other values into the inputs on back navigation, so read them first.
  const readInputs = () => {
    state.x = clean(input("x").value) || state.x;
    state.y = clean(input("y").value) || state.y;
    state.gap = Number(input("gap").value) || state.gap;
    state.mismatch = Number(input("mismatch").value);
    state.twoRows = input("tworows").checked;
    state.step = total();
  };

  readInputs();
  enableControls(figure);
  figure.classList.add("at-live");
  draw();
  figure.addEventListener("click", onClick);
  figure.addEventListener("keydown", onKey);
  figure.addEventListener("input", onInput);
  const unwatch = whenVisible(figure, (v) => {
    visible = v;
  });

  return () => {
    stop();
    scheduler.cancel();
    unwatch();
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("keydown", onKey);
    figure.removeEventListener("input", onInput);
  };
}
