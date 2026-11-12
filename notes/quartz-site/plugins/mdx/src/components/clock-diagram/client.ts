// Browser side of the clock diagram. The page already holds the figure for
// its example; this enables the controls and redraws the diagram, the
// readout and the summary from the same functions whenever the reader picks
// events, edits the diagram or skews a clock.

import { addLocal, addMessage, compute, PROCS, remove } from "./model";
import { initialState, offsetLabel, readout, summary, svg, tOf, W, H, type Mode, type State, type View } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.cd");
  if (!figure) return () => {};
  let state: State = initialState(figure.dataset.example ?? "skew", (figure.dataset.view as View) ?? "lamport");
  const part = (name: string) => figure.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  const plot = part("svg");
  const slider = (p: number) => figure.querySelector<HTMLInputElement>(`input[name="off${p}"]`)!;
  const select = figure.querySelector<HTMLSelectElement>('select[name="example"]')!;
  let frame = 0;

  const draw = () => {
    frame = 0;
    const active = document.activeElement as Element | null;
    const focusedId = active?.closest?.(".cd-ev")?.getAttribute("data-id");
    const c = compute(state.diagram);
    plot.innerHTML = svg(state, c);
    part("readout").innerHTML = readout(state, c);
    // The build's copy went through Quartz, which wraps every table in a
    // .table-container; wrap the redrawn one the same way so nothing moves.
    const table = part("readout").querySelector("table");
    if (table) {
      const wrap = document.createElement("div");
      wrap.className = "table-container";
      table.replaceWith(wrap);
      wrap.append(table);
    }
    part("summary").textContent = summary(state, c);
    part("status").textContent = state.status;
    for (let p = 0; p < PROCS; p++) {
      figure.querySelector<HTMLOutputElement>(`output[name="off${p}-out"]`)!.value = `${offsetLabel(state.diagram.offsets[p])} ms`;
    }
    figure.dataset.mode = state.mode;
    if (focusedId) plot.querySelector<SVGGElement>(`.cd-ev[data-id="${focusedId}"]`)?.focus();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const pick = (id: string) => {
    if (state.selected.includes(id)) state.selected = state.selected.filter((s) => s !== id);
    else state.selected = [...state.selected, id].slice(-2);
    state.pending = null;
    state.status = "";
    schedule();
  };

  /** True time under the pointer, from its position in the SVG's own coordinates. */
  const timeAt = (event: MouseEvent): number | null => {
    const el = plot.querySelector<SVGSVGElement>("svg");
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    if (point.x < 0 || point.x > W || point.y < 0 || point.y > H) return null;
    return tOf(point.x);
  };

  const onLine = (proc: number, t: number) => {
    state.status = "";
    if (state.mode === "select") {
      state.selected = [];
    } else if (state.mode === "local") {
      const edit = addLocal(state.diagram, proc, t);
      if (edit.ok) {
        state.diagram = edit.diagram;
        state.selected = [edit.id!];
      } else state.status = edit.why;
    } else if (!state.pending) {
      state.pending = { proc, t: Math.round(t) };
      state.status = `Sending from P${proc + 1}. Click another process line, to the right, where the message arrives.`;
    } else {
      const edit = addMessage(state.diagram, state.pending, { proc, t });
      if (edit.ok) {
        state.diagram = edit.diagram;
        state.selected = [edit.id!];
        state.pending = null;
      } else state.status = edit.why;
    }
    schedule();
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element;
    const ev = target.closest(".cd-ev");
    if (ev) return pick(ev.getAttribute("data-id")!);
    const band = target.closest(".cd-band");
    if (!band) return;
    const t = timeAt(event);
    if (t !== null) onLine(Number(band.getAttribute("data-proc")), t);
  };

  const onKey = (event: KeyboardEvent) => {
    const ev = (event.target as Element).closest(".cd-ev");
    if (ev && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      pick(ev.getAttribute("data-id")!);
    } else if (event.key === "Escape" && state.pending) {
      state.pending = null;
      state.status = "";
      schedule();
    }
  };

  const onChange = (event: Event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (input.name === "view") state.view = input.value as View;
    else if (input.name === "mode") {
      state.mode = input.value as Mode;
      state.pending = null;
      state.status = "";
    } else if (input.name.startsWith("off")) {
      state.diagram = { ...state.diagram, offsets: state.diagram.offsets.map((o, p) => (input.name === `off${p}` ? Number(input.value) : o)) };
    } else if (input.name === "example") {
      state = { ...initialState(input.value, state.view), mode: state.mode };
      for (let p = 0; p < PROCS; p++) slider(p).value = String(state.diagram.offsets[p]);
    } else return;
    schedule();
  };

  const onButton = (event: MouseEvent) => {
    const button = (event.target as Element).closest("button");
    if (!button) return;
    if (button.name === "delete") {
      const focus = state.selected[state.selected.length - 1];
      if (!focus) {
        state.status = "Pick an event first.";
      } else {
        state.diagram = remove(state.diagram, focus);
        state.selected = state.selected.filter((id) => state.diagram.events.some((e) => e.id === id));
        state.status = "";
      }
    } else if (button.name === "clear") {
      state.diagram = { events: [], msgs: [], offsets: state.diagram.offsets };
      state.selected = [];
      state.pending = null;
      state.status = "Empty. Choose “adds an event” or “sends a message”, then click the process lines.";
    }
    schedule();
  };

  plot.addEventListener("click", onClick);
  plot.addEventListener("keydown", onKey);
  figure.addEventListener("input", onChange);
  figure.addEventListener("click", onButton);
  for (const control of figure.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) {
    control.disabled = false;
  }
  // Back and forward navigation can restore earlier control values, so start
  // from the controls rather than the defaults.
  const checked = (name: string) => figure.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
  state.view = (checked("view") as View) ?? state.view;
  state.mode = (checked("mode") as Mode) ?? state.mode;
  if (select.value !== state.example) state = { ...initialState(select.value, state.view), mode: state.mode };
  state.diagram.offsets = state.diagram.offsets.map((o, p) => Number(slider(p).value) || 0);
  draw();

  return () => {
    plot.removeEventListener("click", onClick);
    plot.removeEventListener("keydown", onKey);
    figure.removeEventListener("input", onChange);
    figure.removeEventListener("click", onButton);
    if (frame) cancelAnimationFrame(frame);
  };
}
