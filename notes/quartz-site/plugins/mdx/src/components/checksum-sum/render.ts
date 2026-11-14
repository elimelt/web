// Markup for the checksum figure: the ten words of an IPv4 header as the
// receiver sees them, with a running ones' complement sum and the verdict.
// The build renders it from a scenario; the browser redraws the body after
// each click with the same functions.

import { esc } from "../../shared/format";
import { FIELDS, HEADER, addr, changedBits, hex, passes, runningSums, scenarioById } from "./model";

export function verdict(words: number[]): { text: string; tone: string } {
  const sum = runningSums(words).at(-1)!;
  const wrong = changedBits(words).length;
  const ok = passes(words);
  const lead = `The receiver's sum is ${hex(sum)}. `;
  if (!wrong) return { text: `${lead}All ones: the header passes, and it is the header that was sent.`, tone: "ok" };
  if (!ok) return { text: `${lead}Not all ones, so the receiver drops the packet. ${wrong} bit${wrong > 1 ? "s" : ""} changed.`, tone: "caught" };
  const dst = addr(words[8], words[9]);
  const sentDst = addr(HEADER[8], HEADER[9]);
  const where = dst !== sentDst ? ` It is delivered to ${dst} instead of ${sentDst}.` : "";
  return { text: `${lead}All ones, so the header passes, although ${wrong} bits are wrong.${where}`, tone: "missed" };
}

export function body(words: number[]): string {
  const sums = runningSums(words);
  const changed = new Set(changedBits(words).map(([w, b]) => `${w}:${b}`));
  const rows = words.map((w, i) => {
    const cells: string[] = [];
    for (let b = 15; b >= 0; b--) {
      const bit = (w >> b) & 1;
      const cls = changed.has(`${i}:${b}`) ? " cs-flipped" : "";
      const gap = b % 4 === 0 && b > 0 ? " cs-gap" : "";
      cells.push(`<button type="button" class="cs-bit${cls}${gap}" data-w="${i}" data-b="${b}" aria-label="${esc(FIELDS[i])}, bit ${b}: ${bit}. Flip it." disabled>${bit}</button>`);
    }
    const rowCls = w !== HEADER[i] ? " cs-row-changed" : "";
    return `<div class="cs-row${rowCls}"><span class="cs-field">${esc(FIELDS[i])}</span><span class="cs-bits">${cells.join("")}</span><span class="cs-hex">${hex(w)}</span><span class="cs-sum">${hex(sums[i])}</span></div>`;
  });
  const v = verdict(words);
  return [
    `<div class="cs-row cs-head" aria-hidden="true"><span class="cs-field">field</span><span class="cs-bits">bits, high to low</span><span class="cs-hex">word</span><span class="cs-sum">sum</span></div>`,
    ...rows,
    `<p class="cs-verdict" data-tone="${v.tone}" aria-live="polite">${esc(v.text)}</p>`,
  ].join("");
}

export interface Props {
  scenario?: string;
}

/** The whole figure, rendered at build time. */
export function render(props: Props): string {
  const s = scenarioById(props.scenario);
  return [
    `<figure class="cs" data-scenario="${s.id}">`,
    `<div class="cs-grid" data-part="body">${body(s.words)}</div>`,
    `<div class="cs-actions"><span class="cs-hint">Click any bit to flip it.</span><button type="button" name="reset" disabled>Back to this example</button></div>`,
    `<figcaption>A real IPv4 header, captured from a TCP connection, as ten 16-bit words. The sum column adds them in ones' complement (a carry out of the top bit wraps around to the bottom), the way <a href="https://www.rfc-editor.org/rfc/rfc1071">RFC 1071</a> specifies. Orange bits differ from what was sent.</figcaption>`,
    `</figure>`,
  ].join("");
}
