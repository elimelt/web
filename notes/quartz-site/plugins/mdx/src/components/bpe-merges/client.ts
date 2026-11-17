// Browser side of the BPE figure: retrains when the text, base units or
// pre-tokenizer change, and steps through the merges.

import { enableControls, lookup, prefersReducedMotion } from "../../shared/dom";
import { PRESETS } from "./presets";
import { applied, chart, counter, MAX_CHARS, pairs, recent, startState, stats, text, trainFor, type State } from "./render";
import type { Rule, Training, Unit } from "./model";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.bp");
  if (!figure) return () => {};
  const { part, input, output, button } = lookup(figure);
  const select = figure.querySelector<HTMLSelectElement>('select[name="preset"]')!;
  const trainBox = figure.querySelector<HTMLTextAreaElement>('textarea[name="train"]')!;
  const applyBox = figure.querySelector<HTMLTextAreaElement>('textarea[name="apply"]')!;
  const slider = input("k");
  let s: State = startState(figure.dataset.preset);
  let tr: Training = trainFor(s);
  let timer = 0;
  let typing = 0;

  const drawStep = () => {
    s.k = Math.min(s.k, tr.merges.length);
    slider.max = String(tr.merges.length);
    slider.value = String(s.k);
    output("counter").textContent = counter(tr, s.k);
    part("stats").innerHTML = stats(tr, s.k);
    part("pairs").innerHTML = pairs(tr, s.k);
    part("recent").innerHTML = recent(tr, s.k);
    part("chart").innerHTML = chart(tr, s.k);
    part("k").textContent = String(s.k);
    part("text").innerHTML = text(tr, s.k);
    part("applied").innerHTML = applied(tr, s);
    button("back").disabled = s.k === 0;
    button("next").disabled = s.k >= tr.merges.length;
    button("play").textContent = timer ? "Pause" : "Play";
  };

  const retrain = () => {
    tr = trainFor(s);
    for (const u of ["char", "byte"]) button(`unit-${u}`).setAttribute("aria-pressed", String(s.unit === u));
    for (const r of ["gpt2", "o200k"]) button(`rule-${r}`).setAttribute("aria-pressed", String(s.rule === r));
    part("source").textContent =
      s.preset >= 0 ? PRESETS[s.preset].source : `Your own text${s.trainText.length > MAX_CHARS ? `, first ${MAX_CHARS} characters` : ""}.`;
    drawStep();
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = 0;
  };

  const play = () => {
    if (timer) return stop(), drawStep();
    if (s.k >= tr.merges.length) s.k = 0;
    timer = window.setInterval(() => {
      if (s.k >= tr.merges.length) stop();
      else s.k++;
      drawStep();
    }, prefersReducedMotion() ? 400 : 140);
    drawStep();
  };

  const onClick = (event: Event) => {
    const b = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    const name = b.name;
    if (name === "play") return play();
    stop();
    if (name === "back") s.k = Math.max(0, s.k - 1);
    else if (name === "next") s.k = Math.min(tr.merges.length, s.k + 1);
    else if (name.startsWith("unit-")) return (s.unit = name.slice(5) as Unit), retrain();
    else if (name.startsWith("rule-")) return (s.rule = name.slice(5) as Rule), retrain();
    drawStep();
  };

  const onInput = (event: Event) => {
    const t = event.target as HTMLElement;
    if (t === slider) {
      stop();
      s.k = Number(slider.value);
      drawStep();
    } else if (t === applyBox) {
      s.applyText = applyBox.value;
      part("applied").innerHTML = applied(tr, s);
    } else if (t === trainBox) {
      stop();
      s.trainText = trainBox.value;
      s.preset = -1;
      select.value = "-1";
      clearTimeout(typing);
      typing = window.setTimeout(retrain, 250);
    }
  };

  const onChange = (event: Event) => {
    if (event.target !== select) return;
    stop();
    const i = Number(select.value);
    if (i < 0) return;
    s = { ...s, preset: i, trainText: PRESETS[i].train, applyText: PRESETS[i].apply, k: 40 };
    trainBox.value = s.trainText;
    applyBox.value = s.applyText;
    retrain();
  };

  figure.addEventListener("click", onClick);
  figure.addEventListener("input", onInput);
  figure.addEventListener("change", onChange);
  enableControls(figure);
  retrain();
  return () => {
    stop();
    clearTimeout(typing);
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("change", onChange);
  };
}
