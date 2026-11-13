// Markup for the page replacement figure. The build renders the controls and
// the fault curves, which need only the counts pagesim.c recorded; the client
// module loads the reference string itself and fills in the reference map and
// the step-by-step view.

import { anomalies, BELADY, POLICIES, POLICY_NAMES, windows, type Policy, type Sim, type Step } from "./model";

export const TRACE_KEYS = ["gzip9", "bzip2", "sort200k", "cc1_lopcodes", "belady"] as const;
export type TraceKey = (typeof TRACE_KEYS)[number];

const LABELS: Record<TraceKey, string> = {
  gzip9: "gzip -9",
  bzip2: "bzip2 -9",
  sort200k: "sort",
  cc1_lopcodes: "gcc",
  belady: "Textbook string",
};

const DESCRIPTIONS: Record<TraceKey, string> = {
  gzip9: "gzip compressing 132 KB of text at level 9.",
  bzip2: "bzip2 compressing the same 132 KB of text.",
  sort200k: "GNU sort sorting 200 KB of text.",
  cc1_lopcodes: "gcc's compiler proper (cc1) compiling an 838-line C file without optimization.",
  belady: "The 12-reference string textbooks use for Belady's anomaly.",
};

export const nf = (v: number): string => v.toLocaleString("en-US");

/** Everything the figure needs to know about one trace, before or after loading it. */
export interface Meta {
  key: TraceKey;
  refs: number;
  pages: number;
  /** Index of the window's first reference in the whole run, and the run's length. */
  offset: number;
  fullRefs: number;
  curves: Record<Policy, number[]>;
}

export function knownMeta(key: TraceKey, beladyCurves?: Record<Policy, number[]>): Meta {
  if (key === "belady") {
    return { key, refs: BELADY.length, pages: 5, offset: 0, fullRefs: BELADY.length, curves: beladyCurves! };
  }
  const w = windows[key];
  return { key, refs: w.refs, pages: w.pages, offset: w.window_start, fullRefs: w.full_refs, curves: w.curves };
}

/** A frame count in the interesting part of the curve: the smallest where LRU faults on at most 1% of references. */
export function defaultFrames(meta: Meta): number {
  if (meta.key === "belady") return 3;
  const i = meta.curves.lru.findIndex((f) => f <= meta.refs / 100);
  return i >= 0 ? i + 1 : meta.pages;
}

export function describe(meta: Meta): string {
  const base = DESCRIPTIONS[meta.key];
  if (meta.key === "belady") return base;
  return `${base} Shown: references ${nf(meta.offset + 1)} to ${nf(meta.offset + meta.refs)} of ${nf(meta.fullRefs)}, which touch ${meta.pages} distinct 4 KiB pages.`;
}

// Curve geometry, in SVG user units.
const W = 640;
const H = 250;
const M = { left: 62, right: 14, top: 14, bottom: 38 };

const log = Math.log10;

function ticks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(log(lo)); e <= Math.ceil(log(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}

const short = (v: number): string => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}k` : String(v));

export function curveSvg(meta: Meta, frames: number): string {
  const xmax = Math.max(2, meta.pages);
  const all = POLICIES.flatMap((p) => meta.curves[p]);
  const ylo = Math.max(1, Math.min(...all));
  const yhi = Math.max(...all);
  const yspan = Math.max(log(yhi) - log(ylo), 0.3);
  const x = (f: number) => M.left + (log(f) / log(xmax)) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - (log(Math.max(v, ylo)) - log(ylo)) / yspan) * (H - M.top - M.bottom);
  const parts: string[] = [`<svg viewBox="0 0 ${W} ${H}" class="pr-curve" role="img" aria-label="Page faults against number of frames for each policy">`];
  for (const v of ticks(ylo, yhi)) {
    parts.push(`<line class="pr-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`);
    parts.push(`<text class="pr-tick" x="${M.left - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${short(v)}</text>`);
  }
  for (const v of ticks(1, xmax)) {
    parts.push(`<text class="pr-tick" x="${x(v).toFixed(1)}" y="${H - M.bottom + 16}" text-anchor="middle">${v}</text>`);
  }
  parts.push(`<text class="pr-axis" x="${(M.left + W - M.right) / 2}" y="${H - 4}" text-anchor="middle">frames of memory (log scale)</text>`);
  parts.push(`<text class="pr-axis" x="14" y="${(M.top + H - M.bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(M.top + H - M.bottom) / 2})">page faults (log scale)</text>`);
  for (const p of POLICIES) {
    const pts = meta.curves[p].map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    parts.push(`<polyline class="pr-line pr-${p}" points="${pts}"/>`);
  }
  for (const p of ["fifo", "clock"] as Policy[]) {
    for (const f of anomalies(meta.curves[p])) {
      const v = meta.curves[p];
      parts.push(
        `<circle class="pr-anomaly pr-${p}" cx="${x(f + 1).toFixed(1)}" cy="${y(v[f]).toFixed(1)}" r="4"><title>${POLICY_NAMES[p]}: ${nf(v[f - 1])} faults with ${f} frames, ${nf(v[f])} with ${f + 1}</title></circle>`,
      );
    }
  }
  const fx = x(Math.min(frames, xmax)).toFixed(1);
  parts.push(`<line class="pr-marker" x1="${fx}" x2="${fx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  parts.push(`</svg>`);
  return parts.join("");
}

export function legend(meta: Meta, frames: number): string {
  const opt = meta.curves.opt[frames - 1];
  const rows = POLICIES.map((p) => {
    const v = meta.curves[p][frames - 1];
    const vs = p === "opt" ? "the minimum" : `${(v / opt).toFixed(2)}× OPT`;
    return `<li><span class="pr-swatch pr-${p}"></span><b>${POLICY_NAMES[p]}</b> ${nf(v)} <span class="pr-dim">(${vs})</span></li>`;
  });
  const an = (["fifo", "clock"] as Policy[]).map((p) => anomalies(meta.curves[p]).length);
  const anomalyNote =
    an[0] + an[1] > 0
      ? `<p class="pr-dim">Rings mark frame counts where one more frame caused more faults: ${an[0]} for FIFO and ${an[1]} for CLOCK on this trace.</p>`
      : `<p class="pr-dim">No frame count on this trace gives FIFO or CLOCK more faults with one more frame.</p>`;
  return `<ul class="pr-legend">${rows.join("")}</ul>${anomalyNote}`;
}

export const framesLabel = (meta: Meta, frames: number): string =>
  meta.key === "belady" ? `${frames} frames` : `${frames} frames (${nf(frames * 4)} KiB)`;

const pageName = (p: number): string => `p${p}`;

/** The time a reference happened, numbered within the whole run so it matches the description. */
const when = (meta: Meta, t: number): string => nf(meta.offset + t + 1);

export function why(meta: Meta, policy: Policy, s: Step): string {
  if (s.hit) return "";
  if (s.victim < 0) return "a frame was still free";
  switch (policy) {
    case "fifo":
      return `loaded at reference ${when(meta, s.victimTime)}, the earliest of the resident pages`;
    case "lru":
      return `last used at reference ${when(meta, s.victimTime)}, longer ago than any other resident page`;
    case "clock":
      return s.swept === 0 ? "the hand found its reference bit already clear" : `the hand cleared ${s.swept} reference bit${s.swept === 1 ? "" : "s"} before reaching a clear one`;
    case "opt":
      return s.victimTime >= meta.refs ? "never referenced again in this trace" : `next used at reference ${when(meta, s.victimTime)}, later than any other resident page`;
  }
}

const ORDER_NOTE: Record<Policy, string> = {
  fifo: "oldest load first",
  lru: "least recently used first",
  clock: "frame slots; the arrow is the hand, a dot is a set reference bit",
  opt: "furthest next use first",
};

/** The resident pages after the step, drawn as boxes. Only used for small frame counts. */
function framesRow(sim: Sim, s: Step): string {
  const box = (p: number, extra = "") => {
    const cls = ["pr-frame"];
    if (p === s.page) cls.push(s.hit ? "pr-hitbox" : "pr-newbox");
    return `<span class="${cls.join(" ")}"${extra}>${p < 0 ? "" : pageName(p)}</span>`;
  };
  let cells: string;
  if (sim.slots) {
    const { pages, bits, hand } = sim.slots();
    cells = Array.from({ length: sim.frames }, (_, i) => {
      const p = i < pages.length ? pages[i] : -1;
      const mark = `${i === hand ? '<span class="pr-hand" aria-label="hand">▲</span>' : ""}${p >= 0 && bits[i] ? '<span class="pr-bit" aria-label="reference bit set">•</span>' : ""}`;
      return `<span class="pr-slot">${box(p)}${mark}</span>`;
    }).join("");
  } else {
    const order = sim.order();
    cells = Array.from({ length: sim.frames }, (_, i) => `<span class="pr-slot">${box(i < order.length ? order[i] : -1)}</span>`).join("");
  }
  const evicted = s.victim >= 0 ? `<span class="pr-evicted" title="evicted">${pageName(s.victim)}</span>` : "";
  return `<div class="pr-frames">${evicted}${cells}</div><p class="pr-order">${ORDER_NOTE[sim.policy]}</p>`;
}

export interface StepView {
  meta: Meta;
  trace: ArrayLike<number>;
  t: number;
  frames: number;
  focus: Policy;
  steps: Record<Policy, Step>;
  sims: Record<Policy, Sim>;
  faultsSoFar: Record<Policy, number>;
}

/** The step panel: the references around t, then what each policy did at t. */
export function stepPanel(v: StepView): string {
  const { meta, trace, t } = v;
  const lo = Math.max(0, Math.min(t - 8, meta.refs - 17));
  const hi = Math.min(meta.refs, lo + 17);
  const strip: string[] = [];
  for (let i = lo; i < hi; i++) {
    const cls = i === t ? "pr-ref pr-now" : i < t ? "pr-ref pr-past" : "pr-ref";
    strip.push(`<span class="${cls}">${pageName(trace[i])}</span>`);
  }
  const small = v.frames <= 16;
  const rows = POLICIES.map((p) => {
    const s = v.steps[p];
    const head = `<p class="pr-row-head"><span class="pr-swatch pr-${p}"></span><b>${POLICY_NAMES[p]}</b> ${s.hit ? `<span class="pr-hit">hit</span>` : `<span class="pr-fault">fault</span>`}${s.victim >= 0 ? `, evicts <b>${pageName(s.victim)}</b>: ${why(meta, p, s)}` : s.hit ? "" : `: ${why(meta, p, s)}`} <span class="pr-dim">· ${nf(v.faultsSoFar[p])} faults so far</span></p>`;
    return `<div class="pr-row${p === v.focus ? " pr-focus" : ""}">${head}${small ? framesRow(v.sims[p], s) : ""}</div>`;
  });
  return [
    `<p class="pr-where">Reference <b>${when(meta, t)}</b> is to page <b>${pageName(trace[t])}</b>.</p>`,
    `<div class="pr-strip" aria-label="Nearby references, the current one highlighted">${strip.join("")}</div>`,
    rows.join(""),
    small ? "" : `<p class="pr-dim">Frame contents are drawn for 16 frames or fewer.</p>`,
  ].join("");
}

const button = (attrs: string, label: string, pressed?: boolean) =>
  `<button type="button" ${attrs}${pressed === undefined ? "" : ` aria-pressed="${pressed}"`} disabled>${label}</button>`;

export interface Props {
  trace?: string;
  base?: string;
}

/** The whole figure, rendered at build time for the default trace. */
export function render(props: Props): string {
  const key = (TRACE_KEYS as readonly string[]).includes(props.trace ?? "") ? (props.trace as TraceKey) : "gzip9";
  const meta = knownMeta(key);
  const frames = defaultFrames(meta);
  const base = props.base ?? "";
  return [
    `<figure class="pr" data-trace="${key}" data-base="${base}">`,
    `<div class="pr-controls">`,
    `<div class="pr-row-buttons" role="group" aria-label="Trace">${TRACE_KEYS.map((k) => button(`name="trace" value="${k}"`, LABELS[k], k === key)).join("")}</div>`,
    `<p class="pr-desc" data-part="desc">${describe(meta)}</p>`,
    `<label class="pr-slider">Memory: <output name="frames-out">${framesLabel(meta, frames)}</output><input type="range" name="frames" min="1" max="${meta.pages}" value="${frames}" disabled></label>`,
    `</div>`,
    `<div data-part="curve">${curveSvg(meta, frames)}</div>`,
    `<div data-part="legend">${legend(meta, frames)}</div>`,
    `<p class="pr-title">Where the faults fall <span class="pr-dim">time runs left to right, pages by first use top to bottom; marks are faults under</span></p>`,
    `<div class="pr-row-buttons" role="group" aria-label="Policy whose faults the map shows">${POLICIES.map((p) => button(`name="focus" value="${p}"`, POLICY_NAMES[p], p === "lru")).join("")}</div>`,
    `<div class="pr-map" data-part="map"><canvas aria-label="Reference map. Click to move to a point in time; arrow keys step." tabindex="0"></canvas></div>`,
    `<div class="pr-row-buttons" role="group" aria-label="Step through the trace">`,
    button('name="step" value="-1"', "◀ Back"),
    button('name="step" value="1"', "Step ▶"),
    button('name="next-fault"', "Next fault ▶▶"),
    `</div>`,
    `<div class="pr-step" data-part="step" aria-live="polite"><p class="pr-dim">The step view needs the reference string, which loads with the page's script.</p></div>`,
    `<figcaption>Real page reference strings, recorded by running each program under Valgrind and keeping every instruction fetch, load and store as a 4 KiB page number. Each program trace shown is one million consecutive references from the middle of the run. The curves are fault counts that <code>pagesim.c</code> computed for every frame count; the map and the step view rerun the same policies in your browser, and a test checks that they agree.</figcaption>`,
    `</figure>`,
  ].join("");
}
