// Markup for the encoding figure. Two presets share the byte grid:
//   bytes   - one real record in five formats; bars compare their sizes and
//             the grid shows what every byte of the chosen format does.
//   misread - the record written with the full schema, read by code whose
//             schema deleted requires_python, as Avro (with or without the
//             writer's schema) or as protobuf.
// The build renders the whole figure; the browser redraws the parts with the
// same functions after each change.

import { esc } from "../../shared/format";
import {
  FORMATS,
  type Field,
  type Format,
  type ReadResult,
  type Rec,
  type Role,
  type Span,
  RECORDS,
  ROLES,
  TAG,
  V2_FIELDS,
  encode,
  expectedV2,
  flatten,
  readAvro,
  readProtobuf,
  recordById,
  roleTotals,
} from "./model";

export const ROLE_LABEL: Record<Role, string> = {
  name: "field name",
  tag: "field tag",
  meta: "type or length",
  value: "value",
  punct: "syntax",
};

const hex2 = (b: number) => b.toString(16).padStart(2, "0");
const printable = (b: number) => b >= 0x21 && b <= 0x7e;

export interface Cell {
  byte: number;
  field: Field | null;
  cls: string; // role or read outcome, used as a class suffix
  text: boolean;
  step?: number; // index of the read step that consumed the byte
}

export function cellsFromSpans(spans: Span[]): Cell[] {
  return spans.flatMap((s) => s.bytes.map((byte) => ({ byte, field: s.field, cls: s.role, text: s.text })));
}

export function gridHtml(cells: Cell[]): string {
  return cells
    .map((c, i) => {
      const shown = c.text && printable(c.byte) ? esc(String.fromCharCode(c.byte)) : hex2(c.byte);
      const kind = c.text && printable(c.byte) ? " eb-ch" : "";
      const f = c.field ? ` data-f="${c.field}"` : "";
      const st = c.step === undefined ? "" : ` data-s="${c.step}"`;
      return `<span class="eb-b eb-${c.cls}${kind}" data-i="${i}"${f}${st}>${shown}</span>`;
    })
    .join("");
}

// ---- preset: bytes ------------------------------------------------------------------

export function barsHtml(rec: Rec, chosen: Format): string {
  const all = FORMATS.map((f) => ({ ...f, spans: encode(f.id, rec) }));
  const max = Math.max(...all.map((f) => flatten(f.spans).length));
  return all
    .map((f) => {
      const t = roleTotals(f.spans);
      const total = flatten(f.spans).length;
      const segs = ROLES.filter((r) => t[r])
        .map((r) => `<span class="eb-seg eb-${r}" style="width:${((100 * t[r]) / max).toFixed(2)}%"></span>`)
        .join("");
      return `<button type="button" class="eb-bar" name="fmt-${f.id}" data-fmt="${f.id}" aria-pressed="${f.id === chosen}" disabled><span class="eb-bar-label">${esc(f.label)}</span><span class="eb-bar-track">${segs}</span><span class="eb-bar-n">${total} B</span></button>`;
    })
    .join("");
}

export function legendHtml(roles: { cls: string; label: string }[]): string {
  return roles.map((r) => `<span class="eb-key"><span class="eb-sw eb-${r.cls}"></span>${esc(r.label)}</span>`).join("");
}

/** A sentence on how a format spends the bytes of one field. */
export function fieldReadout(format: Format, spans: Span[], field: Field): string {
  const mine = spans.filter((s) => s.field === field);
  const label = FORMATS.find((f) => f.id === format)!.label;
  if (!mine.length) {
    const why = format === "protobuf" ? "it holds the type's default (false, 0 or empty), which proto3 does not write" : "the field is unset";
    return `${field}: 0 bytes in ${label}; ${why}.`;
  }
  const n = mine.reduce((a, s) => a + s.bytes.length, 0);
  const parts = ROLES.map((r) => [r, mine.filter((s) => s.role === r).reduce((a, s) => a + s.bytes.length, 0)] as const)
    .filter(([, k]) => k)
    .map(([r, k]) => `${k} ${ROLE_LABEL[r]}`);
  let extra = "";
  if (format === "protobuf") extra = ` The tag byte is field number ${TAG[field]} shifted left 3 bits, plus the wire type.`;
  if (format === "thrift") extra = ` The header byte holds the field number as a delta from the previous field, and the type${field === "yanked" ? ", which for a boolean is also the value" : ""}.`;
  if (format === "avro") extra = " Nothing identifies the field: the reader knows it from its position in the writer's schema.";
  return `${field}: ${n} byte${n > 1 ? "s" : ""} in ${label} (${parts.join(", ")}).${extra}`;
}

const BYTES_HINT = "Hover over or tap a byte to see which field it belongs to.";

function recordSelect(chosen: string): string {
  const opts = RECORDS.map((r) => `<option value="${r.id}"${r.id === chosen ? " selected" : ""}>${esc(r.label)}</option>`).join("");
  return `<label class="eb-rec">Record <select name="record" disabled>${opts}</select></label>`;
}

function renderBytes(recId: string, format: Format): string {
  const rec = recordById(recId).rec;
  const spans = encode(format, rec);
  return [
    `<figure class="eb" data-preset="bytes" data-record="${recordById(recId).id}" data-format="${format}">`,
    `<div class="eb-controls">${recordSelect(recordById(recId).id)}</div>`,
    `<div class="eb-bars" data-part="bars">${barsHtml(rec, format)}</div>`,
    `<div class="eb-legend">${legendHtml(ROLES.map((r) => ({ cls: r, label: ROLE_LABEL[r] })))}</div>`,
    `<div class="eb-grid" data-part="grid">${gridHtml(cellsFromSpans(spans))}</div>`,
    `<p class="eb-readout" data-part="readout" aria-live="polite">${BYTES_HINT}</p>`,
    `<figcaption>One file record from PyPI, encoded by the same code paths the experiments time. The bars give each encoding's size for this record, split by what the bytes do; click a bar to show that encoding byte by byte. Printable characters inside strings are shown as text, other bytes in hex. The encoders run in the browser and match the Python libraries' output byte for byte.</figcaption>`,
    `</figure>`,
  ].join("");
}

// ---- preset: misread ---------------------------------------------------------------

export type ReadMode = "writer" | "assumed";

export function readFor(format: "avro" | "protobuf", mode: ReadMode, rec: Rec): { bytes: number[]; spans: Span[]; result: ReadResult } {
  const spans = encode(format, rec);
  const bytes = flatten(spans);
  const result = format === "avro" ? readAvro(bytes, mode === "writer") : readProtobuf(bytes);
  return { bytes, spans, result };
}

const showValue = (v: unknown): string => {
  if (v === undefined) return "not read";
  if (v === null) return "null";
  const s = String(v);
  return s.length > 22 ? s.slice(0, 20) + "…" : s;
};

export function misreadCells(spans: Span[], result: ReadResult, rec: Rec): Cell[] {
  const cells = cellsFromSpans(spans);
  const want = expectedV2(rec);
  for (const c of cells) {
    c.cls = "unread";
    c.field = null;
  }
  result.steps.forEach((s, k) => {
    const wrong = s.field !== null && s.note === "read" && String(want[s.field]) !== String(s.value);
    const cls = s.note === "read" ? (wrong ? "wrong" : "right") : "skipped";
    for (let i = s.start; i < s.end; i++) {
      cells[i].cls = cls;
      cells[i].field = s.field;
      cells[i].step = k;
    }
  });
  return cells;
}

export function misreadTable(result: ReadResult, rec: Rec): string {
  const want = expectedV2(rec);
  const rows = V2_FIELDS.map((f) => {
    const got = result.values[f];
    const ok = got !== undefined && String(got) === String(want[f]);
    return `<tr data-f="${f}" class="${ok ? "" : "eb-row-wrong"}"><td>${f}</td><td>${esc(showValue(got))}</td><td>${esc(showValue(want[f]))}</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>field</th><th>reader got</th><th>written</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function misreadVerdict(format: "avro" | "protobuf", mode: ReadMode, result: ReadResult, rec: Rec): string {
  const want = expectedV2(rec);
  const wrong = V2_FIELDS.filter((f) => result.values[f] !== undefined && String(result.values[f]) !== String(want[f])).length;
  const skipped = result.steps.filter((s) => s.note !== "read").reduce((a, s) => a + s.end - s.start, 0);
  if (format === "protobuf") {
    const extra = skipped ? ` The ${skipped} bytes of field 6 were skipped by their wire type and kept as an unknown field.` : " This record has no requires_python, so there was nothing to skip.";
    return `All ${V2_FIELDS.length} fields read correctly, with no schema from the writer.${extra}`;
  }
  if (result.error) return `The reader raised ${result.error} after ${result.steps.length} fields; ${wrong} of them were already wrong.`;
  if (mode === "writer")
    return `All ${V2_FIELDS.length} fields read correctly. Resolution against the writer's schema walked past requires_python (${skipped} byte${skipped === 1 ? "" : "s"}) and dropped it.`;
  const tail = result.trailing ? ` ${result.trailing} bytes were left over and ignored.` : "";
  return `${wrong} of ${V2_FIELDS.length} fields are wrong, and no error was raised.${tail}`;
}

const MISREAD_LEGEND = [
  { cls: "right", label: "read correctly" },
  { cls: "wrong", label: "read into the wrong value" },
  { cls: "skipped", label: "skipped" },
  { cls: "unread", label: "left over" },
];

export function misreadBody(format: "avro" | "protobuf", mode: ReadMode, rec: Rec): { grid: string; table: string; verdict: string } {
  const { spans, result } = readFor(format, mode, rec);
  return {
    grid: gridHtml(misreadCells(spans, result, rec)),
    table: misreadTable(result, rec),
    verdict: misreadVerdict(format, mode, result, rec),
  };
}

function renderMisread(recId: string, format: "avro" | "protobuf", mode: ReadMode): string {
  const rec = recordById(recId).rec;
  const b = misreadBody(format, mode, rec);
  const btn = (name: string, label: string, on: boolean, disabled = true) =>
    `<button type="button" name="${name}" aria-pressed="${on}"${disabled ? " disabled" : ""}>${esc(label)}</button>`;
  return [
    `<figure class="eb" data-preset="misread" data-record="${recordById(recId).id}" data-format="${format}" data-mode="${mode}">`,
    `<div class="eb-controls">`,
    `<span class="eb-group" role="group" aria-label="Encoding">${btn("fmt-avro", "Avro", format === "avro")}${btn("fmt-protobuf", "Protobuf", format === "protobuf")}</span>`,
    `<span class="eb-group" role="group" aria-label="Reader">${btn("mode-writer", "with writer's schema", mode === "writer")}${btn("mode-assumed", "assuming its own schema", mode === "assumed")}</span>`,
    recordSelect(recordById(recId).id),
    `</div>`,
    `<div class="eb-legend">${legendHtml(MISREAD_LEGEND)}</div>`,
    `<div class="eb-grid" data-part="grid">${b.grid}</div>`,
    `<p class="eb-readout" data-part="readout" aria-live="polite">${esc(b.verdict)}</p>`,
    `<div class="eb-table" data-part="table">${b.table}</div>`,
    `<figcaption>Bytes written with the full schema, decoded by code whose schema deleted requires_python. Each byte is coloured by what the reader did with it. An Avro reader can resolve the change only if it is given the writer's schema; a protobuf reader never sees the writer's schema and identifies fields by their tags.</figcaption>`,
    `</figure>`,
  ].join("");
}

export interface Props {
  preset?: string;
  record?: string;
  format?: string;
}

/** The whole figure, rendered at build time. */
export function render(props: Props): string {
  if (props.preset === "misread") {
    const f = props.format === "protobuf" ? "protobuf" : "avro";
    return renderMisread(props.record ?? "numpy", f, "assumed");
  }
  const f = (FORMATS.find((x) => x.id === props.format)?.id ?? "protobuf") as Format;
  return renderBytes(props.record ?? "numpy", f);
}
