// Browser side of the MinHash and LSH figure: loads the recorded agreement
// bits and regroups them into bands whenever a slider moves.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { clampBands, decode, evaluate, type Pairs } from "./model";
import { curveChart, readout, scatter, type View } from "./render";

let cached: Promise<Pairs> | null = null;

async function fetchPairs(url: string): Promise<Pairs> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  // Some servers decompress .gz files on the way, so only inflate real gzip data.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return decode(bytes);
}

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ml");
  if (!figure) return () => {};
  const { input, output, part } = lookup(figure);
  const base = figure.dataset.base ?? "";
  let pairs: Pairs | null = null;
  const isNarrow = () => figure.clientWidth < 480;
  let narrow = isNarrow();

  const draw = () => {
    const r = Number(input("r").value);
    const b = clampBands(Number(input("b").value), r);
    input("b").value = String(b);
    output("b-out").value = String(b);
    output("r-out").value = String(r);
    part("k").textContent = String(b * r);
    if (!pairs) return;
    const res = evaluate(pairs, b, r);
    const v: View = { b, r, J: pairs.J, estimate: res.estimate, candidate: res.candidate, bins: res.bins };
    part("curve").innerHTML = curveChart(v, narrow);
    part("readout").innerHTML = readout(v);
    part("scatter").innerHTML = scatter(v, narrow);
  };
  const { schedule, cancel } = frameScheduler(draw);
  const onInput = () => schedule();
  const onResize = () => {
    const n = isNarrow();
    if (n !== narrow) {
      narrow = n;
      schedule();
    }
  };
  figure.addEventListener("input", onInput);
  figure.addEventListener("change", onInput);
  window.addEventListener("resize", onResize);

  let alive = true;
  cached ??= fetchPairs(`${base}pairs.bin.gz`);
  cached
    .then((p) => {
      if (!alive) return;
      pairs = p;
      enableControls(figure);
      draw();
    })
    .catch((e) => {
      cached = null;
      part("readout").textContent = `The recorded pairs did not load (${(e as Error).message}).`;
    });

  return () => {
    alive = false;
    cancel();
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("change", onInput);
    window.removeEventListener("resize", onResize);
  };
}
