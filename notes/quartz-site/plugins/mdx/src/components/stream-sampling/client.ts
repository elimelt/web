// Browser side of the stream-sampling figure: loads the recorded substream and
// reruns the three samplers whenever a control moves.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { decode, KS, run, subsetMask, type Data } from "./model";
import { keptChart, keptText, META, readout, strips, type View } from "./render";

let cached: Promise<Data> | null = null;

async function fetchData(url: string): Promise<Data> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  // Some servers decompress .gz files on the way, so only inflate real gzip data.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return decode(bytes, META.names);
}

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ss");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  const select = figure.querySelector<HTMLSelectElement>("select[name=subset]")!;
  const base = figure.dataset.base ?? "";
  let data: Data | null = null;
  let seed = 1;
  const isNarrow = () => figure.clientWidth < 480;
  let narrow = isNarrow();

  const draw = () => {
    const K = KS[Number(input("k").value)];
    output("k-out").value = K.toLocaleString("en-US");
    if (!data) return;
    const mask = subsetMask(data, select.value);
    const r = run(data, K, mask, seed);
    const v: View = {
      K,
      subset: select.value,
      truth: r.truth,
      records: r.records,
      est: r.est,
      pvar: r.pvar,
      kept: r.first.idx.map((i) => ({ w: data!.w[i], inSubset: mask[i] === 1 })).sort((a, b) => b.w - a.w),
      tau: r.first.tau,
    };
    part("strips").innerHTML = strips(v, narrow);
    part("readout").innerHTML = readout(v);
    part("kept").innerHTML = keptChart(v, narrow);
    part("kept-text").innerHTML = keptText(v);
  };
  const { schedule, cancel } = frameScheduler(draw);

  const onInput = () => schedule();
  const onReseed = () => {
    seed += 1;
    schedule();
  };
  const onResize = () => {
    const n = isNarrow();
    if (n !== narrow) {
      narrow = n;
      schedule();
    }
  };

  figure.addEventListener("input", onInput);
  figure.addEventListener("change", onInput);
  button("reseed").addEventListener("click", onReseed);
  window.addEventListener("resize", onResize);

  let alive = true;
  cached ??= fetchData(`${base}records.bin.gz`);
  cached
    .then((d) => {
      if (!alive) return;
      data = d;
      enableControls(figure);
      draw();
    })
    .catch((e) => {
      cached = null;
      part("kept-text").textContent = `The recorded substream did not load (${(e as Error).message}).`;
    });
  return () => {
    alive = false;
    cancel();
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("change", onInput);
    window.removeEventListener("resize", onResize);
  };
}
