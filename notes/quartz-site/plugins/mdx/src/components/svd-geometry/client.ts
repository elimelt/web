// Browser side of the SVD geometry figure: dragging, keyboard nudges and
// presets. Every change redraws the panels and the readout from render.ts.

import { panels, presets, R, readout, type State } from "./render";
import type { Mat2, Vec2 } from "./svd2";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.sg");
  if (!figure) return () => {};
  const preset = presets[figure.dataset.preset ?? ""] ? figure.dataset.preset! : "shear";
  const state: State = { A: [...presets[preset].A] as Mat2, probe: [Math.cos(1.1), Math.sin(1.1)] };
  const stagesEl = figure.querySelector<HTMLElement>('[data-part="panels"]')!;
  const readoutEl = figure.querySelector<HTMLElement>('[data-part="readout"]')!;
  const buttons = [...figure.querySelectorAll<HTMLButtonElement>('button[name="preset"]')];
  let frame = 0;
  let drag: { handle: string; pointer: number } | null = null;
  let focused: string | null = null;

  const draw = () => {
    frame = 0;
    stagesEl.innerHTML = panels(state);
    readoutEl.innerHTML = readout(state);
    if (focused) stagesEl.querySelector<SVGElement>(`[data-handle="${focused}"]`)?.focus({ preventScroll: true });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const clamp = (p: Vec2): Vec2 => {
    const lim = R * 0.95;
    return [Math.max(-lim, Math.min(lim, p[0])), Math.max(-lim, Math.min(lim, p[1]))];
  };
  const set = (handle: string, p: Vec2) => {
    p = clamp(p);
    if (handle === "probe") state.probe = p;
    else {
      const j = handle === "col0" ? 0 : 1;
      state.A[j] = p[0];
      state.A[2 + j] = p[1];
      for (const b of buttons) b.setAttribute("aria-pressed", "false");
    }
    schedule();
  };
  const get = (handle: string): Vec2 => (handle === "probe" ? state.probe : handle === "col0" ? [state.A[0], state.A[2]] : [state.A[1], state.A[3]]);

  const world = (event: PointerEvent, handle: string): Vec2 | null => {
    const svg = stagesEl.querySelector<SVGSVGElement>(`svg[data-panel="${handle === "probe" ? 0 : 3}"]`);
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const size = svg.viewBox.baseVal.width;
    return [((p.x - size / 2) / size) * 2 * R, (-(p.y - size / 2) / size) * 2 * R];
  };

  const down = (event: PointerEvent) => {
    const target = (event.target as Element).closest<SVGElement>("[data-handle]");
    if (!target) return;
    event.preventDefault();
    drag = { handle: target.dataset.handle!, pointer: event.pointerId };
    focused = drag.handle;
    stagesEl.setPointerCapture(event.pointerId);
    const p = world(event, drag.handle);
    if (p) set(drag.handle, p);
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const p = world(event, drag.handle);
    if (p) set(drag.handle, p);
  };
  const up = (event: PointerEvent) => {
    if (drag && event.pointerId === drag.pointer) drag = null;
  };
  const key = (event: KeyboardEvent) => {
    const target = (event.target as Element).closest<SVGElement>("[data-handle]");
    if (!target) return;
    const step = event.shiftKey ? 0.25 : 0.05;
    const d: Record<string, Vec2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = d[event.key];
    if (!delta) return;
    event.preventDefault();
    focused = target.dataset.handle!;
    const p = get(focused);
    set(focused, [p[0] + delta[0], p[1] + delta[1]]);
  };
  const focusin = (event: FocusEvent) => {
    focused = (event.target as Element).closest<SVGElement>("[data-handle]")?.dataset.handle ?? null;
  };
  const choose = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[name="preset"]');
    if (!button || !presets[button.value]) return;
    state.A = [...presets[button.value].A] as Mat2;
    for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
    focused = null;
    schedule();
  };

  stagesEl.addEventListener("pointerdown", down);
  stagesEl.addEventListener("pointermove", move);
  stagesEl.addEventListener("pointerup", up);
  stagesEl.addEventListener("pointercancel", up);
  stagesEl.addEventListener("keydown", key);
  stagesEl.addEventListener("focusin", focusin);
  figure.addEventListener("click", choose);
  for (const b of buttons) b.disabled = false;
  figure.classList.add("sg-live");
  draw();

  return () => {
    stagesEl.removeEventListener("pointerdown", down);
    stagesEl.removeEventListener("pointermove", move);
    stagesEl.removeEventListener("pointerup", up);
    stagesEl.removeEventListener("pointercancel", up);
    stagesEl.removeEventListener("keydown", key);
    stagesEl.removeEventListener("focusin", focusin);
    figure.removeEventListener("click", choose);
    if (frame) cancelAnimationFrame(frame);
  };
}
