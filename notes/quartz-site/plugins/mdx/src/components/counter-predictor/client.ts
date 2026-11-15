// Browser side of the counter predictor figure. The build already rendered
// the finished replay; this enables Replay (animate from the first outcome,
// or pause) and Step (one outcome at a time) and redraws from render.ts.

import { enableControls, frameScheduler, lookup, prefersReducedMotion } from "../../shared/dom";
import { bitsOf, presetKey, presets, replay } from "./model";
import { states, status, tape } from "./render";

const STEP_MS = 160;

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.cp");
  if (!figure) return () => {};
  const p = presets[presetKey(figure.dataset.preset)];
  const bits = bitsOf(figure.dataset.bits);
  const steps = replay(bits, p.start[bits], p.outcomes);
  const { part, button } = lookup(figure);
  const play = button("play");
  const stepBtn = button("step");
  let shown = steps.length;
  let timer = 0;

  const draw = () => {
    const current = shown === 0 ? steps[0].before : steps[shown - 1].after;
    part("states").innerHTML = states(bits, current);
    part("tape").innerHTML = tape(steps, shown);
    part("status").innerHTML = status(bits, steps, shown);
    play.textContent = timer ? "Pause" : "Replay";
  };
  const { schedule, cancel } = frameScheduler(draw);

  const stop = () => {
    if (timer) window.clearInterval(timer);
    timer = 0;
  };
  const advance = () => {
    if (shown >= steps.length) shown = 0;
    else shown += 1;
    if (shown >= steps.length) stop();
    schedule();
  };

  const onPlay = () => {
    if (timer) {
      stop();
    } else {
      if (shown >= steps.length) shown = 0;
      timer = window.setInterval(advance, prefersReducedMotion() ? STEP_MS * 3 : STEP_MS);
    }
    schedule();
  };
  const onStep = () => {
    stop();
    advance();
  };

  play.addEventListener("click", onPlay);
  stepBtn.addEventListener("click", onStep);
  enableControls(figure);

  return () => {
    stop();
    cancel();
    play.removeEventListener("click", onPlay);
    stepBtn.removeEventListener("click", onStep);
  };
}
