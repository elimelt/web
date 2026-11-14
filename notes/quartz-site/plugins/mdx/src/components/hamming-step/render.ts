// Markup for the Hamming figure: the received word, each check's verdict,
// and what the decoder does with the syndrome.

import { esc } from "../../shared/format";
import { CHECKS, covers, checkFails, decode, encode, overallFails, type Bits, type Scenario } from "./model";

export interface View {
  s: Scenario;
  received: Bits;
}

export function startView(s: Scenario): View {
  const received = encode(s.data, s.extended);
  for (const f of s.flips) received[f] ^= 1;
  return { s, received };
}

const positions = (ext: boolean) => (ext ? [0, 1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6, 7]);
const role = (p: number) => (p === 0 ? "p0" : (p & (p - 1)) === 0 ? `p${p}` : `d${p}`);

function row(cls: string, label: string, cells: string[], after = ""): string {
  return `<div class="hm-row ${cls}"><span class="hm-label">${label}</span>${cells.join("")}<span class="hm-after">${after}</span></div>`;
}

export function body(v: View): string {
  const ext = v.s.extended;
  const pos = positions(ext);
  const sent = encode(v.s.data, ext);
  const d = decode(v.received, ext);
  const rows: string[] = [];
  rows.push(row("hm-pos", "position", pos.map((p) => `<span class="hm-cell">${p}<small>${p ? p.toString(2).padStart(3, "0") : "all"}</small></span>`)));
  rows.push(row("hm-role", "role", pos.map((p) => `<span class="hm-cell${p && (p & (p - 1)) ? "" : " hm-checkbit"}">${role(p)}</span>`)));
  rows.push(row("hm-recv", "received", pos.map((p) => {
    const bad = v.received[p] !== sent[p];
    return `<button type="button" class="hm-cell hm-bit${bad ? " hm-flipped" : ""}" data-p="${p}" aria-label="Position ${p}, ${role(p)}: ${v.received[p]}. Flip it." disabled>${v.received[p]}</button>`;
  })));
  for (const c of CHECKS) {
    const set = new Set(covers(c));
    const fail = checkFails(v.received, c);
    rows.push(row(`hm-check${fail ? " hm-fail" : ""}`, `check p${c}`, pos.map((p) => `<span class="hm-cell">${set.has(p) ? `<i class="hm-dot">${v.received[p]}</i>` : ""}</span>`),
      fail ? `odd, add ${c}` : "even"));
  }
  if (ext) {
    const fail = overallFails(v.received);
    rows.push(row(`hm-check${fail ? " hm-fail" : ""}`, "all 8 bits", pos.map((p) => `<span class="hm-cell"><i class="hm-dot">${v.received[p]}</i></span>`), fail ? "odd" : "even"));
  }
  rows.push(row("hm-out", d.action === "detect" ? "not fixed" : "decoded", pos.map((p) => {
    const fixed = p === d.flipped;
    const wrong = d.corrected[p] !== sent[p];
    return `<span class="hm-cell hm-bit${fixed ? " hm-fixed" : ""}${wrong ? " hm-wrong" : ""}">${d.corrected[p]}</span>`;
  })));
  return rows.join("") + `<p class="hm-verdict" data-tone="${tone(v)}" aria-live="polite">${esc(verdict(v))}</p>`;
}

function tone(v: View): string {
  const sent = encode(v.s.data, v.s.extended);
  const d = decode(v.received, v.s.extended);
  if (d.action === "detect") return "caught";
  return d.data.every((b, i) => b === v.s.data[i]) && d.corrected.every((b, i) => b === sent[i]) ? "ok" : "missed";
}

export function verdict(v: View): string {
  const ext = v.s.extended;
  const sent = encode(v.s.data, ext);
  const d = decode(v.received, ext);
  const nflip = v.received.reduce((a, b, i) => a + (b !== sent[i] ? 1 : 0), 0);
  const dataOk = d.data.every((b, i) => b === v.s.data[i]);
  const failing = CHECKS.filter((c) => checkFails(v.received, c));
  const synText = failing.length ? `The failing checks add up to ${failing.join(" + ")} = ${d.syn}` : "Every check holds";
  if (d.action === "none") return nflip ? `${synText}, so the decoder sees no error, but ${nflip} bits are wrong.` : `${synText}: no error, and the data ${v.s.data.join("")} comes out.`;
  if (d.action === "detect") return `${synText}, but the overall parity is even, so two bits must have flipped. The decoder can't tell which, and reports an error instead of guessing.`;
  if (d.action === "fix-p0") return `Every check holds but the overall parity is odd: only the extra bit p0 flipped. The data ${d.data.join("")} is intact.`;
  if (dataOk && d.corrected.every((b, i) => b === sent[i])) return `${synText}, so the decoder flips position ${d.syn} back and recovers ${d.data.join("")}.`;
  return `${synText}, so the decoder flips position ${d.syn}, which was right. It outputs ${d.data.join("")} instead of ${v.s.data.join("")}${nflip > 1 ? `: ${nflip} flips look like one flip at position ${d.syn}` : ""}.`;
}

export interface Props {
  scenario?: string;
}

import { scenarioById } from "./model";

export function render(props: Props): string {
  const s = scenarioById(props.scenario);
  const v = startView(s);
  return [
    `<figure class="hm${s.extended ? " hm-ext" : ""}" data-scenario="${s.id}">`,
    `<div class="hm-grid" data-part="body">${body(v)}</div>`,
    `<div class="hm-actions"><span class="hm-hint">Click a received bit to flip it.</span><button type="button" name="reset" disabled>Back to this example</button></div>`,
    `<figcaption>Hamming(7,4)${s.extended ? " with an overall parity bit p0 added, the SECDED form ECC memory uses" : ""}, carrying the data ${s.data.join("")}. Each check covers the positions whose binary index has its bit set. Orange bits were flipped on the way; blue is the bit the decoder flips; red is still wrong after decoding.</figcaption>`,
    `</figure>`,
  ].join("");
}
