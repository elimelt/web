// Markup for the CRC division figure. One row for the dividend, then a pair
// of rows per XOR step: the generator lined up, and the bits after the XOR.

import { esc } from "../../shared/format";
import { divide, dividend, polyText, scenarioById, str, type Bits, type Scenario } from "./model";

export interface View {
  s: Scenario;
  errors: number[];
  done: number;
}

export const startView = (id: string | undefined): View => {
  const s = scenarioById(id);
  return { s, errors: [...s.errors], done: 0 };
};

export function stateOf(v: View) {
  const d = dividend(v.s, v.errors);
  const { steps, remainder } = divide(d, v.s.gen);
  return { d, steps, remainder };
}

function row(cells: string[], cls: string, label: string): string {
  return `<div class="cd-row ${cls}"><span class="cd-label">${label}</span><span class="cd-cells">${cells.join("")}</span></div>`;
}

export function body(v: View): string {
  const { d, steps, remainder } = stateOf(v);
  const n = d.length;
  const k = v.s.gen.length - 1;
  const errs = new Set(v.errors);
  const receive = v.s.mode === "receive";
  const top = d.map((b, i) => {
    const cls = `cd-bit${i >= n - k ? " cd-check" : ""}${errs.has(i) ? " cd-flipped" : ""}`;
    return receive
      ? `<button type="button" class="${cls}" data-i="${i}" aria-label="Bit ${i + 1}: ${b}. Flip it." disabled>${b}</button>`
      : `<span class="${cls}">${b}</span>`;
  });
  const rows = [row(top, "cd-top", receive ? "received" : "message + 000".replace("000", "0".repeat(k)))];
  const shown = steps.slice(0, v.done);
  shown.forEach((st, si) => {
    const g: string[] = [];
    for (let i = 0; i < n; i++) {
      const j = i - st.at;
      g.push(j >= 0 && j <= k ? `<span class="cd-bit cd-gen">${v.s.gen[j]}</span>` : `<span class="cd-bit cd-blank"></span>`);
    }
    rows.push(row(g, "cd-genrow", "XOR"));
    const after = st.after.map((b, i) => {
      const lead = i < (steps[si + 1]?.at ?? n - k) && i < n - k;
      return `<span class="cd-bit${i >= n - k ? " cd-check" : ""}${lead && !b ? " cd-dim" : ""}">${b}</span>`;
    });
    rows.push(row(after, "cd-after", ""));
  });
  const finished = v.done >= steps.length;
  return rows.join("") + `<p class="cd-verdict" data-tone="${finished ? tone(v, remainder) : "pending"}" aria-live="polite">${esc(verdict(v, remainder, steps.length))}</p>`;
}

function tone(v: View, rem: Bits): string {
  if (v.s.mode === "send") return "ok";
  const zero = rem.every((b) => !b);
  if (!v.errors.length) return "ok";
  return zero ? "missed" : "caught";
}

export function verdict(v: View, rem: Bits, total: number): string {
  if (v.done < total) {
    const left = total - v.done;
    return `${left} XOR step${left > 1 ? "s" : ""} to go. Each one lines the generator up under the leftmost 1.`;
  }
  if (v.s.mode === "send") {
    return `No 1 is left before the last ${rem.length} bits, so the remainder is ${str(rem)}. The sender replaces the zeros with it and sends ${str(v.s.message)} ${str(rem)}.`;
  }
  const zero = rem.every((b) => !b);
  const nerr = v.errors.length;
  if (!nerr) return `Remainder ${str(rem)}: what arrived divides evenly, so the receiver accepts it.`;
  if (zero) return `Remainder ${str(rem)}, so the receiver accepts it, although ${nerr} bit${nerr > 1 ? "s were" : " was"} flipped. The error pattern is itself a multiple of the generator.`;
  return `Remainder ${str(rem)} is not zero: the receiver knows ${nerr > 1 ? "bits were" : "a bit was"} flipped.`;
}

export interface Props {
  scenario?: string;
}

export function controls(v: View, total: number): Record<string, boolean> {
  return { back: v.done === 0, next: v.done >= total, all: v.done >= total };
}

/** The whole figure, rendered at build time at step 0. */
export function render(props: Props): string {
  const v = startView(props.scenario);
  const receive = v.s.mode === "receive";
  const head = receive
    ? `Divide what arrived by the generator ${str(v.s.gen)} (<span class="cd-poly">${polyText(v.s.gen)}</span>).`
    : `Divide the message, with ${v.s.gen.length - 1} zeros appended, by the generator ${str(v.s.gen)} (<span class="cd-poly">${polyText(v.s.gen)}</span>).`;
  return [
    `<figure class="cd" data-scenario="${v.s.id}">`,
    `<p class="cd-head">${head}</p>`,
    `<div class="cd-grid" data-part="body">${body(v)}</div>`,
    `<div class="cd-actions">`,
    `<button type="button" name="back" disabled>Back</button>`,
    `<button type="button" name="next" disabled>Next XOR</button>`,
    `<button type="button" name="all" disabled>All steps</button>`,
    receive ? `<span class="cd-hint">Click a received bit to flip it.</span>` : "",
    `</div>`,
    `<figcaption>Long division with XOR in place of subtraction, run in your browser. Shaded columns are the check bits.${receive ? " Orange bits were flipped on the way." : ""}</figcaption>`,
    `</figure>`,
  ].join("");
}
