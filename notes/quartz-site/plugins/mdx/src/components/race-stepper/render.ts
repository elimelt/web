// Markup for the race stepper. The build renders the preset's starting state
// with the buttons disabled; the client redraws the same parts from these
// functions after every step.

import { esc } from "../../shared/format";
import { done, fresh, inCS, PRESETS, presetKey, summary, THREADS, type Machine, type ThreadId } from "./model";

export interface Props {
  preset?: unknown;
}

const CAPTIONS: Record<string, string> = {
  counter:
    "Two threads each add 1 to a shared counter, which compiles to a load, an add and a store. Press a thread's button to run its next line; the order you press is the schedule. The highlighted line is the one that runs next.",
  "broken-lock":
    "The same increment, now guarded by a lock that checks held and then sets it in two separate steps. The shaded lines are the critical section.",
  tas:
    "The same increment guarded by a spinlock. test_and_set reads held and writes 1 to it in one indivisible step, so at most one thread can read 0.",
};

const usesHeld = (m: Machine): boolean => m.program.some((i) => "v" in i && i.v === "held");

export function memory(m: Machine): string {
  const cell = (name: string, v: number) => `<span class="rs-cell"><span>${name}</span><b>${v}</b></span>`;
  return `${cell("counter", m.mem.counter)}${usesHeld(m) ? cell("held", m.mem.held) : ""}`;
}

export function thread(m: Machine, t: ThreadId): string {
  const s = m.th[t];
  const lines = m.program
    .map((ins, i) => {
      const cls = ["rs-line", ins.cs ? "rs-cs" : "", i === s.pc ? "rs-next" : ""].filter(Boolean).join(" ");
      return `<div class="${cls}"><span class="rs-no">${i + 1}</span><code>${ins.short ? `<span class="rs-long">${esc(ins.text)}</span><span class="rs-short">${esc(ins.short)}</span>` : esc(ins.text)}</code></div>`;
    })
    .join("");
  const state = done(m, t) ? "finished" : inCS(m, t) && m.program.some((i) => !i.cs) ? "in critical section" : "";
  return `<div class="rs-head"><span class="rs-name">Thread ${t}</span><span class="rs-reg">r = ${s.r}</span></div>
<div class="rs-code">${lines}</div>
<div class="rs-state">${state || "&nbsp;"}</div>`;
}

export function order(m: Machine): string {
  return m.trace.length === 0 ? "Order: none yet" : `Order: ${m.trace.map((s) => s.t).join(" ")}`;
}

export function render(props: Props = {}): string {
  const key = presetKey(props.preset);
  const m = fresh(key);
  const sum = summary(m);
  const threads = THREADS.map(
    (t) => `<section class="rs-thread rs-${t}" aria-label="Thread ${t}">
<div data-part="thread${t}">${thread(m, t)}</div>
<button type="button" name="step${t}" disabled>Step ${t}</button>
</section>`,
  ).join("");
  return `<figure class="rs" data-preset="${key}" aria-label="${esc(PRESETS[key].label)}">
<div class="rs-mem" data-part="mem" aria-label="Shared memory">${memory(m)}</div>
<div class="rs-threads">${threads}</div>
<p class="rs-summary" data-part="summary" data-tone="${sum.tone}" aria-live="polite">${esc(sum.text)}</p>
<div class="rs-foot"><span class="rs-order" data-part="order">${order(m)}</span><button type="button" name="reset" disabled>Reset</button></div>
<figcaption>${esc(CAPTIONS[key])}</figcaption>
</figure>`;
}
