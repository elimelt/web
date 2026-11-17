// Browser side of the snapshot cut figure: move the cut by dragging a handle,
// clicking a process line or pressing arrow keys on a handle, and redraw the
// diagram and readout from the same functions the build used.

import { enableControls, frameScheduler, lookup, svgPoint } from "../../shared/dom";
import { largestConsistentWithin } from "./model";
import { controls, cutAtX, initialState, PROCS, readout, svg, trace, type State } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.sc");
  if (!figure) return () => {};
  const { part, input } = lookup(figure);
  const plot = part("svg");
  const markers = input("markers");
  let state: State = initialState(figure.dataset.start ?? "naive");
  state.markers = markers.checked;
  let dragging: number | null = null;

  const draw = () => {
    const focused = (document.activeElement as Element | null)?.closest?.(".sc-handle")?.getAttribute("data-proc");
    plot.innerHTML = svg(state);
    part("readout").innerHTML = readout(state);
    // Quartz wraps build-time tables in .table-container; match it.
    const table = part("readout").querySelector("table");
    if (table) {
      const wrap = document.createElement("div");
      wrap.className = "table-container";
      table.replaceWith(wrap);
      wrap.append(table);
    }
    part("buttons").innerHTML = controls(state);
    enableControls(part("buttons"));
    if (focused != null) plot.querySelector<SVGGElement>(`.sc-handle[data-proc="${focused}"]`)?.focus();
  };
  const { schedule, cancel } = frameScheduler(draw);

  const setCut = (p: number, k: number) => {
    const n = trace.events[p].length;
    const v = Math.max(0, Math.min(n, k));
    if (state.cut[p] === v) return;
    state = { ...state, cut: state.cut.map((c, i) => (i === p ? v : c)) };
    schedule();
  };

  const xAt = (event: PointerEvent): number | null => {
    const el = plot.querySelector<SVGSVGElement>("svg");
    const pt = el ? svgPoint(el, event) : null;
    return pt ? pt.x : null;
  };

  const onDown = (event: PointerEvent) => {
    const target = event.target as Element;
    const handle = target.closest(".sc-handle");
    const band = target.closest(".sc-band");
    const el = handle ?? band;
    if (!el) return;
    const p = Number(el.getAttribute("data-proc"));
    const x = xAt(event);
    if (x === null) return;
    event.preventDefault();
    if (handle) {
      dragging = p;
      plot.setPointerCapture(event.pointerId);
    }
    setCut(p, cutAtX(p, x));
  };
  const onMove = (event: PointerEvent) => {
    if (dragging === null) return;
    const x = xAt(event);
    if (x !== null) setCut(dragging, cutAtX(dragging, x));
  };
  const onUp = (event: PointerEvent) => {
    if (dragging === null) return;
    dragging = null;
    if (plot.hasPointerCapture(event.pointerId)) plot.releasePointerCapture(event.pointerId);
  };

  const onKey = (event: KeyboardEvent) => {
    const handle = (event.target as Element).closest(".sc-handle");
    if (!handle) return;
    const p = Number(handle.getAttribute("data-proc"));
    const n = trace.events[p].length;
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
    if (event.key in moves) setCut(p, state.cut[p] + moves[event.key]);
    else if (event.key === "Home") setCut(p, 0);
    else if (event.key === "End") setCut(p, n);
    else return;
    event.preventDefault();
  };

  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest("button");
    if (!button || !figure.contains(button)) return;
    if (button.name === "naive" || button.name === "cl") {
      state = { ...state, cut: [...trace.cuts[button.name].cut] };
      if (button.name === "cl" && !state.markers) {
        state.markers = true;
        markers.checked = true;
      }
    } else if (button.name === "fix") {
      state = { ...state, cut: largestConsistentWithin(trace, state.cut) };
    } else return;
    schedule();
  };

  const onChange = () => {
    state = { ...state, markers: markers.checked };
    schedule();
  };

  plot.addEventListener("pointerdown", onDown);
  plot.addEventListener("pointermove", onMove);
  plot.addEventListener("pointerup", onUp);
  plot.addEventListener("pointercancel", onUp);
  plot.addEventListener("keydown", onKey);
  figure.addEventListener("click", onClick);
  markers.addEventListener("change", onChange);
  enableControls(figure);
  if (PROCS) draw();

  return () => {
    plot.removeEventListener("pointerdown", onDown);
    plot.removeEventListener("pointermove", onMove);
    plot.removeEventListener("pointerup", onUp);
    plot.removeEventListener("pointercancel", onUp);
    plot.removeEventListener("keydown", onKey);
    figure.removeEventListener("click", onClick);
    markers.removeEventListener("change", onChange);
    cancel();
  };
}
