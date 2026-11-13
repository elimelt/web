// Browser side of the least-squares figure: drag b, change sigma2 and the
// cutoff, and redraw from render.ts.

import { R } from "../svd-geometry/render";
import type { Vec2 } from "../svd-geometry/svd2";
import { defaultState, panels, readout, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.sp");
  if (!figure) return () => {};
  const state: State = defaultState();
  const stagesEl = figure.querySelector<HTMLElement>('[data-part="panels"]')!;
  const readoutEl = figure.querySelector<HTMLElement>('[data-part="readout"]')!;
  const input = (name: string) => figure.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const output = (name: string) => figure.querySelector<HTMLOutputElement>(`output[name="${name}"]`)!;
  let frame = 0;
  let drag: number | null = null;
  let focused = false;

  const draw = () => {
    frame = 0;
    state.sigma2 = Number(input("sigma2").value);
    state.cutoff = Number(input("cutoff").value);
    output("sigma2-out").value = state.sigma2.toFixed(3);
    output("cutoff-out").value = state.cutoff.toFixed(2);
    stagesEl.innerHTML = panels(state);
    readoutEl.innerHTML = readout(state);
    if (focused) stagesEl.querySelector<SVGElement>('[data-handle="b"]')?.focus({ preventScroll: true });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const setB = (p: Vec2) => {
    const lim = R * 0.95;
    state.b = [Math.max(-lim, Math.min(lim, p[0])), Math.max(-lim, Math.min(lim, p[1]))];
    schedule();
  };
  const world = (event: PointerEvent): Vec2 | null => {
    const svg = stagesEl.querySelector<SVGSVGElement>('svg[data-panel="b"]');
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const size = svg.viewBox.baseVal.width;
    return [((p.x - size / 2) / size) * 2 * R, (-(p.y - size / 2) / size) * 2 * R];
  };
  const down = (event: PointerEvent) => {
    const onB = (event.target as Element).closest('[data-handle="b"]');
    const inPanel = (event.target as Element).closest('svg[data-panel="b"]');
    if (!onB && !inPanel) return;
    event.preventDefault();
    drag = event.pointerId;
    focused = true;
    stagesEl.setPointerCapture(event.pointerId);
    const p = world(event);
    if (p) setB(p);
  };
  const move = (event: PointerEvent) => {
    if (drag !== event.pointerId) return;
    const p = world(event);
    if (p) setB(p);
  };
  const up = (event: PointerEvent) => {
    if (drag === event.pointerId) drag = null;
  };
  const key = (event: KeyboardEvent) => {
    if (!(event.target as Element).closest('[data-handle="b"]')) return;
    const step = event.shiftKey ? 0.25 : 0.05;
    const d: Record<string, Vec2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = d[event.key];
    if (!delta) return;
    event.preventDefault();
    focused = true;
    setB([state.b[0] + delta[0], state.b[1] + delta[1]]);
  };
  const focusin = (event: FocusEvent) => {
    focused = Boolean((event.target as Element).closest('[data-handle="b"]'));
  };

  figure.addEventListener("input", schedule);
  stagesEl.addEventListener("pointerdown", down);
  stagesEl.addEventListener("pointermove", move);
  stagesEl.addEventListener("pointerup", up);
  stagesEl.addEventListener("pointercancel", up);
  stagesEl.addEventListener("keydown", key);
  figure.addEventListener("focusin", focusin);
  for (const el of figure.querySelectorAll<HTMLInputElement>("input")) el.disabled = false;
  figure.classList.add("sg-live");
  draw();

  return () => {
    figure.removeEventListener("input", schedule);
    stagesEl.removeEventListener("pointerdown", down);
    stagesEl.removeEventListener("pointermove", move);
    stagesEl.removeEventListener("pointerup", up);
    stagesEl.removeEventListener("pointercancel", up);
    stagesEl.removeEventListener("keydown", key);
    figure.removeEventListener("focusin", focusin);
    if (frame) cancelAnimationFrame(frame);
  };
}
