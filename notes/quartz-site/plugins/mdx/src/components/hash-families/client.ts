// Browser side of the hash-family figure.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { simulate, type Family, type KeySet, type Result } from "./model";
import { histogram, readout, strip } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.hfam");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  const ks = figure.querySelector<HTMLSelectElement>('select[name="ks"]')!;
  const show = figure.querySelector<HTMLSelectElement>('select[name="show"]')!;
  let seed = Number(figure.dataset.seed) || 1;
  let last: Result | null = null;
  let lastKey = "";
  const draw = () => {
    const n = 2 ** Number(input("logn").value);
    output("n-out").value = n.toLocaleString("en-US");
    const key = `${ks.value}|${n}|${seed}`;
    if (key !== lastKey || !last) {
      last = simulate(ks.value as KeySet, n, seed);
      lastKey = key;
      part("strip").innerHTML = strip(last);
    }
    part("hist").innerHTML = histogram(last, show.value as Family);
    part("readout").innerHTML = readout(last, show.value as Family);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const rerun = () => {
    seed = (seed + 1) | 0;
    schedule();
  };
  const rb = button("rerun");
  figure.addEventListener("input", schedule);
  figure.addEventListener("change", schedule);
  rb.addEventListener("click", rerun);
  enableControls(figure);
  return () => {
    figure.removeEventListener("input", schedule);
    figure.removeEventListener("change", schedule);
    rb.removeEventListener("click", rerun);
    cancel();
  };
}
