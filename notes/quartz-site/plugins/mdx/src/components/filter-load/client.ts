// Browser side of the construction-threshold figure. A change of layout, size
// or seed starts a new sweep over load; the selected load is measured first
// and the rest follow one per task, so the figure answers at once and fills in.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { num } from "../../shared/format";
import { build, keysAt, LOADS, measure, type Kind, type Point } from "./model";
import { chart, grid, readout, runText, SMALL } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.fl");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  const kindSel = figure.querySelector<HTMLSelectElement>('select[name="kind"]')!;
  const sizeSel = figure.querySelector<HTMLSelectElement>('select[name="size"]')!;
  let seed = Number(figure.dataset.seed) || 1;
  let small = 0;
  let pts: (Point | undefined)[] = [];
  let sweepKey = "";
  let timer = 0;
  // Charts are redrawn in a narrower coordinate system on phones so that the
  // axis text keeps a readable size.
  const isNarrow = () => figure.clientWidth < 480;
  let narrow = isNarrow();

  const state = () => ({ kind: kindSel.value as Kind, S: Number(sizeSel.value), li: Number(input("load").value) });
  const keyOf = () => `${kindSel.value}|${sizeSel.value}|${seed}`;

  const draw = () => {
    const { kind, S, li } = state();
    const load = LOADS[li];
    output("load-out").value = num(load, 2);
    const key = keyOf();
    if (key !== sweepKey) {
      sweepKey = key;
      pts = new Array(LOADS.length).fill(undefined);
      window.clearTimeout(timer);
      const step = () => {
        if (keyOf() !== key) return;
        const cur = Number(input("load").value);
        let next = pts[cur] === undefined ? cur : -1;
        if (next < 0) {
          // nearest unmeasured load to the selected one
          for (let d = 1; d < LOADS.length && next < 0; d++) {
            if (cur - d >= 0 && pts[cur - d] === undefined) next = cur - d;
            else if (cur + d < LOADS.length && pts[cur + d] === undefined) next = cur + d;
          }
        }
        if (next < 0) return;
        pts[next] = measure(kind, S, next, seed);
        const now = Number(input("load").value);
        part("chart").innerHTML = chart(kind, S, LOADS[now], pts, narrow);
        if (next === now) part("readout").innerHTML = readout(kind, S, LOADS[now], pts[now]);
        timer = window.setTimeout(step, 0);
      };
      timer = window.setTimeout(step, 0);
    }
    part("chart").innerHTML = chart(kind, S, load, pts, narrow);
    part("readout").innerHTML = readout(kind, S, load, pts[li]);
    const run = build(kind, SMALL, keysAt(SMALL, load), (seed + small * 7777) >>> 0);
    part("map").innerHTML = grid(run);
    part("run").innerHTML = runText(run);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const rerun = () => {
    seed = (seed + 1) | 0;
    small = 0;
    schedule();
  };
  const another = () => {
    small += 1;
    schedule();
  };
  const rb = button("rerun");
  const nb = button("next");
  figure.addEventListener("input", schedule);
  figure.addEventListener("change", schedule);
  rb.addEventListener("click", rerun);
  nb.addEventListener("click", another);
  const onResize = () => {
    if (isNarrow() !== narrow) {
      narrow = !narrow;
      schedule();
    }
  };
  window.addEventListener("resize", onResize);
  enableControls(figure);
  if (narrow) schedule();
  return () => {
    window.removeEventListener("resize", onResize);
    figure.removeEventListener("input", schedule);
    figure.removeEventListener("change", schedule);
    rb.removeEventListener("click", rerun);
    nb.removeEventListener("click", another);
    window.clearTimeout(timer);
    cancel();
  };
}
