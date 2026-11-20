// Markup for the construction-threshold figure. The build renders the default
// settings; the client redraws from the same functions as points arrive.

import { esc, num } from "../../shared/format";
import { build, keysAt, KINDS, LOADS, measure, TRIALS, wilson, type Kind, type Point, type Run } from "./model";

export const SIZES = [256, 4096, 65536];
export const DEFAULT_KIND: Kind = "xor";
export const DEFAULT_S = 4096;
export const DEFAULT_LOAD = 0.8;
/** Slots in the table drawn cell by cell. */
export const SMALL = 256;
/** Fingerprint bits used for the space readout. */
export const FBITS = 8;

const W = 600;
/** Width of the chart drawn for narrow containers (phones). */
const WN = 360;
const info = (k: Kind) => KINDS.find((x) => x.id === k)!;
const fmt = (v: number) => v.toLocaleString("en-US");

export function chart(kind: Kind, S: number, load: number, pts: (Point | undefined)[], narrow = false): string {
  const W = narrow ? WN : 600;
  const L = narrow ? { left: 38, right: 12, top: 12, bottom: 40 } : { left: 46, right: 14, top: 12, bottom: 40 };
  const H = narrow ? 250 : 230;
  const pw = W - L.left - L.right;
  const ph = H - L.top - L.bottom;
  const x0 = LOADS[0];
  const x1 = LOADS[LOADS.length - 1];
  const x = (a: number) => L.left + ((a - x0) / (x1 - x0)) * pw;
  const y = (p: number) => L.top + (1 - p) * ph;
  const parts: string[] = [];
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(`<line class="fl-grid" x1="${L.left}" x2="${W - L.right}" y1="${y(p).toFixed(1)}" y2="${y(p).toFixed(1)}"/>`);
    parts.push(`<text class="fl-tick" x="${L.left - 6}" y="${(y(p) + 4).toFixed(1)}" text-anchor="end">${num(p * 100, 0)}%</text>`);
  }
  for (let a = 0.6; a <= 1.0001; a += narrow ? 0.1 : 0.05) {
    const v = Math.round(a * 100) / 100;
    parts.push(`<text class="fl-tick" x="${x(v).toFixed(1)}" y="${H - L.bottom + 16}" text-anchor="middle">${num(v, 2)}</text>`);
  }
  const step = pw / (LOADS.length - 1);
  parts.push(`<rect class="fl-sel" x="${(x(load) - step / 2).toFixed(1)}" y="${L.top}" width="${step.toFixed(1)}" height="${ph}"/>`);
  const th = info(kind).threshold;
  if (th !== null && th >= x0 && th <= x1) {
    parts.push(`<line class="fl-th" x1="${x(th).toFixed(1)}" x2="${x(th).toFixed(1)}" y1="${L.top}" y2="${L.top + ph}"/>`);
    const right = th > 0.93;
    parts.push(`<text class="fl-thlabel" x="${(x(th) + (right ? -5 : 5)).toFixed(1)}" y="${L.top + 12}" text-anchor="${right ? "end" : "start"}">limit ${num(th, 3)}</text>`);
  }
  const d: string[] = [];
  for (const p of pts) if (p) d.push(`${d.length ? "L" : "M"}${x(p.load).toFixed(1)},${y(p.ok / p.trials).toFixed(1)}`);
  if (d.length > 1) parts.push(`<path class="fl-line" d="${d.join("")}"/>`);
  for (const p of pts) {
    if (!p) continue;
    const [lo, hi] = wilson(p.ok, p.trials);
    const cx = x(p.load).toFixed(1);
    const cur = Math.abs(p.load - load) < 1e-9;
    parts.push(`<line class="fl-ci" x1="${cx}" x2="${cx}" y1="${y(hi).toFixed(1)}" y2="${y(lo).toFixed(1)}"/>`);
    parts.push(`<circle class="fl-dot${cur ? " fl-dot-cur" : ""}" cx="${cx}" cy="${y(p.ok / p.trials).toFixed(1)}" r="${cur ? 4.2 : 2.8}"/>`);
  }
  parts.push(`<text class="fl-axis" x="${L.left + pw / 2}" y="${H - 6}" text-anchor="middle">load: keys per slot</text>`);
  // On narrow charts the legend above names the vertical axis.
  if (!narrow) parts.push(`<text class="fl-axis" transform="translate(12 ${L.top + ph / 2}) rotate(-90)" text-anchor="middle">builds that succeed</text>`);
  const aria = `Fraction of ${TRIALS} builds that succeed against load for the ${info(kind).label.toLowerCase()} with ${fmt(S)} slots${th !== null ? `, with the limiting threshold ${num(th, 3)} marked` : ""}.`;
  return `<svg class="fl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

/** The small table, 32 cells per row. */
export function grid(run: Run): string {
  const cols = 32;
  const rows = run.S / cols;
  const c = 17.5;
  const L = { left: (W - cols * c) / 2, top: 4 };
  const H = L.top + rows * c + 6;
  const parts: string[] = [];
  parts.push(`<rect class="fl-bg" x="${L.left}" y="${L.top}" width="${cols * c}" height="${rows * c}"/>`);
  const cls = ["", "fl-used", "fl-bad"];
  for (let i = 0; i < run.S; i++) {
    const v = run.cells[i];
    if (!v) continue;
    parts.push(`<rect class="${cls[v]}" x="${(L.left + (i % cols) * c + 1).toFixed(1)}" y="${(L.top + Math.floor(i / cols) * c + 1).toFixed(1)}" width="${(c - 2).toFixed(1)}" height="${(c - 2).toFixed(1)}"/>`);
  }
  // group boundaries: buckets (cuckoo), blocks or segments (xor, fuse); ribbon has none
  if (!run.kind.startsWith("ribbon")) {
    for (let g = run.group; g < run.S; g += run.group) {
      const xx = L.left + (g % cols) * c;
      const yy = L.top + Math.floor(g / cols) * c;
      if (g % cols === 0) continue;
      parts.push(`<line class="fl-groupline${run.kind.startsWith("cuckoo") ? " fl-bucket" : ""}" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${(yy + 1).toFixed(1)}" y2="${(yy + c - 1).toFixed(1)}"/>`);
    }
    if (!run.kind.startsWith("cuckoo"))
      for (let g = run.group; g < run.S; g += run.group)
        if (g % cols === 0) parts.push(`<line class="fl-groupline" x1="${L.left}" x2="${L.left + cols * c}" y1="${(L.top + (g / cols) * c).toFixed(1)}" y2="${(L.top + (g / cols) * c).toFixed(1)}"/>`);
  }
  for (const s of run.kind.startsWith("ribbon") ? run.fail : []) {
    parts.push(`<rect class="fl-band" x="${(L.left + (s % cols) * c + 0.5).toFixed(1)}" y="${(L.top + Math.floor(s / cols) * c + 0.5).toFixed(1)}" width="${(c - 1).toFixed(1)}" height="${(c - 1).toFixed(1)}"/>`);
  }
  const aria = `The ${run.S} slots of one small ${info(run.kind).label.toLowerCase()} after inserting keys, 32 slots per row.`;
  return `<svg class="fl-chart fl-map" viewBox="0 0 ${W} ${H.toFixed(0)}" role="img" aria-label="${esc(aria)}">${parts.join("")}</svg>`;
}

export function runText(run: Run): string {
  const load = run.n / run.S;
  const head = `${fmt(run.n)} keys in ${run.S} slots (load ${num(load, 2)}).`;
  if (run.kind.startsWith("cuckoo")) {
    const b = run.kind === "cuckoo2" ? 2 : 4;
    return run.ok
      ? `${head} Every key found a slot in one of its two buckets, after ${fmt(run.stat)} evictions in all.`
      : `${head} Key ${fmt(run.placed + 1)} found its two buckets of ${b} full and the eviction walk ran ${500} steps without reaching a free slot; its buckets are marked.`;
  }
  if (run.kind === "xor" || run.kind === "fuse") {
    return run.ok
      ? `${head} Peeling assigned every key a slot that no unpeeled key touches, so the array can be solved by substitution in reverse peeling order.`
      : `${head} Peeling stopped with ${fmt(run.stat)} keys left whose slots are all shared with other unpeeled keys (the 2-core, marked); this seed fails and the build starts over with a new one.`;
  }
  const w = run.kind === "ribbon32" ? 32 : 64;
  return run.ok
    ? `${head} Each key's row of ${w} coefficients reduced to a new pivot column; filled cells are pivot columns.`
    : `${head} Key ${fmt(run.stat + 1)} reduced to the zero row: its coefficients are a sum of earlier rows, so the system has no solution for a random fingerprint. Its ${w}-column band is outlined.`;
}

export function readout(kind: Kind, S: number, load: number, p: Point | undefined): string {
  const n = keysAt(S, load);
  const bpk = FBITS / load;
  const space = kind.startsWith("cuckoo")
    ? `With ${FBITS}-bit fingerprints the table costs ${num(bpk, 2)} bits per key at this load, for a false-positive rate near ${num(((kind === "cuckoo2" ? 4 : 8) * load * 100) / 255, 2)}%.`
    : `With ${FBITS}-bit fingerprints the array costs ${num(bpk, 2)} bits per key at this load, for a false-positive rate of 2<sup>−${FBITS}</sup> (0.39%); the lower bound for that rate is ${FBITS} bits per key.`;
  if (!p) return `Measuring load ${num(load, 2)}… ${space}`;
  const [lo, hi] = wilson(p.ok, p.trials);
  return `At load ${num(load, 2)} (${fmt(n)} keys in ${fmt(S)} slots), <strong>${p.ok} of ${p.trials}</strong> builds succeed (95% interval ${num(lo * 100, 0)}% to ${num(hi * 100, 0)}%). ${space}`;
}

export interface Props {
  seed?: number;
}

export function initial(kind: Kind, S: number, load: number, seed: number): (Point | undefined)[] {
  const li = LOADS.findIndex((a) => Math.abs(a - load) < 1e-9);
  const pts: (Point | undefined)[] = new Array(LOADS.length).fill(undefined);
  for (let i = 0; i < LOADS.length; i += 2) pts[i] = measure(kind, S, i, seed);
  pts[li] = measure(kind, S, li, seed);
  return pts;
}

export function render(props: Props): string {
  const seed = typeof props.seed === "number" ? props.seed : 1;
  const pts = initial(DEFAULT_KIND, DEFAULT_S, DEFAULT_LOAD, seed);
  const li = LOADS.findIndex((a) => Math.abs(a - DEFAULT_LOAD) < 1e-9);
  const run = build(DEFAULT_KIND, SMALL, keysAt(SMALL, DEFAULT_LOAD), seed);
  const kinds = KINDS.map((o) => `<option value="${o.id}"${o.id === DEFAULT_KIND ? " selected" : ""}>${esc(o.label)}</option>`).join("");
  const sizes = SIZES.map((s) => `<option value="${s}"${s === DEFAULT_S ? " selected" : ""}>${fmt(s)}</option>`).join("");
  return [
    `<figure class="fl" data-seed="${seed}">`,
    `<div class="fl-controls">`,
    `<label class="fl-select fl-wide"><span>Layout</span><select name="kind" disabled>${kinds}</select></label>`,
    `<label class="fl-select"><span>Slots</span><select name="size" disabled>${sizes}</select></label>`,
    `<label class="fl-slider"><span>Load <output name="load-out">${num(DEFAULT_LOAD, 2)}</output></span><input type="range" name="load" min="0" max="${LOADS.length - 1}" step="1" value="${li}" disabled></label>`,
    `<button type="button" name="rerun" disabled>New seeds</button>`,
    `</div>`,
    `<div class="fl-legend" aria-hidden="true"><span class="fl-key fl-key-dot">builds that succeed, of ${TRIALS}, with 95% interval</span><span class="fl-key fl-key-th">limit as the table grows</span></div>`,
    `<div class="fl-plot" data-part="chart">${chart(DEFAULT_KIND, DEFAULT_S, DEFAULT_LOAD, pts)}</div>`,
    `<p class="fl-readout" data-part="readout" aria-live="polite">${readout(DEFAULT_KIND, DEFAULT_S, DEFAULT_LOAD, pts[li])}</p>`,
    `<div class="fl-controls fl-sub"><span class="fl-subhead">One build in ${SMALL} slots at the same load</span><button type="button" name="next" disabled>Another build</button></div>`,
    `<div class="fl-legend" aria-hidden="true"><span class="fl-key fl-key-used">slot in use</span><span class="fl-key fl-key-bad">slot in the failure</span></div>`,
    `<div class="fl-plot" data-part="map">${grid(run)}</div>`,
    `<p class="fl-readout" data-part="run" aria-live="polite">${runText(run)}</p>`,
    `<figcaption>Simulation in the browser on integer keys with seeded 32-bit hashes. Cuckoo filters insert keys one at a time with up to 500 evictions and fail at the first key that does not fit; xor and binary fuse filters peel the 3-uniform hypergraph of key positions; ribbon filters run on-the-fly Gaussian elimination over GF(2) and fail when a key's row is linearly dependent on earlier rows. The vertical line is the load below which a valid layout exists with probability tending to 1 as the table grows and above which it tends to 0. For cuckoo filters the line is the threshold for the existence of a placement, which a random walk limited to 500 evictions does not always find. Ribbon filters of a fixed width have no such constant, since the overhead they need grows with the number of keys.</figcaption>`,
    `</figure>`,
  ].join("");
}
