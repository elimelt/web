// Markup for the real-time schedule figure. One block per policy (rate
// monotonic, then EDF), one row per task, with releases, deadlines and missed
// deadlines marked, and under them the schedulability tests for the current
// task set. A slider per task sets its execution time C. When the task set is
// the preset and the note supplies a kernel measurement, the finish times
// measured on Linux are drawn over the simulated rows.

import { esc, num } from "../../shared/format";
import { hyperbolicProduct, hyperperiod, llBound, parseTasks, rta, simulate, utilization, type Policy, type Run, type Task } from "./model";

export interface Props {
  /** The task set as "C:T, C:T", at most three tasks with periods of at most 16. */
  tasks?: string;
  /** Kernel-measured finish times, "rm=2.01 8.04 ...; edf=..." in ticks, jobs ordered by task then job index. */
  measured?: string;
  /** What one tick stands for in the measurement, for the legend. */
  unit?: string;
  caption?: string;
}

export interface State {
  tasks: Task[];
  preset: Task[];
  horizon: number;
  measured: Partial<Record<Policy, number[]>>;
  unit: string;
}

const NAMES: Record<Policy, [string, string]> = {
  rm: ["Rate monotonic", "fixed priority, shorter period first"],
  edf: ["EDF", "earliest absolute deadline first"],
};
const SUB = ["₁", "₂", "₃"];
const tau = (i: number) => `τ${SUB[i] ?? i + 1}`;
const pct3 = (x: number) => num(x, 3);

export function stateFrom(props: Props): State {
  let tasks = parseTasks(props.tasks ?? "2:5, 4:7").slice(0, 3);
  tasks = tasks.filter((x) => x.t <= 16);
  if (!tasks.length) tasks = [{ c: 2, t: 5 }, { c: 4, t: 7 }];
  const h = hyperperiod(tasks);
  const measured: Partial<Record<Policy, number[]>> = {};
  for (const part of (props.measured ?? "").split(";")) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if ((k === "rm" || k === "edf") && v) measured[k] = v.split(/\s+/).map(Number).filter(Number.isFinite);
  }
  return { tasks, preset: tasks.map((x) => ({ ...x })), horizon: h < 20 ? 2 * h : h, measured, unit: props.unit ?? "" };
}

const isPreset = (s: State) => s.tasks.every((x, i) => x.c === s.preset[i].c && x.t === s.preset[i].t);

function headline(s: State, policy: Policy, run: Run): string {
  const [name, rule] = NAMES[policy];
  const h = hyperperiod(s.tasks);
  const first = run.misses.filter((j) => j.deadline <= h).sort((a, b) => a.deadline - b.deadline)[0];
  const verdict = first
    ? `<span class="rts-bad">${tau(first.task)} misses its deadline at t = ${first.deadline}</span>${run.misses.length > 1 ? `, ${run.misses.length} late jobs in all` : ""}`
    : `every deadline met over the hyperperiod of ${h}`;
  return `<p class="rts-head"><strong>${name}</strong> (${rule}): ${verdict}.</p>`;
}

/** The rows for one policy on a shared axis. */
function block(s: State, policy: Policy): string {
  const run = simulate(s.tasks, policy, s.horizon);
  const pct = (t: number) => `${((t / s.horizon) * 100).toFixed(3)}%`;
  const showMeasured = isPreset(s) && s.measured[policy]?.length;
  const ordered = [...run.jobs].sort((a, b) => a.task - b.task || a.k - b.k);
  const rows = s.tasks.map((x, i) => {
    const segs: string[] = [];
    for (let a = 0; a < s.horizon; ) {
      if (run.schedule[a] !== i) {
        a++;
        continue;
      }
      let b = a;
      while (b < s.horizon && run.schedule[b] === i) b++;
      segs.push(`<span class="rts-seg rts-c${i}" style="left:${pct(a)};width:${pct(b - a)}" title="${tau(i)} runs ${a} to ${b}"></span>`);
      a = b;
    }
    const marks = run.jobs
      .filter((j) => j.task === i)
      .map((j) => {
        const late = run.misses.includes(j);
        const rel = `<span class="rts-rel" style="left:${pct(j.release)}" title="${tau(i)} job ${j.k + 1} released at ${j.release}"></span>`;
        const dl =
          j.deadline <= s.horizon
            ? `<span class="rts-dl${late ? " rts-miss" : ""}" style="left:${pct(j.deadline)}" title="${tau(i)} job ${j.k + 1}: deadline ${j.deadline}, ${j.finish === null ? "unfinished" : `finished at ${j.finish}`}"></span>`
            : "";
        return rel + dl;
      })
      .join("");
    let meas = "";
    if (showMeasured) {
      const vals = s.measured[policy]!;
      meas = ordered
        .map((j, idx) => ({ j, v: vals[idx] }))
        .filter(({ j, v }) => j.task === i && v !== undefined && v <= s.horizon)
        .map(({ j, v }) => `<span class="rts-meas" style="left:${pct(v)}" title="${tau(i)} job ${j.k + 1} finished at ${num(v, 2)} on Linux${s.unit ? ` (1 tick = ${esc(s.unit)})` : ""}"></span>`)
        .join("");
    }
    return `<div class="rts-row"><span class="rts-name">${tau(i)}</span><div class="rts-track">${segs.join("")}${marks}${meas}</div></div>`;
  });
  return `<div class="rts-block">${headline(s, policy, run)}${rows.join("")}</div>`;
}

export function chartHtml(s: State): string {
  const pct = (t: number) => `${((t / s.horizon) * 100).toFixed(3)}%`;
  const step = s.horizon <= 20 ? 2 : 5;
  const ticks: string[] = [];
  for (let t = 0; t <= s.horizon; t += step) ticks.push(`<span style="left:${pct(t)}">${t}</span>`);
  return `${block(s, "rm")}${block(s, "edf")}<div class="rts-row rts-axis"><span class="rts-name"></span><div class="rts-track">${ticks.join("")}</div></div>`;
}

/** The schedulability tests, each with the claim it can make. */
export function testsHtml(s: State): string {
  const n = s.tasks.length;
  const u = utilization(s.tasks);
  const ll = llBound(n);
  const hb = hyperbolicProduct(s.tasks);
  const r = rta(s.tasks);
  const rtaText = r
    .map((x, i) => `R${SUB[i]}: ${x.iterates.join(" → ")}${x.ok ? ` ≤ ${s.tasks[i].t}` : ` > ${s.tasks[i].t}`}`)
    .join("; ");
  const rmOk = r.every((x) => x.ok);
  const line = (label: string, body: string, verdict: string, cls: string) =>
    `<li><span class="rts-test">${label}</span> ${body} <span class="rts-${cls}">${verdict}</span></li>`;
  return `<ul class="rts-tests">
${line("Utilization", `U = ${s.tasks.map((x) => `${x.c}/${x.t}`).join(" + ")} = ${pct3(u)}.`, u <= 1 + 1e-12 ? "EDF: schedulable (exact)." : "No policy can schedule it.", u <= 1 + 1e-12 ? "good" : "bad")}
${line("Liu-Layland", `U ≤ ${n}(2<sup>1/${n}</sup> − 1) = ${pct3(ll)}?`, u <= ll + 1e-12 ? "RM: schedulable." : "Inconclusive for RM.", u <= ll + 1e-12 ? "good" : "muted")}
${line("Hyperbolic", `∏(U<sub>i</sub> + 1) = ${pct3(hb)} ≤ 2?`, hb <= 2 + 1e-12 ? "RM: schedulable." : "Inconclusive for RM.", hb <= 2 + 1e-12 ? "good" : "muted")}
${line("Response time", `${rtaText}.`, rmOk ? "RM: schedulable (exact)." : "RM: unschedulable (exact).", rmOk ? "good" : "bad")}
</ul>`;
}

function sliders(s: State, interactive: boolean): string {
  return s.tasks
    .map(
      (x, i) =>
        `<label class="rts-slider"><span>C${SUB[i]} (T${SUB[i]} = ${x.t}) <output name="c${i}">${x.c}</output></span><input type="range" name="c${i}" min="1" max="${x.t}" step="1" value="${x.c}"${interactive ? "" : " disabled"}></label>`,
    )
    .join("");
}

export function render(props: Props): string {
  const s = stateFrom(props);
  const hasMeasured = Object.keys(s.measured).length > 0;
  return `<figure class="rts" data-state="${esc(JSON.stringify(s))}">
<div class="rts-controls">${sliders(s, false)}</div>
<div class="rts-legend" aria-hidden="true"><span class="rts-key rts-c0"></span>running <span class="rts-key rts-key-rel"></span>release <span class="rts-key rts-key-dl"></span>deadline <span class="rts-key rts-key-miss"></span>missed deadline${hasMeasured ? ` <span class="rts-key rts-key-meas"></span>finish measured on Linux${s.unit ? ` (1 tick = ${esc(s.unit)})` : ""}, shown for the preset task set` : ""}. Simulated in discrete time; late jobs run to completion.</div>
<div class="rts-chart" data-part="chart">${chartHtml(s)}</div>
<div data-part="tests">${testsHtml(s)}</div>
${props.caption ? `<figcaption>${esc(props.caption)}</figcaption>` : ""}
</figure>`;
}
