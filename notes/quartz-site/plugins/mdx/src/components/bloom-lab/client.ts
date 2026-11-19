// Browser side of the Bloom filter figure. Changing the layout, bits per key
// or seed starts a new sweep over k; the selected k is measured first and the
// rest follow one per task, so the figure answers at once and fills in.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { build, falsePositives, KMAX, LAYOUTS, M, ones, Q, type Layout, type Point } from "./model";
import { bitmap, chart, probeText, readout, smallFilter } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.bl");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  const sel = figure.querySelector<HTMLSelectElement>('select[name="layout"]')!;
  let seed = Number(figure.dataset.seed) || 1;
  let query = 0;
  let pts: (Point | undefined)[] = [];
  let sweepKey = "";
  let timer = 0;

  const state = () => ({ layout: sel.value as Layout, b: Number(input("b").value), k: Number(input("k").value) });

  const measure = (layout: Layout, b: number, k: number): Point => {
    const f = build(layout, M, Math.round(M / b), k, (seed * 131 + k) >>> 0);
    return { k, fill: ones(f) / M, fp: falsePositives(f, Q), q: Q };
  };

  const draw = () => {
    const { layout, b, k } = state();
    output("b-out").value = String(b);
    output("k-out").value = String(k);
    const key = `${layout}|${b}|${seed}`;
    if (key !== sweepKey) {
      sweepKey = key;
      pts = new Array(KMAX).fill(undefined);
      window.clearTimeout(timer);
      const step = () => {
        if (`${sel.value}|${input("b").value}|${seed}` !== key) return;
        const cur = Number(input("k").value);
        const next = pts[cur - 1] === undefined ? cur : pts.findIndex((p) => p === undefined) + 1;
        if (next === 0) return;
        pts[next - 1] = measure(layout, b, next);
        part("chart").innerHTML = chart(layout, b, Number(input("k").value), pts);
        if (next === Number(input("k").value)) part("readout").innerHTML = readout(layout, b, next, pts[next - 1]);
        timer = window.setTimeout(step, 0);
      };
      timer = window.setTimeout(step, 0);
    }
    part("blk-key").hidden = !LAYOUTS.find((l) => l.id === layout)!.block;
    part("chart").innerHTML = chart(layout, b, k, pts);
    part("readout").innerHTML = readout(layout, b, k, pts[k - 1]);
    const s = smallFilter(layout, b, k, seed, query);
    part("map").innerHTML = bitmap(layout, s);
    part("probes").innerHTML = probeText(s);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const rerun = () => {
    seed = (seed + 1) | 0;
    query = 0;
    schedule();
  };
  const another = () => {
    query += 1;
    schedule();
  };
  const rb = button("rerun");
  const nb = button("next");
  figure.addEventListener("input", schedule);
  figure.addEventListener("change", schedule);
  rb.addEventListener("click", rerun);
  nb.addEventListener("click", another);
  enableControls(figure);
  return () => {
    figure.removeEventListener("input", schedule);
    figure.removeEventListener("change", schedule);
    rb.removeEventListener("click", rerun);
    nb.removeEventListener("click", another);
    window.clearTimeout(timer);
    cancel();
  };
}
