// Markup for the TLB reach figure. The build renders the default state in
// full; the client redraws the chart, readout and walk from the same
// functions when the region, page size or load changes.

import { esc } from "../../shared/format";
import {
  clampIndex,
  fmtBytes,
  L1_DTLB_4K,
  loadAddress,
  measuredAt,
  MEASURED,
  PAGE_BYTES,
  PAGE_LABEL,
  PAGE_SIZES,
  pagesCovered,
  SIZES,
  splitAddress,
  STLB_4K,
  tableFootprint,
  tlbLevel4K,
  walkRefs,
  WALK_LEVELS,
  BASE,
  type PageSize,
} from "./model";

export interface State {
  index: number; // into SIZES
  page: PageSize;
  load: number; // which 4 KiB page of the region the walk shows
}

interface Props {
  region?: unknown; // MiB
  page?: unknown;
}

const f = (x: number): string => x.toFixed(1);
const hex = (x: number): string => "0x" + x.toString(16);
const ns = (x: number): string => (x >= 100 ? x.toFixed(0) : x.toFixed(1));

// Chart geometry: ns per load against region size, both log scale. Narrow
// figures (phones) get a taller, narrower viewBox so the text stays legible.
interface Geo {
  W: number;
  H: number;
  M: { left: number; right: number; top: number; bottom: number };
}
const WIDE: Geo = { W: 640, H: 260, M: { left: 50, right: 12, top: 22, bottom: 36 } };
const NARROW: Geo = { W: 400, H: 330, M: { left: 36, right: 10, top: 22, bottom: 36 } };
const Y_LO = 1;
const Y_HI = 400;
const SERIES: Record<PageSize, string> = { "4K": "tr-s4k", "2M": "tr-s2m", "1G": "tr-s1g" };

function xScale(g: Geo, bytes: number): number {
  const lo = Math.log2(SIZES[0]);
  const hi = Math.log2(SIZES[SIZES.length - 1]);
  return g.M.left + 6 + ((Math.log2(bytes) - lo) / (hi - lo)) * (g.W - g.M.left - g.M.right - 12);
}
function yScale(g: Geo, v: number): number {
  const lo = Math.log10(Y_LO);
  const hi = Math.log10(Y_HI);
  const c = Math.log10(Math.min(Y_HI, Math.max(Y_LO, v)));
  return g.M.top + (1 - (c - lo) / (hi - lo)) * (g.H - g.M.top - g.M.bottom);
}

// Region sizes at which a capacity is reached. TLB marks apply to 4 KiB
// pages; data marks use the benchmark's footprint of one 64-byte line per
// 4 KiB of region, against the 48 KiB L1D and 2 MiB L2 of this core.
const MARKS = [
  { bytes: L1_DTLB_4K * 4096, label: "96 × 4 KiB", short: "96", cls: "tr-mark-tlb" },
  { bytes: STLB_4K * 4096, label: "2,048 × 4 KiB", short: "2,048", cls: "tr-mark-tlb" },
  { bytes: 48 * 1024 * 64, label: "lines > L1D", short: "L1D", cls: "tr-mark-data" },
  { bytes: 2 * 1024 * 1024 * 64, label: "lines > L2", short: "L2", cls: "tr-mark-data" },
];

export function chartSvg(s: State, narrow = false): string {
  const g = narrow ? NARROW : WIDE;
  const { W, H, M } = g;
  const x = (b: number) => xScale(g, b);
  const y = (v: number) => yScale(g, v);
  const out: string[] = [
    `<svg viewBox="0 0 ${W} ${H}" class="tr-chart" style="aspect-ratio: ${W} / ${H}" role="img" aria-label="Measured nanoseconds per load against region size for 4 KiB, 2 MiB and 1 GiB pages">`,
  ];
  const yTicks = narrow ? [1, 3, 10, 30, 100, 300] : [1, 2, 5, 10, 20, 50, 100, 200];
  for (const v of yTicks) {
    const yy = f(y(v));
    out.push(`<line class="tr-grid" x1="${M.left}" x2="${W - M.right}" y1="${yy}" y2="${yy}"/>`);
    out.push(`<text class="tr-tick" x="${M.left - 6}" y="${f(y(v) + 4)}" text-anchor="end">${v}</text>`);
  }
  const xTicks = narrow ? [2 ** 15, 2 ** 20, 2 ** 25, 2 ** 30] : [2 ** 15, 2 ** 20, 2 ** 25, 2 ** 30, 2 ** 33];
  for (const b of xTicks) {
    const anchor = narrow && b === 2 ** 15 ? "start" : "middle";
    out.push(`<text class="tr-tick" x="${f(x(b))}" y="${H - M.bottom + 16}" text-anchor="${anchor}">${fmtBytes(b).replace(" ", "\u202f")}</text>`);
  }
  out.push(`<text class="tr-axis" x="${M.left + (W - M.left - M.right) / 2}" y="${H - 3}" text-anchor="middle">region size (one load per 4 KiB)</text>`);
  const ym = M.top + (H - M.top - M.bottom) / 2;
  out.push(`<text class="tr-axis" x="11" y="${f(ym)}" text-anchor="middle" transform="rotate(-90 11 ${f(ym)})">ns per load</text>`);
  MARKS.forEach((m, i) => {
    const xx = f(x(m.bytes));
    out.push(`<line class="tr-mark ${m.cls}" x1="${xx}" x2="${xx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    out.push(`<text class="tr-marklabel ${m.cls}" x="${xx}" y="${M.top - (i % 2 ? 2 : 11)}" text-anchor="middle">${narrow ? m.short : m.label}</text>`);
  });
  const cx = f(x(SIZES[s.index]));
  out.push(`<line class="tr-cursor" x1="${cx}" x2="${cx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  // The selected page size is drawn last, on top of the others.
  const order = [...PAGE_SIZES.filter((p) => p !== s.page), s.page];
  for (const page of order) {
    const pts = MEASURED.filter((p) => p.page === page).sort((a, b) => a.bytes - b.bytes);
    const sel = page === s.page ? " tr-sel" : "";
    out.push(`<g class="tr-series ${SERIES[page]}${sel}">`);
    for (const p of pts) {
      const xx = f(x(p.bytes));
      out.push(`<line class="tr-range" x1="${xx}" x2="${xx}" y1="${f(y(p.min))}" y2="${f(y(p.max))}"/>`);
    }
    out.push(`<polyline points="${pts.map((p) => `${f(x(p.bytes))},${f(y(p.median))}`).join(" ")}"/>`);
    const here = measuredAt(SIZES[s.index], page);
    if (here) out.push(`<circle cx="${cx}" cy="${f(y(here.median))}" r="4"/>`);
    out.push(`</g>`);
  }
  out.push(`</svg>`);
  return out.join("");
}

export function readoutHtml(s: State): string {
  const bytes = SIZES[s.index];
  const loads = bytes / 4096;
  const pages = pagesCovered(bytes, s.page);
  const parts: string[] = [];
  parts.push(`<span><b>${fmtBytes(bytes)}</b>: ${loads.toLocaleString("en-US")} loads, ${fmtBytes(loads * 64)} of cache lines</span>`);
  const where = s.page === "4K" ? `; nominally held in the <b>${tlbLevel4K(pages)}</b>` : "";
  parts.push(`<span>${PAGE_LABEL[s.page]} pages: <b>${pages.toLocaleString("en-US")}</b>${where}</span>`);
  const m = PAGE_SIZES.map((p) => [p, measuredAt(bytes, p)] as const);
  const cells = m
    .filter(([, v]) => v)
    .map(([p, v]) => `${PAGE_LABEL[p]} <b>${ns(v!.median)} ns</b>`)
    .join(", ");
  parts.push(`<span>Measured: ${cells}</span>`);
  const a = measuredAt(bytes, "4K");
  const b = measuredAt(bytes, "2M");
  if (a && b) parts.push(`<span>4 KiB minus 2 MiB: <b>${ns(a.median - b.median)} ns</b> per load</span>`);
  return parts.join("");
}

// Address bar geometry: 48 bits across the viewBox.
export function addressSvg(s: State, narrow = false): string {
  const AW = narrow ? 400 : 640;
  const AH = 64;
  const BIT = (AW - 8) / 48;
  const va = loadAddress(s.load);
  const fields = splitAddress(va, s.page);
  const out: string[] = [
    `<svg viewBox="0 0 ${AW} ${AH}" class="tr-addr" style="aspect-ratio: ${AW} / ${AH}" role="img" aria-label="${esc(`Virtual address ${hex(va)} split into ${fields.map((x) => `${x.name} ${x.value}`).join(", ")}`)}">`,
  ];
  for (const fl of fields) {
    const x0 = 4 + (47 - fl.hi) * BIT;
    const w = (fl.hi - fl.lo + 1) * BIT;
    const cls = fl.name === "offset" ? "tr-f-off" : `tr-f-${fl.name.toLowerCase()}`;
    out.push(`<rect class="tr-field ${cls}" x="${f(x0 + 1)}" y="18" width="${f(w - 2)}" height="24" rx="3"/>`);
    out.push(`<text class="tr-fname" x="${f(x0 + w / 2)}" y="12" text-anchor="middle">${fl.name} ${fl.hi}:${fl.lo}</text>`);
    const val = fl.name === "offset" ? hex(fl.value) : String(fl.value);
    out.push(`<text class="tr-fval" x="${f(x0 + w / 2)}" y="35" text-anchor="middle">${val}</text>`);
  }
  out.push(`<text class="tr-tick" x="4" y="58">47</text><text class="tr-tick" x="${AW - 4}" y="58" text-anchor="end">0</text>`);
  out.push(`</svg>`);
  return out.join("");
}

export function walkHtml(s: State): string {
  const va = loadAddress(s.load);
  const fields = splitAddress(va, s.page);
  const steps = fields
    .filter((x) => x.name !== "offset")
    .map((x) => `${x.name}[${x.value}]`)
    .join(" → ");
  const off = fields[fields.length - 1];
  const n = WALK_LEVELS[s.page];
  const leaf = fields[n - 1].name;
  return `<p class="tr-walk">Load ${(s.load + 1).toLocaleString("en-US")} at <code>${hex(va)}</code>: CR3 → ${steps} → frame + <code>${hex(off.value)}</code></p>` +
    `<p class="tr-walk">A miss reads <b>${n}</b> entries natively (leaf: ${leaf}); in a VM whose host uses four levels, the two-dimensional walk reads up to <b>${walkRefs(n, 4)}</b>.</p>`;
}

export function tableHtml(s: State): string {
  const bytes = SIZES[s.index];
  const rows = tableFootprint(BASE, bytes, s.page)
    .map((r) => `<tr><td>${r.level}</td><td>${r.entries.toLocaleString("en-US")}</td><td>${fmtBytes(r.bytes)}</td></tr>`)
    .join("");
  return `<table class="tr-table"><thead><tr><th>Level</th><th>Entries used</th><th>Entry bytes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function initial(props: Props): State {
  const mib = Number(props.region ?? 64);
  const target = (Number.isFinite(mib) ? mib : 64) * 2 ** 20;
  let best = 0;
  SIZES.forEach((b, i) => {
    if (Math.abs(Math.log2(b / target)) < Math.abs(Math.log2(SIZES[best] / target))) best = i;
  });
  const page = PAGE_SIZES.includes(props.page as PageSize) ? (props.page as PageSize) : "4K";
  return { index: clampIndex(best), page, load: 0 };
}

export function render(props: Props = {}): string {
  const s = initial(props);
  const buttons = PAGE_SIZES.map(
    (p) => `<button type="button" name="page-${p}" aria-pressed="${p === s.page}" disabled>${PAGE_LABEL[p]}</button>`,
  ).join("");
  return `<figure class="tr">
<div class="tr-controls">
<label class="tr-slider"><span>Region <output name="region-out">${fmtBytes(SIZES[s.index])}</output></span><input type="range" name="region" min="0" max="${SIZES.length - 1}" step="1" value="${s.index}" disabled></label>
<div class="tr-pages" role="group" aria-label="Page size">${buttons}</div>
</div>
<p class="tr-label">Measured ns per load against region size (log scales); bars are the range over five runs</p>
<div class="tr-plot" data-part="chart">${chartSvg(s)}</div>
<p class="tr-key"><span><i class="tr-key-4k"></i>4 KiB pages</span><span><i class="tr-key-2m"></i>2 MiB pages</span><span><i class="tr-key-1g"></i>1 GiB pages (to 2 GiB)</span></p>
<p class="tr-readout" data-part="readout" aria-live="polite">${readoutHtml(s)}</p>
<div class="tr-walkbox">
<div class="tr-walkhead"><span class="tr-label">Page walk for one of the benchmark's loads</span><button type="button" name="next" disabled>Next load</button></div>
<div class="tr-plot" data-part="addr">${addressSvg(s)}</div>
<div data-part="walk">${walkHtml(s)}</div>
<div data-part="table">${tableHtml(s)}</div>
</div>
<figcaption>The chart replays tlb_sweep.c on a 4-vCPU KVM guest (Emerald Rapids): a random cyclic pointer chase with one load per 4 KiB of the region, each region backed by 4 KiB pages, 2 MiB transparent huge pages or 1 GiB hugetlbfs pages. TLB marks use 96 L1 DTLB and 2,048 second-level entries for 4 KiB pages. The walk splits the address of a load in the benchmark's layout (base ${hex(BASE)}) into the indices the page walker uses, and the table counts the page-table entries the whole region uses at each level.</figcaption>
</figure>`;
}
