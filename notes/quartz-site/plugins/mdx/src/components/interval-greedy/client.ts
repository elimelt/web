// Browser side of the interval-greedy figure. The page already holds the
// figure rendered at build time; this enables its controls, lets the reader
// drag intervals, steps through the run, and searches for inputs where the
// chosen rule loses.

import {
  HORIZON,
  MAX_INTERVALS,
  PRESETS,
  randomInstance,
  rng,
  searchCounterexample,
  tidy,
  type Mode,
  type Order,
  type Rule,
} from "./model";
import { chart, detail, initialState, narration, stepLabel, type State } from "./render";

type Drag = { id: number; end: "s" | "f" | "move"; x0: number; s0: number; f0: number; moved: boolean; pointer: number };

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ig");
  if (!figure) return () => {};
  const state: State = initialState({ preset: figure.dataset.preset });
  const q = <T extends Element>(sel: string) => figure.querySelector<T>(sel)!;
  const part = (name: string) => q<HTMLElement>(`[data-part="${name}"]`);
  const select = (name: string) => q<HTMLSelectElement>(`select[name="${name}"]`);
  const button = (name: string) => q<HTMLButtonElement>(`button[name="${name}"]`);
  const chartBox = part("chart");
  let seed = 1;
  let timer = 0;
  let searching = 0;
  let drag: Drag | null = null;

  const pxPerUnit = () => (Math.max(300, state.width) - 36) / HORIZON;

  const draw = () => {
    const n = state.intervals.length;
    state.step = Math.min(state.step, n);
    figure.dataset.mode = state.mode;
    for (const tab of figure.querySelectorAll<HTMLButtonElement>('button[name="mode"]')) tab.setAttribute("aria-selected", String(tab.value === state.mode));
    const focused = (document.activeElement as HTMLElement | null)?.closest?.("[data-i]")?.getAttribute("data-i");
    chartBox.innerHTML = chart(state);
    if (focused != null) chartBox.querySelector<SVGElement>(`g[data-i="${focused}"]`)?.focus();
    part("narration").innerHTML = narration(state);
    part("detail").innerHTML = detail(state);
    const next = figure.querySelector<HTMLButtonElement>('button[name="next-optimum"]');
    if (next) next.disabled = false;
    q<HTMLOutputElement>('output[name="step"]').value = stepLabel(state);
    button("first").disabled = button("prev").disabled = state.step === 0;
    button("last").disabled = button("next").disabled = state.step === n;
    button("play").textContent = timer ? "Pause" : "Play";
    button("play").disabled = n === 0;
    button("add").disabled = n >= MAX_INTERVALS;
    button("remove").disabled = state.selected === null;
    button("search").disabled = searching !== 0;
  };

  const status = (text: string) => {
    part("status").textContent = text;
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = 0;
  };

  const edited = () => {
    stop();
    state.step = state.intervals.length;
    state.optimum = 0;
    select("preset").value = "edited";
    status("");
  };

  const load = (intervals: { s: number; f: number }[]) => {
    state.intervals = intervals.map((a) => ({ ...a }));
    state.selected = null;
    edited();
  };

  const runSearch = () => {
    const mode = state.mode;
    const rule: Rule | Order = mode === "schedule" ? state.rule : state.order;
    const proven = (mode === "schedule" && rule === "finish") || (mode === "partition" && rule === "start");
    const budget = proven ? 2000 : 40000;
    const chunk = 250;
    let tried = 0;
    const id = ++searching;
    status("Searching random inputs…");
    draw();
    const work = () => {
      if (id !== searching) return;
      const result = searchCounterexample(mode, rule, seed++ * 7919, chunk);
      tried += result.tried;
      if (result.found) {
        searching = 0;
        load(result.found);
        status(`Found one after ${tried.toLocaleString()} random inputs, then removed intervals while it still lost: ${result.found.length} left.`);
        draw();
      } else if (tried >= budget) {
        searching = 0;
        status(
          proven
            ? `No loss in ${tried.toLocaleString()} random inputs, and there never will be: the proof covers every input.`
            : `No loss in ${tried.toLocaleString()} random inputs. This rule rarely loses on small inputs; try again or load the preset.`,
        );
        draw();
      } else {
        status(`Searching random inputs… ${tried.toLocaleString()} so far`);
        setTimeout(work, 0);
      }
    };
    setTimeout(work, 0);
  };

  const onClick = (e: Event) => {
    const target = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!target || target.disabled) return;
    const n = state.intervals.length;
    switch (target.name) {
      case "mode":
        state.mode = target.value as Mode;
        state.step = n;
        stop();
        status("");
        break;
      case "first":
        stop();
        state.step = 0;
        break;
      case "prev":
        stop();
        state.step = Math.max(0, state.step - 1);
        break;
      case "next":
        stop();
        state.step = Math.min(n, state.step + 1);
        break;
      case "last":
        stop();
        state.step = n;
        break;
      case "play":
        if (timer) stop();
        else {
          if (state.step === n) state.step = 0;
          timer = window.setInterval(() => {
            state.step++;
            if (state.step >= state.intervals.length) stop();
            draw();
          }, 700);
        }
        break;
      case "add": {
        const rand = rng(seed++ * 104729);
        state.intervals.push(randomInstance(rand, 1)[0]);
        state.selected = state.intervals.length - 1;
        edited();
        break;
      }
      case "remove":
        if (state.selected !== null) state.intervals.splice(state.selected, 1);
        state.selected = null;
        edited();
        break;
      case "random":
        load(tidy(randomInstance(rng(seed++ * 15485863), 8)));
        break;
      case "search":
        runSearch();
        return;
      case "next-optimum":
        state.optimum++;
        break;
      default:
        return;
    }
    draw();
  };

  const onChange = (e: Event) => {
    const target = e.target as HTMLSelectElement;
    if (target.name === "rule") state.rule = target.value as Rule;
    else if (target.name === "order") state.order = target.value as Order;
    else if (target.name === "preset") {
      const preset = PRESETS.find((p) => p.id === target.value);
      if (!preset) return;
      load(preset.intervals);
      select("preset").value = preset.id;
      state.mode = preset.mode;
      if (preset.mode === "schedule") select("rule").value = state.rule = preset.rule as Rule;
      else select("order").value = state.order = preset.rule as Order;
    } else return;
    stop();
    state.step = state.intervals.length;
    state.optimum = 0;
    status("");
    draw();
  };

  const onPointerDown = (e: PointerEvent) => {
    const el = (e.target as Element).closest("[data-i]");
    if (!el || e.button !== 0) return;
    const id = Number(el.getAttribute("data-i"));
    const a = state.intervals[id];
    const end = (el.getAttribute("data-end") as "s" | "f" | null) ?? "move";
    drag = { id, end, x0: e.clientX, s0: a.s, f0: a.f, moved: false, pointer: e.pointerId };
    state.frozenOrder = [...chartBox.querySelectorAll("g[data-i]")].map((g) => Number(g.getAttribute("data-i")));
    chartBox.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dt = Math.round((e.clientX - drag.x0) / pxPerUnit());
    const a = state.intervals[drag.id];
    const len = drag.f0 - drag.s0;
    let s = drag.s0;
    let f = drag.f0;
    if (drag.end === "move") {
      s = Math.min(HORIZON - len, Math.max(0, drag.s0 + dt));
      f = s + len;
    } else if (drag.end === "s") s = Math.min(drag.f0 - 1, Math.max(0, drag.s0 + dt));
    else f = Math.max(drag.s0 + 1, Math.min(HORIZON, drag.f0 + dt));
    if (s === a.s && f === a.f) return;
    a.s = s;
    a.f = f;
    drag.moved = true;
    state.selected = drag.id;
    edited();
    draw();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const { id, moved } = drag;
    drag = null;
    state.frozenOrder = undefined;
    if (!moved) state.selected = state.selected === id ? null : id;
    draw();
    chartBox.querySelector<SVGElement>(`g[data-i="${id}"]`)?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const el = (e.target as Element).closest("g[data-i]");
    if (!el) return;
    const id = Number(el.getAttribute("data-i"));
    const a = state.intervals[id];
    if (e.key === "Enter" || e.key === " ") {
      state.selected = state.selected === id ? null : id;
    } else if (e.key === "Delete" || e.key === "Backspace") {
      state.intervals.splice(id, 1);
      state.selected = null;
      edited();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const d = e.key === "ArrowLeft" ? -1 : 1;
      if (e.shiftKey) a.f = Math.max(a.s + 1, Math.min(HORIZON, a.f + d));
      else if (a.s + d >= 0 && a.f + d <= HORIZON) {
        a.s += d;
        a.f += d;
      }
      state.selected = id;
      edited();
    } else return;
    e.preventDefault();
    draw();
  };

  const resize = new ResizeObserver(() => {
    const width = Math.floor(chartBox.clientWidth);
    if (width && width !== state.width) {
      state.width = width;
      draw();
    }
  });

  figure.addEventListener("click", onClick);
  figure.addEventListener("change", onChange);
  chartBox.addEventListener("pointerdown", onPointerDown);
  chartBox.addEventListener("pointermove", onPointerMove);
  chartBox.addEventListener("pointerup", onPointerUp);
  chartBox.addEventListener("pointercancel", onPointerUp);
  chartBox.addEventListener("keydown", onKey);
  resize.observe(chartBox);
  for (const control of figure.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) control.disabled = false;
  // Back and forward navigation can restore earlier select values.
  state.rule = select("rule").value as Rule;
  state.order = select("order").value as Order;
  state.width = Math.floor(chartBox.clientWidth) || state.width;
  figure.classList.add("ig-live");
  draw();

  return () => {
    stop();
    searching = 0;
    resize.disconnect();
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("change", onChange);
    chartBox.removeEventListener("pointerdown", onPointerDown);
    chartBox.removeEventListener("pointermove", onPointerMove);
    chartBox.removeEventListener("pointerup", onPointerUp);
    chartBox.removeEventListener("pointercancel", onPointerUp);
    chartBox.removeEventListener("keydown", onKey);
  };
}
