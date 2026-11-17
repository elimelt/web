// Browser side of the router load figure. The build drew the default state
// from the 8-expert, block-12 data; other model and layer choices fetch their
// own file (about 44 KB each) the first time they are picked.

import { enableControls, frameScheduler, lookup, whenVisible } from "../../shared/dom";
import { num } from "../../shared/format";
import { chart, readout } from "./draw";
import { DEFAULTS, loadRoutes, simulate, type Mode, type RouterData, type Routes, type Settings, type Traffic } from "./model";

export function mount(root: HTMLElement): () => void {
  const fig = root.querySelector<HTMLElement>("figure.rl");
  if (!fig) return () => {};
  const { part, input, output } = lookup(fig);
  const cf = input("cf");
  const set: Settings = { ...DEFAULTS };
  let model = "e8";
  let layer = 11;
  const cache = new Map<string, Promise<Routes>>();
  let current: Routes | null = null;
  let alive = true;

  const load = (m: string, l: number): Promise<Routes> => {
    const key = `${m}-layer${l}`;
    let p = cache.get(key);
    if (!p) {
      const url = `${fig.dataset.base ?? ""}router-${key}.json`;
      p = fetch(url).then((res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.json() as Promise<RouterData>;
      }).then(loadRoutes);
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    return p;
  };

  const draw = () => {
    if (!current) return;
    const res = simulate(current, set);
    part("readout").innerHTML = readout(current, set, res);
    part("chart").innerHTML = chart(current, set, res);
    for (const b of fig.querySelectorAll<HTMLButtonElement>("button[name]")) {
      const v = b.value;
      const on =
        b.name === "model" ? v === model :
        b.name === "layer" ? v === String(layer) :
        b.name === "traffic" ? v === set.traffic :
        b.name === "batch" ? v === String(set.batch) :
        b.name === "mode" ? v === set.mode : null;
      if (on !== null) b.setAttribute("aria-pressed", String(on));
    }
    output("cf-out").textContent = num(set.cf, 2);
  };
  const frame = frameScheduler(draw);

  const switchData = () => {
    const m = model;
    const l = layer;
    load(m, l)
      .then((r) => {
        if (!alive || m !== model || l !== layer) return;
        current = r;
        frame.schedule();
      })
      .catch((err) => {
        part("readout").textContent = `The figure's data didn't load (${err.message}).`;
      });
  };

  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[name]");
    if (!b || !fig.contains(b) || b.disabled) return;
    if (b.name === "model" || b.name === "layer") {
      if (b.name === "model") model = b.value;
      else layer = Number(b.value);
      set.draw = 0;
      switchData();
      return;
    }
    if (b.name === "traffic") set.traffic = b.value as Traffic;
    if (b.name === "batch") set.batch = Number(b.value);
    if (b.name === "mode") set.mode = b.value as Mode;
    if (b.name === "resample") set.draw++;
    frame.schedule();
  };
  const onInput = () => {
    set.cf = Number(cf.value);
    frame.schedule();
  };

  const stopWatching = whenVisible(fig, (visible) => {
    if (!visible || current) return;
    stopWatching();
    switchData();
    enableControls(fig);
    fig.addEventListener("click", onClick);
    cf.addEventListener("input", onInput);
  });

  return () => {
    alive = false;
    stopWatching();
    frame.cancel();
    fig.removeEventListener("click", onClick);
    cf.removeEventListener("input", onInput);
  };
}
