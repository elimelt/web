// Browser side of the heavy-hitter figure: loads the recorded substream and
// reruns the chosen summary up to the chosen record whenever a control moves.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { BUDGETS, decode, outcome, permutation, run, truth, type Alg, type Stream } from "./model";
import { budgetText, chart, eventText, META, positionText, readout, type View } from "./render";

let cached: Promise<Stream> | null = null;

async function fetchStream(url: string): Promise<Stream> {
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
  const figure = root.querySelector<HTMLElement>("figure.hh");
  if (!figure) return () => {};
  const { input, output, part, button } = lookup(figure);
  const algSel = figure.querySelector<HTMLSelectElement>('select[name="alg"]')!;
  const orderSel = figure.querySelector<HTMLSelectElement>('select[name="order"]')!;
  const base = figure.dataset.base ?? "";
  let stream: Stream | null = null;
  let shuffleSeed = 1;
  let perm: Int32Array | null = null;
  let permSeed = 0;
  const isNarrow = () => figure.clientWidth < 480;
  let narrow = isNarrow();

  const order = (): Int32Array | null => {
    if (orderSel.value !== "shuffled" || !stream) return null;
    if (!perm || permSeed !== shuffleSeed) {
      perm = permutation(stream.keys.length, shuffleSeed);
      permSeed = shuffleSeed;
    }
    return perm;
  };

  const draw = () => {
    const budget = BUDGETS[Number(input("budget").value)];
    const t = Number(input("pos").value);
    output("budget-out").value = budgetText(budget);
    output("pos-out").value = positionText(t);
    button("reshuffle").disabled = orderSel.value !== "shuffled";
    if (!stream) return;
    const alg = algSel.value as Alg;
    const ord = order();
    const s = run(alg, budget, stream, ord, t, 1);
    const a = truth(stream, ord, t);
    const o = outcome(s, a);
    const v: View = {
      alg,
      budget,
      t,
      n: s.n,
      top: o.top,
      truth: o.rows.map((r) => r.truth),
      est: o.rows.map((r) => r.est),
      lo: o.rows.map((r) => r.lo),
      hi: o.rows.map((r) => r.hi),
      reported: o.rows.map((r) => r.reported),
      hits: o.hits,
      maxErr: o.maxErr,
      bound: o.bound,
    };
    part("chart").innerHTML = chart(v, narrow);
    part("readout").innerHTML = readout(v);
    part("event").innerHTML = eventText(alg, s.last);
  };
  const { schedule, cancel } = frameScheduler(draw);

  const onInput = () => schedule();
  const step = (to: number) => {
    input("pos").value = String(Math.min(META.records, Math.max(0, to)));
    schedule();
  };
  const onStep = () => {
    const t = Number(input("pos").value);
    step(t >= META.records ? 1 : t + 1);
  };
  const onHour = () => {
    const t = Number(input("pos").value);
    const next = META.hourStart.find((h) => h > t);
    step(next === undefined || t >= META.records ? META.hourStart[1] : next);
  };
  const onShuffle = () => {
    shuffleSeed += 1;
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
  button("step").addEventListener("click", onStep);
  button("hour").addEventListener("click", onHour);
  button("reshuffle").addEventListener("click", onShuffle);
  window.addEventListener("resize", onResize);

  let alive = true;
  cached ??= fetchStream(`${base}stream.u16.gz`);
  cached
    .then((s) => {
      if (!alive) return;
      stream = s;
      enableControls(figure);
      if (narrow) schedule();
      else draw();
    })
    .catch((e) => {
      cached = null;
      part("event").textContent = `The recorded stream did not load (${(e as Error).message}).`;
    });

  return () => {
    alive = false;
    cancel();
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("change", onInput);
    window.removeEventListener("resize", onResize);
  };
}
