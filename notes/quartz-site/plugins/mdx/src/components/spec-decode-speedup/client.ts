// Browser side of the speedup charts. The page already holds them rendered at
// build time; this enables the controls and redraws the charts for the chosen
// text, temperature and batch size.

import { enableControls, lookup } from "../../shared/dom";
import type { Domain } from "../spec-decode/model";
import { speedDefault, speedParts, type SpeedState } from "../spec-decode/render";

export function mount(root: HTMLElement): () => void {
  const fig = root.querySelector<HTMLElement>("figure.sd-speed");
  if (!fig) return () => {};
  const { part } = lookup(fig);
  const s: SpeedState = speedDefault();
  const select = fig.querySelector<HTMLSelectElement>('select[name="batch"]')!;
  const press = (name: string, value: string) => {
    for (const b of fig.querySelectorAll<HTMLButtonElement>(`button[name="${name}"]`)) b.setAttribute("aria-pressed", String(b.value === value));
  };
  const draw = () => {
    s.batch = select.value as SpeedState["batch"];
    const p = speedParts(s);
    part("tokens").innerHTML = p.tokens;
    part("speed").innerHTML = p.speed;
    part("note").innerHTML = p.note;
    press("domain", s.domain);
    press("temp", s.temp);
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
  enableControls(fig);
  draw();
  return () => {
    fig.removeEventListener("click", onClick);
    select.removeEventListener("change", draw);
  };
}
