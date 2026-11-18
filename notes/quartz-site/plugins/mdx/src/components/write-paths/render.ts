// Markup for the write-paths figure. Both structures are drawn on one key
// axis (keys 0 to 127), so a B-tree page and an SSTable that hold the same
// keys sit above one another. The build replays the default stream and draws
// the finished state; the client redraws the same parts with these functions.

import { esc } from "../../shared/format";
import {
  BLOOM_BITS,
  CHECKPOINT_PAGES,
  FANOUT,
  FILE,
  KEYS,
  L0_TRIGGER,
  L1_TARGET,
  LEVELS,
  MEMTABLE,
  PAGE,
  Run,
  WORKLOADS,
  hi,
  lo,
  type BNode,
  type Workload,
} from "./model";

export const BATCHES = [1, 4, 16];
export const SPACE = 128; // key axis: 0..127; even keys are written, odd keys never are

export interface State {
  workload: Workload;
  batch: number;
  at: number; // writes applied
  key: number; // key looked up
}

export const streamLength = (w: Workload) => (w === "updates" ? 3 * KEYS : KEYS);

/** Replays the state's stream up to the last commit boundary at or before `at`. */
export function replay(s: State): Run {
  const run = new Run(s.workload, s.batch);
  run.runTo(s.at);
  return run;
}

const W = 600;
const L = 64; // left margin for row labels
const R = 8;
const AW = W - L - R;
const edge = (k: number) => L + (k / SPACE) * AW;
const mid = (k: number) => L + ((k + 0.5) / SPACE) * AW;
const f1 = (v: number) => v.toFixed(1);
const ROW = 36;
const BOX = 24;

function dots(keys: number[], y: number, cls: string): string {
  return keys.map((k) => `<circle class="${cls}" cx="${f1(mid(k))}" cy="${f1(y)}" r="3"/>`).join("");
}

function axis(y: number): string {
  const parts = [`<line class="wp-axis" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>`];
  for (let k = 0; k <= SPACE; k += 32) {
    parts.push(`<line class="wp-axis" x1="${f1(edge(k))}" x2="${f1(edge(k))}" y1="${y}" y2="${y + 4}"/>`);
    parts.push(`<text class="wp-tick" x="${f1(edge(k))}" y="${y + 16}" text-anchor="middle">${k}</text>`);
  }
  parts.push(`<text class="wp-tick" x="${L - 6}" y="${y + 16}" text-anchor="end">key</text>`);
  return parts.join("");
}

function keyLine(key: number, top: number, bottom: number): string {
  return `<line class="wp-keyline" x1="${f1(mid(key))}" x2="${f1(mid(key))}" y1="${top}" y2="${bottom}"/>`;
}

/** The B-tree, one row per depth, each page drawn over the key range it covers. */
export function btreeSvg(run: Run, key: number): string {
  const t = run.btree;
  const rows = t.levels();
  const onPath = new Set(t.path(key).map((n) => n.id));
  const bounds = new Map<number, [number, number]>();
  const walk = (n: BNode, a: number, b: number) => {
    bounds.set(n.id, [a, b]);
    if (n.leaf) return;
    n.children.forEach((c, i) => walk(c, i === 0 ? a : n.keys[i - 1], i === n.keys.length ? b : n.keys[i]));
  };
  walk(t.root, 0, SPACE);
  const top = 6;
  const H = top + rows.length * ROW + 26;
  const parts: string[] = [keyLine(key, top - 4, top + rows.length * ROW - 6)];
  rows.forEach((row, d) => {
    const y = top + d * ROW;
    const label = d === 0 ? "root" : row[0].leaf ? "leaves" : "inner";
    parts.push(`<text class="wp-row" x="${L - 6}" y="${y + BOX / 2 + 4}" text-anchor="end">${label}</text>`);
    for (const n of row) {
      const [a, b] = bounds.get(n.id)!;
      const cls = ["wp-page", n.leaf ? "wp-leaf" : "wp-inner", t.lastWritten.has(n.id) ? "wp-new" : "", onPath.has(n.id) ? "wp-path" : ""].filter(Boolean).join(" ");
      const fill = n.leaf ? n.keys.length : n.children.length;
      const what = n.leaf ? `${fill} of ${PAGE} records: ${n.keys.join(", ") || "empty"}` : `${fill} of ${PAGE} children, separators ${n.keys.join(", ")}`;
      parts.push(`<rect class="${cls}" x="${f1(edge(a) + 1)}" y="${y}" width="${f1(Math.max(edge(b) - edge(a) - 2, 2))}" height="${BOX}" rx="2"><title>Page ${n.id}, keys ${a} to ${b - 1}: ${esc(what)}</title></rect>`);
      if (n.leaf) parts.push(dots(n.keys, y + BOX / 2, "wp-dot"));
      else for (const s of n.keys) parts.push(`<line class="wp-sep" x1="${f1(edge(s))}" x2="${f1(edge(s))}" y1="${y + 3}" y2="${y + BOX - 3}"/>`);
    }
  });
  parts.push(axis(top + rows.length * ROW - 4));
  const label = `B-tree of height ${t.height} with ${t.pages} pages after ${run.pos} writes.`;
  return `<svg class="wp-tree" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

/** The LSM-tree: the memtable, then one row per level with each SSTable over its key range. */
export function lsmSvg(run: Run, key: number): string {
  const t = run.lsm;
  const look = t.lookup(key);
  const probe = new Map(look.probes.map((p) => [p.file.id, p]));
  const top = 6;
  const rows = 1 + LEVELS;
  const H = top + rows * ROW + 26;
  const parts: string[] = [keyLine(key, top - 4, top + rows * ROW - 6)];
  const memKeys = [...t.memtable.keys()];
  parts.push(`<text class="wp-row" x="${L - 6}" y="${top + BOX / 2 + 4}" text-anchor="end">mem</text>`);
  parts.push(`<rect class="wp-mem${look.memtable ? " wp-hit" : ""}" x="${L + 1}" y="${top}" width="${AW - 2}" height="${BOX}" rx="2"><title>Memtable, in memory: ${memKeys.length} of ${MEMTABLE} records${memKeys.length ? `: ${memKeys.sort((a, b) => a - b).join(", ")}` : ""}</title></rect>`);
  parts.push(dots(memKeys, top + BOX / 2, "wp-dot"));
  for (let l = 0; l < LEVELS; l++) {
    const y = top + (l + 1) * ROW;
    const size = t.size(l);
    const target = l === 0 ? `${L0_TRIGGER} files trigger a merge` : l === LEVELS - 1 ? "last level" : `target ${L1_TARGET * FANOUT ** (l - 1)} records`;
    parts.push(`<text class="wp-row" x="${L - 6}" y="${y + BOX / 2 + 4}" text-anchor="end"><title>${esc(`${size} records; ${target}`)}</title>L${l}</text>`);
    for (const f of t.levels[l]) {
      const p = probe.get(f.id);
      const cls = ["wp-file", t.lastWritten.has(f.id) ? "wp-new" : "", p ? (p.found ? "wp-hit" : p.read ? "wp-read" : "wp-skip") : ""].filter(Boolean).join(" ");
      const how = p ? (p.found ? "; the lookup reads this file and finds the key" : p.read ? "; the Bloom filter passes (a false positive) and the file is read" : "; the Bloom filter rules the key out, so the file is not read") : "";
      parts.push(`<rect class="${cls}" x="${f1(edge(lo(f)) + 1)}" y="${y}" width="${f1(Math.max(edge(hi(f) + 1) - edge(lo(f)) - 2, 3))}" height="${BOX}" rx="2"><title>${esc(`SSTable ${f.id} in L${l}: ${f.entries.length} records, keys ${lo(f)} to ${hi(f)}${how}`)}</title></rect>`);
      parts.push(dots(f.entries.map((e) => e.key), y + BOX / 2, "wp-dot"));
    }
  }
  parts.push(axis(top + rows * ROW - 4));
  const label = `LSM-tree after ${run.pos} writes: ${memKeys.length} records in the memtable, ${t.levels.map((lv, i) => `${lv.length} files in L${i}`).join(", ")}.`;
  return `<svg class="wp-tree" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

// ---- cumulative write amplification -----------------------------------------------

const CW = 600;
const CH = 170;
const CM = { left: 40, right: 12, top: 10, bottom: 32 };

export function chartSvg(run: Run, s: State): string {
  const total = streamLength(s.workload);
  const pw = CW - CM.left - CM.right;
  const ph = CH - CM.top - CM.bottom;
  const ymax = 20;
  const x = (v: number) => CM.left + (v / total) * pw;
  const y = (v: number) => CM.top + (1 - Math.min(v, ymax) / ymax) * ph;
  const parts: string[] = [];
  for (let v = 0; v <= ymax; v += 5) {
    parts.push(`<line class="wp-grid" x1="${CM.left}" x2="${CW - CM.right}" y1="${f1(y(v))}" y2="${f1(y(v))}"/>`);
    parts.push(`<text class="wp-tick" x="${CM.left - 6}" y="${f1(y(v) + 4)}" text-anchor="end">${v}</text>`);
  }
  for (let v = 0; v <= total; v += 32) parts.push(`<text class="wp-tick" x="${f1(x(v))}" y="${CH - CM.bottom + 15}" text-anchor="middle">${v}</text>`);
  if (s.workload === "updates") {
    parts.push(`<line class="wp-phase" x1="${f1(x(KEYS))}" x2="${f1(x(KEYS))}" y1="${CM.top}" y2="${CH - CM.bottom}"/>`);
    parts.push(`<text class="wp-tick" x="${f1(x(KEYS) + 4)}" y="${CM.top + 11}">updates begin</text>`);
  }
  parts.push(
    `<text class="wp-tick" x="${CM.left + pw / 2}" y="${CH - 3}" text-anchor="middle">writes applied</text>`,
    `<line class="wp-axis" x1="${CM.left}" x2="${CM.left}" y1="${CM.top}" y2="${CH - CM.bottom}"/>`,
    `<line class="wp-axis" x1="${CM.left}" x2="${CW - CM.right}" y1="${CH - CM.bottom}" y2="${CH - CM.bottom}"/>`,
  );
  const line = (pick: (h: { ops: number; btreeWritten: number; lsmWritten: number }) => number, cls: string) => {
    const pts = run.history.filter((h) => h.ops > 0).map((h) => `${f1(x(h.ops))} ${f1(y(pick(h) / h.ops))}`);
    return pts.length > 1 ? `<path class="${cls}" d="M${pts.join("L")}"/>` : "";
  };
  parts.push(line((h) => h.btreeWritten, "wp-line-bt"), line((h) => h.lsmWritten, "wp-line-lsm"));
  const label = `Cumulative write amplification after ${run.pos} writes: B-tree ${run.writeAmp("btree").toFixed(1)}, LSM-tree ${run.writeAmp("lsm").toFixed(1)}.`;
  return `<svg class="wp-chart" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

// ---- readout ------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function lookupText(run: Run, key: number): { btree: string; lsm: string } {
  const present = run.live.has(key);
  const bt = `${plural(run.btree.path(key).length, "page")} read`;
  const look = run.lsm.lookup(key);
  if (look.memtable) return { btree: bt, lsm: "found in the memtable, no file read" };
  const checked = look.probes.length;
  const read = look.probes.filter((p) => p.read).length;
  const fp = look.probes.filter((p) => p.read && !p.found).length;
  const lsm = checked === 0 ? "no file covers the key" : `${plural(checked, "filter")} checked, ${plural(read, "file")} read${fp ? ` (${plural(fp, "false positive")})` : ""}`;
  return { btree: bt + (present ? "" : ", key absent"), lsm: lsm + (present ? "" : ", key absent") };
}

export function eventText(run: Run): string {
  if (run.pos === 0) return "No writes applied yet.";
  const keys = run.lastKeys;
  const head = `Last commit: ${keys.length === 1 ? `key ${keys[0]}` : `${keys.length} keys`}.`;
  const bt = `The B-tree logged ${plural(run.btree.lastWritten.size, "page")} (${run.btree.lastWritten.size * PAGE} units for ${keys.length} ${keys.length === 1 ? "record" : "records"}).`;
  const ev = run.lsm.events;
  const lsmParts = [`the LSM-tree logged ${plural(keys.length, "record")}`];
  for (const e of ev) {
    if (e.kind === "flush") lsmParts.push(`flushed the memtable to L0 (${e.written} units)`);
    else if (e.kind === "move") lsmParts.push(`moved a file from L${e.from} to L${e.to} without rewriting it`);
    else lsmParts.push(`merged L${e.from} into L${e.to} (read ${e.read}, wrote ${e.written})`);
  }
  const lsm = lsmParts.join(", ") + ".";
  return `${head} ${bt} ${lsm[0].toUpperCase()}${lsm.slice(1)}`;
}

export function tableHtml(run: Run, key: number): string {
  const look = lookupText(run, key);
  const row = (name: string, wa: number, sa: number, lk: string, cls: string) =>
    `<tr><th scope="row"><span class="wp-swatch ${cls}"></span>${name}</th><td>${run.pos ? wa.toFixed(2) : "–"}</td><td>${run.live.size ? sa.toFixed(2) : "–"}</td><td>${esc(lk)}</td></tr>`;
  return [
    `<table class="wp-table"><thead><tr><th scope="col"></th><th scope="col">write amp.</th><th scope="col">space amp.</th><th scope="col">lookup of key ${key}</th></tr></thead><tbody>`,
    row("B-tree", run.writeAmp("btree"), run.spaceAmp("btree"), look.btree, "wp-sw-bt"),
    row("LSM-tree", run.writeAmp("lsm"), run.spaceAmp("lsm"), look.lsm, "wp-sw-lsm"),
    `</tbody></table>`,
  ].join("");
}

// ---- whole figure ------------------------------------------------------------------

export interface Props {
  workload?: string;
  batch?: number;
  at?: number;
  lookup?: number;
}

export function stateFrom(props: Props): State {
  const workload = (props.workload && props.workload in WORKLOADS ? props.workload : "random") as Workload;
  const batch = BATCHES.includes(Number(props.batch)) ? Number(props.batch) : 1;
  const len = streamLength(workload);
  const at = Number.isFinite(Number(props.at)) ? Math.max(0, Math.min(len, Math.round(Number(props.at)))) : len;
  const key = Number.isFinite(Number(props.lookup)) ? Math.max(0, Math.min(SPACE - 1, Math.round(Number(props.lookup)))) : 37;
  return { workload, batch, at, key };
}

export function render(props: Props): string {
  const s = stateFrom(props);
  const run = replay(s);
  const len = streamLength(s.workload);
  const options = (Object.keys(WORKLOADS) as Workload[]).map((w) => `<option value="${w}"${w === s.workload ? " selected" : ""}>${esc(WORKLOADS[w])}</option>`).join("");
  const batches = BATCHES.map((b) => `<option value="${b}"${b === s.batch ? " selected" : ""}>${b}</option>`).join("");
  return [
    `<figure class="wp" data-state="${esc(JSON.stringify(s))}">`,
    `<form class="wp-controls">`,
    `<label class="wp-select wp-wide"><span>Workload</span><select name="workload" disabled>${options}</select></label>`,
    `<label class="wp-select"><span>Writes per commit</span><select name="batch" disabled>${batches}</select></label>`,
    `<div class="wp-buttons"><button type="button" name="step" disabled>Next commit</button><button type="button" name="reset" disabled>Start over</button></div>`,
    `<label class="wp-slider wp-wide"><span>Writes applied <output name="at-out">${run.pos} of ${len}</output></span><input type="range" name="at" min="0" max="${len}" step="1" value="${run.pos}" disabled></label>`,
    `<label class="wp-slider wp-wide"><span>Look up key <output name="key-out">${s.key}</output></span><input type="range" name="key" min="0" max="${SPACE - 1}" step="1" value="${s.key}" disabled></label>`,
    `</form>`,
    `<p class="wp-event" data-part="event" aria-live="polite">${esc(eventText(run))}</p>`,
    `<div class="wp-head">B-tree: ${PAGE} records per page, log images checkpointed every ${CHECKPOINT_PAGES} pages</div>`,
    `<div class="wp-plot" data-part="btree">${btreeSvg(run, s.key)}</div>`,
    `<div class="wp-head">LSM-tree: ${MEMTABLE}-record memtable and SSTables, L1 holds ${L1_TARGET} records, ${BLOOM_BITS}-bit-per-key Bloom filters</div>`,
    `<div class="wp-plot" data-part="lsm">${lsmSvg(run, s.key)}</div>`,
    `<div class="wp-legend" aria-hidden="true"><span class="wp-key wp-key-new">written by the last commit</span><span class="wp-key wp-key-path">read by the lookup</span><span class="wp-key wp-key-skip">skipped by its Bloom filter</span></div>`,
    `<div data-part="table">${tableHtml(run, s.key)}</div>`,
    `<div class="wp-head">Cumulative write amplification: units written per record written</div>`,
    `<div class="wp-plot" data-part="chart">${chartSvg(run, s)}</div>`,
    `<figcaption>A simulation, run in the page, of the two write paths at toy scale: one unit is one record, a B-tree page costs ${PAGE} units to write however full it is, and an SSTable costs one unit per record. Both engines receive the same writes. Even keys are written; odd keys are never present. The B-tree logs a full image of each page a commit dirties and copies logged pages back at each checkpoint, as SQLite does in WAL mode. The LSM-tree logs each record, flushes the memtable as a sorted file, merges L0 into L1 when ${L0_TRIGGER} files accumulate and merges L1 into L2 when L1 exceeds its target, keeping only the newest version of each key; files that overlap nothing below move down without being rewritten.</figcaption>`,
    `</figure>`,
  ].join("");
}
