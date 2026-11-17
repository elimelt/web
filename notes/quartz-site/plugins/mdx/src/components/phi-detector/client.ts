// Browser side of the heartbeat failure-detector figure.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { quality, timeouts, type Kind } from "./model";
import { DEFAULT_STATE, detail, fmtClock, fmtThreshold, model, overview, positionOf, readout, thresholdAt, tradeoff, type Model, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.phd");
  if (!figure) return () => {};
  const { input, output, part } = lookup(figure);
  const select = figure.querySelector<HTMLSelectElement>("select[name=window]")!;
  const kindButtons = [...figure.querySelectorAll<HTMLButtonElement>("button[data-kind]")];
  const s: State = { ...DEFAULT_STATE };
  const models = new Map<number, Model>();
  const get = (w: number) => {
    let m = models.get(w);
    if (!m) models.set(w, (m = model(w)));
    return m;
  };
  let full = true;
  const draw = () => {
    const m = get(s.window);
    const tau = timeouts(s.kind, s.threshold, m.stats, m.start);
    const q = quality(m.arrivals, tau, m.start);
    output("thr-out").value = fmtThreshold(s.kind, s.threshold);
    output("view-out").value = fmtClock(s.view);
    part("detail").innerHTML = detail(m, tau, s.view);
    part("overview").innerHTML = overview(m, tau, s.view);
    if (full) part("tradeoff").innerHTML = tradeoff(m, s, q);
    part("readout").innerHTML = readout(m, s, q, tau);
    for (const b of kindButtons) b.setAttribute("aria-pressed", String(b.dataset.kind === s.kind));
    select.disabled = s.kind === "timeout";
    full = true;
  };
  const { schedule, cancel } = frameScheduler(draw);
  const onInput = (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.name === "thr") s.threshold = thresholdAt(s.kind, Number(t.value));
    else if (t.name === "view") {
      s.view = Number(t.value) * 1000;
      full = false;
    } else if (t.name === "window") s.window = Number(select.value);
    schedule();
  };
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-kind]");
    if (!b) return;
    const kind = b.dataset.kind as Kind;
    if (kind === s.kind) return;
    // keep the slider position; pick the matching default for a new kind
    s.kind = kind;
    s.threshold = kind === "timeout" ? 500 : 8;
    input("thr").value = String(positionOf(kind, s.threshold));
    schedule();
  };
  // A click on the overview strip moves the detail view there.
  const ov = part("overview");
  const onOverview = (e: MouseEvent) => {
    const svg = ov.querySelector("svg");
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const fx = ((e.clientX - r.left) / r.width) * vb.width;
    const m = get(s.window);
    const span = m.arrivals[m.arrivals.length - 1] - m.arrivals[0];
    const view = input("view");
    const ms = ((fx - 44) / (vb.width - 54)) * span - 10_000;
    s.view = Math.max(0, Math.min(Number(view.max) * 1000, Math.round(ms / 1000) * 1000));
    view.value = String(s.view / 1000);
    full = false;
    schedule();
  };
  figure.addEventListener("input", onInput);
  figure.addEventListener("change", onInput);
  figure.addEventListener("click", onClick);
  ov.addEventListener("click", onOverview);
  enableControls(figure);
  draw();
  return () => {
    figure.removeEventListener("input", onInput);
    figure.removeEventListener("change", onInput);
    figure.removeEventListener("click", onClick);
    ov.removeEventListener("click", onOverview);
    cancel();
  };
}
