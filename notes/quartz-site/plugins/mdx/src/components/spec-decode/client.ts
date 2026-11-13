// Browser side of the replay figure. The page already holds the figure
// rendered at build time; this enables its controls and redraws the parts that
// change as the reader steps through the recorded rounds.

import { enableControls, lookup } from "../../shared/dom";
import { traces, type Domain } from "./model";
import { defaultSel, replayDefault, replayParts, type ReplayState } from "./render";

// Arrow keys step through the rounds.
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

export function mount(root: HTMLElement): () => void {
  const fig = root.querySelector<HTMLElement>("figure.sd-replay");
  if (!fig) return () => {};
  const { part, button } = lookup(fig);
  const s: ReplayState = replayDefault((fig.dataset.domain as Domain) || "code");
  const prev = button("prev");
  const next = button("next");
  const text = part("text");

  const draw = () => {
    const p = replayParts(s);
    part("text").innerHTML = p.text;
    part("summary").innerHTML = p.summary;
    part("table").innerHTML = p.table;
    part("dist").innerHTML = p.dist;
    part("counter").innerHTML = p.counter;
    for (const b of fig.querySelectorAll<HTMLButtonElement>('button[name="domain"]')) b.setAttribute("aria-pressed", String(b.value === s.domain));
    prev.disabled = s.round === 0;
    next.disabled = s.round === traces[s.domain].rounds.length - 1;
    text.scrollTop = text.scrollHeight;
  };
  const go = (round: number) => {
    s.round = Math.max(0, Math.min(traces[s.domain].rounds.length - 1, round));
    s.sel = defaultSel(traces[s.domain].rounds[s.round]);
    draw();
  };

  const onClick = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button, [data-pos]");
    if (!el || !fig.contains(el)) return;
    if (el instanceof HTMLButtonElement && el.name === "domain") {
      s.domain = el.value as Domain;
      go(0);
    } else if (el === prev) go(s.round - 1);
    else if (el === next) go(s.round + 1);
    else if (el.dataset.pos !== undefined) {
      s.sel = Number(el.dataset.pos);
      draw();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const step = STEP[e.key];
    if (step === undefined) return;
    go(s.round + step);
    e.preventDefault();
  };
  fig.addEventListener("click", onClick);
  fig.addEventListener("keydown", onKey);
  enableControls(fig);
  draw();
  return () => {
    fig.removeEventListener("click", onClick);
    fig.removeEventListener("keydown", onKey);
  };
}
