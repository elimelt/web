// Browser side of the pruning figure. The build already drew the default
// state. When the figure first scrolls into view this fetches the layer's
// recorded inputs and weights (about 230 KB, shared with the quantization
// figure), then every control re-prunes the 2048 x 16 weights and redoes the
// multiply.

import { enableControls, frameScheduler, lookup, whenVisible } from "../../shared/dom";
import { num } from "../../shared/format";
import pruneData from "../../../../../../content/ml/serving-systems/sparsity-and-pruning/prune-layer.json";
import { chips, keptChart, readout, sweepChart } from "./draw";
import { DEFAULTS, loadLayer, loudest, prune, type Layer, type LayerData, type PruneData, type Settings } from "./model";

export function mount(root: HTMLElement): () => void {
  const fig = root.querySelector<HTMLElement>("figure.pl");
  if (!fig) return () => {};
  const { part, input, output } = lookup(fig);
  const level = input("level");
  const P = pruneData as unknown as PruneData;
  const set: Settings = { ...DEFAULTS };
  let L: Layer | null = null;
  let loud = 0;
  let alive = true;

  const draw = () => {
    if (!L) return;
    const r = prune(L, set);
    part("readout").innerHTML = readout(L, r, set, loud);
    part("kept").innerHTML = keptChart(L, r);
    part("chips").innerHTML = chips(L, r);
    part("sweep").innerHTML = sweepChart(P.sweep, L, set);
    for (const b of fig.querySelectorAll<HTMLButtonElement>("button[name]")) {
      const v = set[b.name as "method" | "group" | "pattern"];
      b.setAttribute("aria-pressed", String(b.value === v));
      // n:m patterns fix the sparsity at 50% and compare within groups of m inputs
      if (b.name === "group") b.disabled = set.pattern !== "unstructured";
    }
    level.disabled = set.pattern !== "unstructured";
    output("level-out").textContent = set.pattern === "unstructured" ? `${num(L.grid[set.level] * 100, 0)}%` : "50%";
  };
  const frame = frameScheduler(draw);

  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[name]");
    if (!b || !fig.contains(b) || b.disabled) return;
    if (b.name === "method") set.method = b.value as Settings["method"];
    if (b.name === "group") set.group = b.value as Settings["group"];
    if (b.name === "pattern") set.pattern = b.value as Settings["pattern"];
    frame.schedule();
  };
  const onInput = () => {
    set.level = Number(level.value);
    frame.schedule();
  };

  const stopWatching = whenVisible(fig, (visible) => {
    if (!visible || L) return;
    stopWatching();
    const url = fig.dataset.src || "outlier-layer.json";
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.json() as Promise<LayerData>;
      })
      .then((d) => {
        if (!alive) return;
        L = loadLayer(d, P);
        loud = loudest(L);
        enableControls(fig);
        fig.addEventListener("click", onClick);
        level.addEventListener("input", onInput);
        draw();
      })
      .catch((err) => {
        part("readout").textContent = `The figure's data didn't load (${err.message}); the picture below is the default setting.`;
      });
  });

  return () => {
    alive = false;
    stopWatching();
    frame.cancel();
    fig.removeEventListener("click", onClick);
    level.removeEventListener("input", onInput);
  };
}
