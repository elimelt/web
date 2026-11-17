// The TLB reach figure's model, free of the DOM: the x86-64 four-level page
// walk applied to real address bits, the page-table footprint of a region,
// the two-dimensional walk length in a virtual machine, and the measured
// sweep that the chart replays.

import { MEASURED, type Point } from "./measured";
export { MEASURED, type Point };

export type PageSize = "4K" | "2M" | "1G";
export const PAGE_SIZES: readonly PageSize[] = ["4K", "2M", "1G"];
export const PAGE_BYTES: Record<PageSize, number> = { "4K": 4096, "2M": 2 ** 21, "1G": 2 ** 30 };
export const PAGE_LABEL: Record<PageSize, string> = { "4K": "4 KiB", "2M": "2 MiB", "1G": "1 GiB" };

// Levels of the walk, root first. A 2 MiB page is mapped by a PD entry and a
// 1 GiB page by a PDPT entry, so those walks stop one and two levels early.
export const LEVELS = ["PML4", "PDPT", "PD", "PT"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_SHIFT: Record<Level, number> = { PML4: 39, PDPT: 30, PD: 21, PT: 12 };
export const WALK_LEVELS: Record<PageSize, number> = { "4K": 4, "2M": 3, "1G": 2 };
export const OFFSET_BITS: Record<PageSize, number> = { "4K": 12, "2M": 21, "1G": 30 };

export interface Field {
  name: Level | "offset";
  hi: number; // highest bit, inclusive
  lo: number;
  value: number;
}

/** Splits a 48-bit virtual address into the indices a walk for this page size uses. */
export function splitAddress(va: number, page: PageSize): Field[] {
  const out: Field[] = [];
  const n = WALK_LEVELS[page];
  for (let i = 0; i < n; i++) {
    const level = LEVELS[i];
    const lo = LEVEL_SHIFT[level];
    out.push({ name: level, hi: lo + 8, lo, value: Math.floor(va / 2 ** lo) % 512 });
  }
  const ob = OFFSET_BITS[page];
  out.push({ name: "offset", hi: ob - 1, lo: 0, value: va % 2 ** ob });
  return out;
}

/** Memory references for a TLB miss: n native, or n*m + n + m for an n-level guest walk on an m-level host (Bhargava et al. 2008). */
export function walkRefs(guestLevels: number, hostLevels = 0): number {
  return hostLevels === 0 ? guestLevels : guestLevels * hostLevels + guestLevels + hostLevels;
}

export interface TableLevel {
  level: Level;
  entries: number; // entries in use at this level
  tables: number; // 4 KiB tables holding them
  bytes: number;
}

/**
 * The page-table entries a region of `bytes` starting at `base` uses, level by
 * level, for one page size. Each level counts the distinct entries that map
 * the region; tables are 512 entries of 8 bytes.
 */
export function tableFootprint(base: number, bytes: number, page: PageSize): TableLevel[] {
  const out: TableLevel[] = [];
  const end = base + bytes - 1;
  for (let i = 0; i < WALK_LEVELS[page]; i++) {
    const level = LEVELS[i];
    const span = 2 ** LEVEL_SHIFT[level];
    const first = Math.floor(base / span);
    const last = Math.floor(end / span);
    const entries = last - first + 1;
    const tables = Math.floor(last / 512) - Math.floor(first / 512) + 1;
    out.push({ level, entries, tables, bytes: entries * 8 });
  }
  return out;
}

/** Pages of this size that a region covers when it starts on a page boundary. */
export function pagesCovered(bytes: number, page: PageSize): number {
  return Math.ceil(bytes / PAGE_BYTES[page]);
}

// Nominal Golden Cove data-TLB capacities for 4 KiB pages: 96 L1 DTLB entries
// (AnandTech) and a 2,048-entry second-level TLB (AnandTech's inference; Intel
// did not state it). The sweep's knees fall between 90 and 128 pages and
// between 2,048 and 2,896 pages, consistent with both.
export const L1_DTLB_4K = 96;
export const STLB_4K = 2048;

export type Holder = "L1 DTLB" | "STLB" | "page walk";
export function tlbLevel4K(pages: number): Holder {
  return pages <= L1_DTLB_4K ? "L1 DTLB" : pages <= STLB_4K ? "STLB" : "page walk";
}

// The benchmark's layout: one load per 4 KiB of the region, at a hashed
// cache-line offset within it (tlb_sweep.c, function off()).
export function lineOffset(page4k: number): number {
  const h = (BigInt(page4k) * 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
  return Number(h >> 58n) * 64;
}

// A user-space base address, 1 GiB aligned, of the kind mmap returns on
// x86-64 Linux; the region's walk indices follow from it.
export const BASE = 0x7f2a40000000;

/** The address of the benchmark's load in 4 KiB page `k` of the region. */
export function loadAddress(k: number): number {
  return BASE + k * 4096 + lineOffset(k);
}

/** Region sizes in the sweep, ascending. */
export const SIZES: number[] = [...new Set(MEASURED.map((p) => p.bytes))].sort((a, b) => a - b);

export function measuredAt(bytes: number, page: PageSize): Point | undefined {
  return MEASURED.find((p) => p.bytes === bytes && p.page === page);
}

export function fmtBytes(b: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let v = b;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  const s = v >= 100 || Number.isInteger(v) ? Math.round(v).toString() : v.toFixed(1);
  return `${s} ${units[u]}`;
}

export function clampIndex(i: number): number {
  return Math.max(0, Math.min(SIZES.length - 1, Math.round(Number.isFinite(i) ? i : 0)));
}
