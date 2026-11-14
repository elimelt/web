// Markup for the counter predictor figure. The build renders the finished
// replay (every outcome already stepped through), so the page shows the
// result before any script runs; the client redraws the same parts from
// these functions as the reader replays it.

import { esc } from "../../shared/format";
import { bitsOf, presetKey, presets, replay, stateCodes, stateNames, type Bits, type Step } from "./model";

const word = (taken: boolean) => (taken ? "taken" : "not taken");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The state boxes, with the state after `shown` outcomes marked. */
export function states(bits: Bits, current: number): string {
  const names = stateNames[bits];
  const boxes = names.map((name, s) => {
    const side = (bits === 1 ? s === 1 : s >= 2) ? "cp-t" : "cp-n";
    const now = s === current ? " cp-now" : "";
    return `<div class="cp-state ${side}${now}" data-s="${s}"${s === current ? ' aria-current="true"' : ""}><span class="cp-code">${stateCodes[bits][s]}</span><span class="cp-name">${name}</span></div>`;
  });
  return boxes.join(`<span class="cp-link" aria-hidden="true">⇄</span>`);
}

/** The outcome tape: one cell per execution, colored by whether the counter got it. */
export function tape(steps: Step[], shown: number): string {
  return steps
    .map((st, i) => {
      const cls = i >= shown ? "cp-future" : st.hit ? "cp-hit" : "cp-miss";
      const cur = i === shown - 1 ? " cp-cur" : "";
      const label = i < shown ? `${i + 1}: went ${word(st.taken)}, predicted ${word(st.predicted)}` : `${i + 1}: not yet`;
      return `<li class="cp-cell ${cls}${cur}" title="${label}">${st.taken ? "T" : "N"}</li>`;
    })
    .join("");
}

export function status(bits: Bits, steps: Step[], shown: number): string {
  const misses = steps.slice(0, shown).filter((s) => !s.hit).length;
  if (shown === 0) return `Before the first outcome the counter is ${stateNames[bits][steps[0].before]}.`;
  const st = steps[shown - 1];
  if (shown === steps.length) {
    return `${misses} ${misses === 1 ? "miss" : "misses"} in ${steps.length} outcomes (${pct(misses / steps.length)}).`;
  }
  const verdict = st.hit ? "right" : "a miss";
  return `Outcome ${shown} of ${steps.length}: predicted ${word(st.predicted)}, went ${word(st.taken)}, ${verdict}. ${misses} ${misses === 1 ? "miss" : "misses"} so far.`;
}

export interface Props {
  preset?: string;
  bits?: number | string;
}

export function render(props: Props): string {
  const key = presetKey(props.preset);
  const bits = bitsOf(props.bits);
  const p = presets[key];
  const steps = replay(bits, p.start[bits], p.outcomes);
  const shown = steps.length;
  const end = steps[shown - 1].after;
  const whole = bits === 1 ? p.whole.miss1 : p.whole.miss2;
  return [
    `<figure class="cp" data-preset="${key}" data-bits="${bits}">`,
    `<p class="cp-title">${esc(p.title)} <span class="cp-dim">(${bits}-bit counter, offset ${p.offset})</span></p>`,
    `<div class="cp-states cp-bits${bits}" data-part="states">${states(bits, end)}</div>`,
    `<ol class="cp-tape" data-part="tape" aria-label="${shown} real outcomes of this branch, oldest first">${tape(steps, shown)}</ol>`,
    `<p class="cp-status" data-part="status" aria-live="polite">${status(bits, steps, shown)}</p>`,
    `<div class="cp-actions"><button type="button" name="play" disabled>Replay</button><button type="button" name="step" disabled>Step</button></div>`,
    `<figcaption>Each cell is one real execution of this branch: T taken, N not taken. Green means the counter predicted it, red means it missed. Taken moves the counter one state right, not taken one state left. Over the whole trace (${p.whole.runs.toLocaleString("en-US")} runs) this counter missed ${pct(whole)} of them and the 8 KB TAGE missed ${pct(p.whole.missTage)}.</figcaption>`,
    `</figure>`,
  ].join("");
}
