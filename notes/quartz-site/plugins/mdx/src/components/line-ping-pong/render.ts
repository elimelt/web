// Markup for the cache-line ping-pong figure. The build renders the preset's
// starting state with the buttons disabled; the client redraws the same parts
// from these functions after every access.

import { esc } from "../../shared/format";
import { cores, describe, fresh, LINE, lineOf, PRESETS, presetKey, tally, WORD, type Machine } from "./model";

export interface Props {
  preset?: unknown;
}

const CAPTIONS: Record<string, string> = {
  packed:
    "Simulation. Four cores each increment their own 8-byte counter, and all four counters lie in one 64-byte line. Press a core's button to make it write its counter once, or Random 20 for twenty writes in a random order. Each write needs the line in Modified state, so a write by a different core than the last one takes the line away from that core.",
  padded:
    "Simulation. The same four counters at a stride of 64 bytes, so each lies in its own line. After its first write, each core holds its line Modified and every later write hits.",
  reader:
    "Simulation. Core 0 writes c0; cores 1 to 3 only read c1 to c3, which share the line with c0. A read after a write fetches the line from core 0's Modified copy and leaves it Shared; the next write invalidates every reader's copy.",
};

const STATE_NAME: Record<string, string> = { M: "Modified", E: "Exclusive", S: "Shared", I: "Invalid" };

/** The memory strip: each line as eight 8-byte slots, counters colored by core. */
export function memory(m: Machine): string {
  const slots = LINE / WORD;
  const owner = new Map<number, number>();
  m.roles.forEach((_, c) => owner.set(c * m.stride, c));
  const lines = Array.from({ length: m.lines }, (_, l) => {
    const cells = Array.from({ length: slots }, (_, s) => {
      const off = l * LINE + s * WORD;
      const c = owner.get(off);
      return c === undefined
        ? `<span class="lp-slot"></span>`
        : `<span class="lp-slot lp-c${c}" title="c${c} at byte ${off}">c${c}</span>`;
    }).join("");
    return `<div class="lp-line"><span class="lp-lname">line ${l}</span><span class="lp-slots">${cells}</span></div>`;
  }).join("");
  return lines;
}

export function core(m: Machine, c: number): string {
  const l = lineOf(m.stride, c);
  const s = m.state[c][l];
  return `<span class="lp-cname">Core ${c}</span>
<span class="lp-role">${m.roles[c] === "write" ? "writes" : "reads"} c${c}</span>
<span class="lp-state lp-s${s}" title="${STATE_NAME[s]}">line ${l}: <b>${s}</b></span>
<span class="lp-val">c${c} = ${m.value[c]}</span>`;
}

export function counts(m: Machine): string {
  const t = tally(m);
  const cell = (label: string, v: number) => `<span class="lp-count"><span>${label}</span><b>${v}</b></span>`;
  return [
    cell("accesses", t.accesses),
    cell("hits", t.hits),
    cell("from another core", t.fromCore),
    cell("invalidations", t.invalidations),
  ].join("");
}

export function event(m: Machine): string {
  return esc(describe(m, m.trace[m.trace.length - 1]));
}

export function render(props: Props = {}): string {
  const key = presetKey(props.preset);
  const m = fresh(key);
  const n = cores(key);
  const coreCols = Array.from(
    { length: n },
    (_, c) => `<div class="lp-core lp-c${c}">
<div class="lp-cbody" data-part="core${c}">${core(m, c)}</div>
<button type="button" name="core${c}" disabled>${m.roles[c] === "write" ? "Write" : "Read"}</button>
</div>`,
  ).join("");
  return `<figure class="lp" data-preset="${key}" aria-label="${esc(PRESETS[key].label)}">
<div class="lp-mem" aria-label="Memory layout">${memory(m)}</div>
<div class="lp-cores">${coreCols}</div>
<p class="lp-event" data-part="event" aria-live="polite">${event(m)}</p>
<div class="lp-foot"><div class="lp-counts" data-part="counts">${counts(m)}</div><span class="lp-buttons"><button type="button" name="random" disabled>Random 20</button><button type="button" name="reset" disabled>Reset</button></span></div>
<figcaption>${esc(CAPTIONS[key])}</figcaption>
</figure>`;
}
