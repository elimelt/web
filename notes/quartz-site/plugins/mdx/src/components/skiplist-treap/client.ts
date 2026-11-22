// Browser side of the skip list and treap figure: rebuilds both structures
// when the seed or p changes and redraws the search for the chosen title.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { mulberry32 } from "../../shared/random";
import { type Run, run } from "./model";
import { DATA, costChart, readout, skipChart, treapChart } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.st");
  if (!figure) return () => {};
  const { part } = lookup(figure);
  const keySel = figure.querySelector<HTMLSelectElement>("select[name=key]")!;
  const pSel = figure.querySelector<HTMLSelectElement>("select[name=p]")!;
  const reseed = figure.querySelector<HTMLButtonElement>("button[name=reseed]")!;
  const isNarrow = () => figure.clientWidth < 520;
  let narrow = isNarrow();
  let base = 1;
  let current: Run | null = null;
  let builtFor = "";

  const draw = () => {
    const p = Number(pSel.value);
    const key = `${base}:${p}`;
    if (!current || builtFor !== key) {
      current = run(DATA.order, p, base, mulberry32);
      builtFor = key;
      // The drawn titles change with the seed; keep the same position selected.
      const sel = keySel.selectedIndex;
      keySel.innerHTML = current.smallKeys.map((k, i) => `<option value="${i}">${i + 1}. ${DATA.titles[k].replace(/&/g, "&amp;").replace(/</g, "&lt;")}</option>`).join("");
      keySel.selectedIndex = Math.max(0, sel);
    }
    const m = Number(keySel.value);
    part("skip").innerHTML = skipChart(current, m, narrow);
    part("treap").innerHTML = treapChart(current, m);
    part("readout").innerHTML = readout(current, m);
    part("cost").innerHTML = costChart(current, narrow);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const onChange = () => schedule();
  const onReseed = () => {
    base++;
    schedule();
  };
  const onResize = () => {
    const n = isNarrow();
    if (n !== narrow) {
      narrow = n;
      schedule();
    }
  };
  figure.addEventListener("change", onChange);
  reseed.addEventListener("click", onReseed);
  window.addEventListener("resize", onResize);
  enableControls(figure);
  if (narrow) draw();

  return () => {
    cancel();
    figure.removeEventListener("change", onChange);
    reseed.removeEventListener("click", onReseed);
    window.removeEventListener("resize", onResize);
  };
}
