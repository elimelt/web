// Browser side of the encoding figure. In the bytes preset, a bar picks the
// encoding and hovering or tapping a byte highlights its field. In the misread
// preset, buttons pick the encoding and whether the reader has the writer's
// schema, and the grid, verdict and table are recomputed.

import { enableControls, lookup } from "../../shared/dom";
import { FORMATS, type Field, type Format, encode, recordById } from "./model";
import { type ReadMode, barsHtml, cellsFromSpans, fieldReadout, gridHtml, misreadBody } from "./render";

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.eb");
  if (!figure) return () => {};
  const { part } = lookup(figure);
  const select = figure.querySelector<HTMLSelectElement>('select[name="record"]')!;
  const misread = figure.dataset.preset === "misread";
  let format = figure.dataset.format as Format;
  let mode = (figure.dataset.mode ?? "assumed") as ReadMode;
  let pinned: Field | null = null;

  const rec = () => recordById(select.value).rec;

  const highlight = (field: Field | null) => {
    for (const el of figure.querySelectorAll(".eb-hl")) el.classList.remove("eb-hl");
    if (!field) return;
    for (const el of figure.querySelectorAll(`[data-f="${field}"]`)) el.classList.add("eb-hl");
  };

  let verdict = "";
  const readout = (field: Field | null) => {
    if (misread) {
      part("readout").textContent = verdict;
      return;
    }
    part("readout").textContent = field
      ? fieldReadout(format, encode(format, rec()), field)
      : "Hover over or tap a byte to see which field it belongs to.";
  };

  const draw = () => {
    if (misread) {
      const f = format === "protobuf" ? "protobuf" : "avro";
      const b = misreadBody(f, mode, rec());
      part("grid").innerHTML = b.grid;
      part("table").innerHTML = b.table;
      verdict = b.verdict;
      for (const name of ["fmt-avro", "fmt-protobuf"])
        figure.querySelector(`button[name="${name}"]`)!.setAttribute("aria-pressed", String(name === `fmt-${f}`));
      for (const name of ["mode-writer", "mode-assumed"]) {
        const btn = figure.querySelector<HTMLButtonElement>(`button[name="${name}"]`)!;
        btn.setAttribute("aria-pressed", String(name === `mode-${mode}`));
      }
      enableControls(figure);
      // A protobuf reader never receives the writer's schema; the choice does not apply.
      for (const name of ["mode-writer", "mode-assumed"])
        figure.querySelector<HTMLButtonElement>(`button[name="${name}"]`)!.disabled = f === "protobuf";
    } else {
      part("bars").innerHTML = barsHtml(rec(), format);
      part("grid").innerHTML = gridHtml(cellsFromSpans(encode(format, rec())));
      enableControls(figure);
    }
    highlight(pinned);
    readout(pinned);
  };

  const onClick = (event: Event) => {
    const target = event.target as Element;
    const btn = target.closest<HTMLButtonElement>("button");
    if (btn?.name.startsWith("fmt-")) {
      format = btn.name.slice(4) as Format;
      if (!FORMATS.some((f) => f.id === format)) return;
      pinned = null;
      return draw();
    }
    if (btn?.name.startsWith("mode-")) {
      mode = btn.name.slice(5) as ReadMode;
      return draw();
    }
    const cell = target.closest<HTMLElement>(".eb-b, tr[data-f]");
    if (cell) {
      const f = (cell.dataset.f ?? null) as Field | null;
      pinned = pinned === f ? null : f;
      highlight(pinned);
      readout(pinned);
    }
  };

  const onOver = (event: Event) => {
    const cell = (event.target as Element).closest<HTMLElement>(".eb-b, tr[data-f]");
    const f = (cell?.dataset.f ?? null) as Field | null;
    highlight(f ?? pinned);
    readout(f ?? pinned);
  };
  const onLeave = () => {
    highlight(pinned);
    readout(pinned);
  };
  const onChange = () => {
    pinned = null;
    draw();
  };

  figure.addEventListener("click", onClick);
  figure.addEventListener("pointerover", onOver);
  figure.addEventListener("pointerleave", onLeave);
  select.addEventListener("change", onChange);
  draw();
  return () => {
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("pointerover", onOver);
    figure.removeEventListener("pointerleave", onLeave);
    select.removeEventListener("change", onChange);
  };
}
