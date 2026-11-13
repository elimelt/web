// Browser side of the speculative decoding figures. The page already holds
// both figures rendered at build time; this enables their controls and redraws
// the parts that change.

import { traces, type Domain } from "./model";
import { defaultSel, replayDefault, replayParts, speedDefault, speedParts, type ReplayState, type SpeedState } from "./render";

// Arrow keys step through the rounds.
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

const set = (fig: HTMLElement, name: string, html: string) => {
  fig.querySelector<HTMLElement>(`[data-part="${name}"]`)!.innerHTML = html;
};

const press = (fig: HTMLElement, name: string, value: string) => {
  for (const b of fig.querySelectorAll<HTMLButtonElement>(`button[name="${name}"]`)) b.setAttribute("aria-pressed", String(b.value === value));
};

function mountReplay(fig: HTMLElement): () => void {
  const s: ReplayState = replayDefault((fig.dataset.domain as Domain) || "code");
  const prev = fig.querySelector<HTMLButtonElement>('button[name="prev"]')!;
  const next = fig.querySelector<HTMLButtonElement>('button[name="next"]')!;
  const text = fig.querySelector<HTMLElement>('[data-part="text"]')!;

  const draw = () => {
    const p = replayParts(s);
    set(fig, "text", p.text);
    set(fig, "summary", p.summary);
    set(fig, "table", p.table);
    set(fig, "dist", p.dist);
    set(fig, "counter", p.counter);
    press(fig, "domain", s.domain);
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
  for (const b of fig.querySelectorAll<HTMLButtonElement>("button")) b.disabled = false;
  draw();
  return () => {
    fig.removeEventListener("click", onClick);
    fig.removeEventListener("keydown", onKey);
  };
}

function mountSpeed(fig: HTMLElement): () => void {
  const s: SpeedState = speedDefault();
  const select = fig.querySelector<HTMLSelectElement>('select[name="batch"]')!;
  const draw = () => {
    s.batch = select.value as SpeedState["batch"];
    const p = speedParts(s);
    set(fig, "tokens", p.tokens);
    set(fig, "speed", p.speed);
    set(fig, "note", p.note);
    press(fig, "domain", s.domain);
    press(fig, "temp", s.temp);
  };
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || !fig.contains(b)) return;
    if (b.name === "domain") s.domain = b.value as Domain;
    else if (b.name === "temp") s.temp = b.value as SpeedState["temp"];
    else return;
    draw();
  };
  fig.addEventListener("click", onClick);
  select.addEventListener("change", draw);
  for (const c of fig.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) c.disabled = false;
  draw();
  return () => {
    fig.removeEventListener("click", onClick);
    select.removeEventListener("change", draw);
  };
}

export function mount(root: HTMLElement): () => void {
  const replay = root.querySelector<HTMLElement>("figure.sd-replay");
  if (replay) return mountReplay(replay);
  const speed = root.querySelector<HTMLElement>("figure.sd-speed");
  if (speed) return mountSpeed(speed);
  return () => {};
}
