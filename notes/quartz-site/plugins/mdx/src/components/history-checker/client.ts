// Browser side of the history checker. The page already holds the preset's
// timeline and verdicts; this enables the controls and reruns the checkers
// and redraws after every drag, click and edit.

import { enableControls, frameScheduler, lookup, svgPoint } from "../../shared/dom";
import { add, cycleRead, move, remove, stretch, type Model, type Op } from "./model";
import { analyze, initialState, svg, tPerPx, verdictList, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.hc");
  if (!figure) return () => {};
  const { part } = lookup(figure);
  const plot = part("svg");
  const verdicts = part("verdicts");
  const presetSelect = figure.querySelector<HTMLSelectElement>('select[name="preset"]')!;
  const procSelect = figure.querySelector<HTMLSelectElement>('select[name="proc"]')!;
  let state: State = initialState(presetSelect.value || figure.dataset.preset || "stale");

  const draw = () => {
    const focused = (document.activeElement as Element | null)?.closest?.(".hc-op")?.getAttribute("data-id");
    const focusedVerdict = (document.activeElement as HTMLButtonElement | null)?.closest?.(".hc-verdict")?.getAttribute("value");
    const a = analyze(state);
    plot.innerHTML = svg(state, a);
    verdicts.innerHTML = verdictList(state, a);
    for (const b of verdicts.querySelectorAll("button")) b.disabled = false;
    if (focused) plot.querySelector<SVGGElement>(`.hc-op[data-id="${focused}"]`)?.focus();
    if (focusedVerdict) verdicts.querySelector<HTMLButtonElement>(`button[value="${focusedVerdict}"]`)?.focus();
  };
  const { schedule, cancel } = frameScheduler(draw);

  const setOps = (ops: Op[]) => {
    state = { ...state, ops };
    schedule();
  };

  // ---- Dragging a bar, or one of its ends.
  let drag: { id: string; end: "call" | "ret" | null; x0: number; ops: Op[]; moved: boolean; pointer: number } | null = null;

  const svgX = (event: PointerEvent): number | null => {
    const el = plot.querySelector<SVGSVGElement>("svg");
    return el ? (svgPoint(el, event)?.x ?? null) : null;
  };

  const onDown = (event: PointerEvent) => {
    const g = (event.target as Element).closest(".hc-op");
    if (!g || event.button !== 0) return;
    const x = svgX(event);
    if (x === null) return;
    const id = g.getAttribute("data-id")!;
    const end = ((event.target as Element).getAttribute("data-end") as "call" | "ret" | null) ?? null;
    drag = { id, end, x0: x, ops: state.ops, moved: false, pointer: event.pointerId };
    plot.setPointerCapture(event.pointerId);
    state = { ...state, selected: id };
    event.preventDefault();
    schedule();
  };

  const onMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const x = svgX(event);
    if (x === null) return;
    if (Math.abs(x - drag.x0) > 3) drag.moved = true;
    if (!drag.moved) return;
    const dt = (x - drag.x0) * tPerPx(state);
    const me = drag.ops.find((o) => o.id === drag!.id)!;
    setOps(drag.end ? stretch(drag.ops, drag.id, drag.end, me[drag.end] + dt, state.axis) : move(drag.ops, drag.id, dt, state.axis));
  };

  const onUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    if (plot.hasPointerCapture(event.pointerId)) plot.releasePointerCapture(event.pointerId);
    if (!d.moved && !d.end) setOps(cycleRead(state.ops, d.id));
  };

  const onKey = (event: KeyboardEvent) => {
    const g = (event.target as Element).closest(".hc-op");
    if (!g) return;
    const id = g.getAttribute("data-id")!;
    const me = state.ops.find((o) => o.id === id);
    if (!me) return;
    const step = state.axis.step;
    let ops: Op[] | null = null;
    if (event.key === "Enter" || event.key === " ") ops = cycleRead(state.ops, id);
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const dt = event.key === "ArrowLeft" ? -step : step;
      ops = event.shiftKey ? stretch(state.ops, id, "ret", me.ret + dt, state.axis) : move(state.ops, id, dt, state.axis);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      state = { ...state, selected: null };
      setOps(remove(state.ops, id));
      return;
    }
    if (!ops) return;
    event.preventDefault();
    state = { ...state, selected: id };
    setOps(ops);
  };

  const onFocus = (event: FocusEvent) => {
    const g = (event.target as Element).closest?.(".hc-op");
    if (g && state.selected !== g.getAttribute("data-id")) {
      state = { ...state, selected: g.getAttribute("data-id") };
      schedule();
    }
  };

  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest("button");
    if (!button || button.disabled) return;
    if (button.name === "show") {
      state = { ...state, shown: button.value as Model };
      schedule();
    } else if (button.name === "add-w" || button.name === "add-r") {
      const p = Number(procSelect.value);
      const ops = add(state.ops, p, button.name === "add-w" ? "w" : "r", state.axis);
      if (ops) {
        state = { ...state, procs: Math.max(state.procs, p + 1), selected: ops[ops.length - 1].id };
        setOps(ops);
      }
    } else if (button.name === "delete" && state.selected) {
      const id = state.selected;
      state = { ...state, selected: null };
      setOps(remove(state.ops, id));
    }
  };

  const onPreset = () => {
    state = initialState(presetSelect.value);
    figure.dataset.preset = state.preset;
    schedule();
  };

  plot.addEventListener("pointerdown", onDown);
  plot.addEventListener("pointermove", onMove);
  plot.addEventListener("pointerup", onUp);
  plot.addEventListener("pointercancel", onUp);
  plot.addEventListener("keydown", onKey);
  plot.addEventListener("focusin", onFocus);
  figure.addEventListener("click", onClick);
  presetSelect.addEventListener("change", onPreset);
  enableControls(figure);
  figure.dataset.live = "true";
  draw();

  return () => {
    plot.removeEventListener("pointerdown", onDown);
    plot.removeEventListener("pointermove", onMove);
    plot.removeEventListener("pointerup", onUp);
    plot.removeEventListener("pointercancel", onUp);
    plot.removeEventListener("keydown", onKey);
    plot.removeEventListener("focusin", onFocus);
    figure.removeEventListener("click", onClick);
    presetSelect.removeEventListener("change", onPreset);
    cancel();
  };
}
