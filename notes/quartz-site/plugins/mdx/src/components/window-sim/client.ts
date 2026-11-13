// Browser side of the window-sim figure. The page already holds the figure
// rendered at build time; this enables the controls, re-runs the model when
// they change, redraws the charts at the figure's real width, and handles
// zooming (drag) and losing a segment (click) on the time-sequence plot.

import { simulate, summarize, type Result } from "./model";
import { bdpText, bufChart, DEFAULT_WIDTH, outputs, readout, seqChart, seqGeometry, type View } from "./render";
import { PRESETS, presetById, toParams, type State } from "./state";

let instances = 0;

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ws");
  if (!figure) return () => {};
  const uid = `ws-${++instances}-${Math.random().toString(36).slice(2, 7)}`;
  const form = figure.querySelector<HTMLFormElement>("form.ws-form")!;
  const input = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const part = (name: string) => figure.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  const unzoom = figure.querySelector<HTMLButtonElement>('button[name="unzoom"]')!;
  const clearDrops = figure.querySelector<HTMLButtonElement>('button[name="clear-drops"]')!;
  const presetButtons = [...figure.querySelectorAll<HTMLButtonElement>('button[name="preset"]')];
  const seqPart = part("seq");

  let state: State = structuredClone(presetById(figure.dataset.preset).state);
  let result: Result = simulate(toParams(state));
  let view: View = { t0: 0, t1: result.params.durationMs };
  let width = DEFAULT_WIDTH;
  let frame = 0;
  let dirtyModel = true;

  const readControls = () => {
    for (const k of ["rate", "rtt", "buf", "read", "chunk", "duration"] as const) state[k] = Number(input(k).value);
    for (const k of ["pause", "sws", "loseUpdate"] as const) state[k] = input(k).checked;
  };
  const writeControls = () => {
    for (const k of ["rate", "rtt", "buf", "read", "chunk", "duration"] as const) input(k).value = String(state[k]);
    for (const k of ["pause", "sws", "loseUpdate"] as const) input(k).checked = state[k];
  };

  const draw = () => {
    frame = 0;
    if (dirtyModel) {
      result = simulate(toParams(state));
      view = { t0: 0, t1: result.params.durationMs };
      dirtyModel = false;
    }
    const outs = outputs(state);
    for (const [name, text] of Object.entries(outs)) {
      const o = form.querySelector<HTMLOutputElement>(`output[name="${name}"]`);
      if (o) o.value = text;
    }
    input("chunk").disabled = !Number.isFinite(toParams(state).readBps);
    part("bdp").textContent = bdpText(state);
    seqPart.innerHTML = seqChart(result, view, width).replace(/CLIPID/g, `${uid}-clip`);
    part("buf").innerHTML = bufChart(result, view, width);
    part("readout").innerHTML = readout(result, summarize(result));
    unzoom.hidden = view.t0 === 0 && view.t1 === result.params.durationMs;
    clearDrops.hidden = state.drops.length === 0;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const markPreset = (id: string | null) => {
    for (const b of presetButtons) b.setAttribute("aria-pressed", String(b.value === id));
    const preset = PRESETS.find((p) => p.id === id);
    part("note").textContent = preset ? preset.note : "";
    part("note").hidden = !preset;
  };

  const onInput = () => {
    readControls();
    state.drops = []; // segment numbers mean different packets once anything else changes
    markPreset(null);
    dirtyModel = true;
    schedule();
  };
  const onPreset = (e: Event) => {
    const id = (e.currentTarget as HTMLButtonElement).value;
    state = structuredClone(presetById(id).state);
    writeControls();
    markPreset(id);
    dirtyModel = true;
    schedule();
  };
  const onUnzoom = () => {
    view = { t0: 0, t1: result.params.durationMs };
    schedule();
  };
  const onClearDrops = () => {
    state.drops = [];
    dirtyModel = true;
    schedule();
  };

  // Pointer handling on the time-sequence plot: a drag zooms to the dragged
  // time range, a click loses (or restores) the nearest data segment.
  let dragStart: number | null = null;
  let brush: SVGRectElement | null = null;
  const toSvgX = (e: PointerEvent) => {
    const svg = seqPart.querySelector("svg")!;
    const rect = svg.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * width) / rect.width, y: ((e.clientY - rect.top) * width) / rect.width, svg };
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const { x, svg } = toSvgX(e);
    dragStart = x;
    seqPart.setPointerCapture(e.pointerId);
    brush = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    brush.setAttribute("class", "ws-brush");
    brush.setAttribute("y", "14");
    brush.setAttribute("height", String(300 - 14 - 34));
    brush.setAttribute("x", String(x));
    brush.setAttribute("width", "0");
    svg.appendChild(brush);
  };
  const onMove = (e: PointerEvent) => {
    if (dragStart === null || !brush) return;
    const { x } = toSvgX(e);
    brush.setAttribute("x", String(Math.min(x, dragStart)));
    brush.setAttribute("width", String(Math.abs(x - dragStart)));
  };
  const onUp = (e: PointerEvent) => {
    if (dragStart === null) return;
    const { x, y } = toSvgX(e);
    const start = dragStart;
    dragStart = null;
    brush?.remove();
    brush = null;
    const g = seqGeometry(result, view, width);
    const toT = (px: number) => view.t0 + ((px - 58) / (width - 58 - 14)) * (view.t1 - view.t0);
    if (Math.abs(x - start) > 6) {
      const a = Math.max(view.t0, toT(Math.min(x, start)));
      const b = Math.min(view.t1, toT(Math.max(x, start)));
      if (b - a > 0.01) {
        view = { t0: a, t1: b };
        schedule();
      }
      return;
    }
    // A click: find the nearest data segment tick within 8 px.
    let best: { id: number; d: number } | null = null;
    for (const tx of result.txs) {
      if (tx.kind === "probe" || tx.t < view.t0 || tx.t > view.t1) continue;
      const px = g.x(tx.t);
      if (Math.abs(px - x) > 8) continue;
      const y0 = g.y(tx.seq);
      const y1 = g.y(tx.seq + tx.len);
      const dy = y < y1 ? y1 - y : y > y0 ? y - y0 : 0;
      const d = Math.hypot(px - x, dy);
      if (d <= 8 && (!best || d < best.d)) best = { id: tx.id, d };
    }
    if (!best) return;
    const keep = view;
    state.drops = state.drops.includes(best.id) ? state.drops.filter((id) => id !== best!.id) : [...state.drops, best.id];
    markPreset(null);
    result = simulate(toParams(state));
    view = keep;
    schedule();
  };

  const resize = new ResizeObserver(() => {
    const w = Math.round(seqPart.clientWidth);
    if (w > 0 && Math.abs(w - width) > 1) {
      width = Math.max(300, w);
      schedule();
    }
  });

  form.addEventListener("input", onInput);
  form.addEventListener("submit", (e) => e.preventDefault());
  for (const b of presetButtons) b.addEventListener("click", onPreset);
  unzoom.addEventListener("click", onUnzoom);
  clearDrops.addEventListener("click", onClearDrops);
  seqPart.addEventListener("pointerdown", onDown);
  seqPart.addEventListener("pointermove", onMove);
  seqPart.addEventListener("pointerup", onUp);
  seqPart.addEventListener("pointercancel", () => {
    dragStart = null;
    brush?.remove();
  });
  resize.observe(seqPart);
  for (const el of figure.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) el.disabled = false;
  // Back and forward navigation can restore earlier control values, so start
  // from the controls rather than the preset.
  readControls();
  if (JSON.stringify(state) !== JSON.stringify({ ...presetById(figure.dataset.preset).state })) {
    state.drops = [];
    markPreset(null);
  }
  width = Math.max(300, Math.round(seqPart.clientWidth) || DEFAULT_WIDTH);
  dirtyModel = true;
  draw();

  return () => {
    form.removeEventListener("input", onInput);
    resize.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
