// Browser side of the quantile-sketch figure: loads the recorded sample and
// reruns both sketches up to the chosen position whenever a control moves.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { ALPHAS, compare, decode, grid, kll, KS, type Sample } from "./model";
import { chart, eventText, GRID_POINTS, levelsChart, META, positionText, readout, type View } from "./render";

let cached: Promise<Sample> | null = null;

async function fetchSample(url: string): Promise<Sample> {
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
  const figure = root.querySelector<HTMLElement>("figure.qs");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  const base = figure.dataset.base ?? "";
  const qs = grid(GRID_POINTS);
  let sample: Sample | null = null;
  let seed = 1;
  const isNarrow = () => figure.clientWidth < 480;
  let narrow = isNarrow();

  const draw = () => {
    const k = KS[Number(input("k").value)];
    const alpha = ALPHAS[Number(input("alpha").value)];
    const t = Number(input("pos").value);
    output("k-out").value = String(k);
    output("alpha-out").value = String(alpha);
    output("pos-out").value = positionText(t);
    if (!sample) return;
    const c = compare(sample, t, k, alpha, seed, qs);
    const v: View = {
      k,
      alpha,
      n: t,
      qs,
      truth: c.rows.map((r) => r.truth),
      kll: c.rows.map((r) => r.kll),
      dd: c.rows.map((r) => r.dd),
      kllRank: c.rows.map((r) => r.kllRank),
      ddRank: c.rows.map((r) => r.ddRank),
      levels: c.kll.levels.map((l) => l.length),
      compactions: c.kll.compactions,
      bins: c.dd.maxKey - c.dd.minKey + 1,
    };
    part("chart").innerHTML = chart(v, narrow);
    part("readout").innerHTML = readout(v);
    part("levels").innerHTML = levelsChart(v, narrow);
    part("event").innerHTML = eventText(c.kll.last, c.kll.compactions);
  };
  const { schedule, cancel } = frameScheduler(draw);

  const onInput = () => schedule();
  // Moves to the value after which KLL next compacts, by doubling the
  // search window and then bisecting on the compaction count.
  const onCompact = () => {
    if (!sample) return;
    const k = KS[Number(input("k").value)];
    const t0 = Number(input("pos").value);
    if (t0 >= META.records) {
      input("pos").value = "1";
      schedule();
      return;
    }
    const count = (t: number) => kll(sample!.values, t, k, seed).compactions;
    const c0 = count(t0);
    let lo = t0;
    let hi = Math.min(META.records, t0 + 1);
    while (hi < META.records && count(hi) === c0) {
      lo = hi;
      hi = Math.min(META.records, t0 + 2 * (hi - t0));
    }
    if (count(hi) === c0) {
      input("pos").value = String(META.records);
    } else {
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (count(m) === c0) lo = m;
        else hi = m;
      }
      input("pos").value = String(hi);
    }
    schedule();
  };
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
  button("compact").addEventListener("click", onCompact);
  button("reseed").addEventListener("click", onReseed);
  window.addEventListener("resize", onResize);

  let alive = true;
  cached ??= fetchSample(`${base}stream.u16.gz`);
  cached
    .then((s) => {
      if (!alive) return;
      sample = s;
      enableControls(figure);
      draw();
    })
    .catch((e) => {
      cached = null;
      part("event").textContent = `The recorded sample did not load (${(e as Error).message}).`;
    });

  return () => {
    alive = false;
    cancel();
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("change", onInput);
    window.removeEventListener("resize", onResize);
  };
}
