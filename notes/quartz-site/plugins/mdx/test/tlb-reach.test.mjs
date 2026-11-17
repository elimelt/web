// Checks the TLB reach figure against independent references: BigInt bit
// masks for the address split, brute-force enumeration of page-table entries
// for the footprint, an explicit reference trace of the two-dimensional walk,
// line offsets printed by the C benchmark's own off(), and the benchmark
// summary for the measured points.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bench = path.join(here, "../../../../content/systems/operating-systems/benchmarks");
const summary = JSON.parse(readFileSync(path.join(bench, "tlb-summary.json"), "utf8"));
const m = await load("components/tlb-reach/model.ts");
const r = await load("components/tlb-reach/render.ts");

test("address split matches BigInt masks for every page size", () => {
  const shifts = { PML4: 39n, PDPT: 30n, PD: 21n, PT: 12n };
  for (let k = 0; k < 5000; k += 37) {
    const va = m.loadAddress(k * 97);
    const big = BigInt(va);
    for (const page of ["4K", "2M", "1G"]) {
      const fields = m.splitAddress(va, page);
      const ob = BigInt(m.OFFSET_BITS[page]);
      for (const f of fields) {
        const want = f.name === "offset" ? big & ((1n << ob) - 1n) : (big >> shifts[f.name]) & 511n;
        assert.equal(BigInt(f.value), want, `${page} ${f.name} of ${va.toString(16)}`);
      }
      // The fields tile bits 47..0 with no gap or overlap.
      let next = 47;
      for (const f of fields) {
        assert.equal(f.hi, next, `${page} ${f.name} starts at bit ${next}`);
        next = f.lo - 1;
      }
      assert.equal(next, -1);
    }
  }
});

test("page-table footprint matches brute-force enumeration", () => {
  const span = { PML4: 2 ** 39, PDPT: 2 ** 30, PD: 2 ** 21, PT: 2 ** 12 };
  const cases = [
    [m.BASE, 4096],
    [m.BASE, 3 * 2 ** 20 + 4096],
    [m.BASE + 5 * 4096, 2 ** 22],
    [m.BASE - 2 ** 21, 2 ** 31 + 2 ** 21], // crosses a PDPT boundary
    [0x7fffc0000000 - 2 ** 22, 2 ** 23], // crosses a PML4 boundary
  ];
  for (const [base, bytes] of cases) {
    for (const page of ["4K", "2M", "1G"]) {
      const got = m.tableFootprint(base, bytes, page);
      assert.equal(got.length, m.WALK_LEVELS[page]);
      for (const row of got) {
        const entries = new Set();
        const tables = new Set();
        for (let a = base; a < base + bytes; a += 4096) {
          const e = Math.floor(a / span[row.level]);
          entries.add(e);
          tables.add(Math.floor(e / 512));
        }
        assert.equal(row.entries, entries.size, `${page} ${row.level} entries for ${bytes} at ${base.toString(16)}`);
        assert.equal(row.tables, tables.size, `${page} ${row.level} tables`);
        assert.equal(row.bytes, entries.size * 8);
      }
    }
  }
});

test("two-dimensional walk length matches an explicit reference trace", () => {
  // Each guest level's table address is a guest-physical address, so it needs
  // an m-reference host walk before the guest entry can be read; the final
  // guest-physical address needs one more host walk.
  const trace = (n, mm) => {
    const refs = [];
    for (let g = 0; g < n; g++) {
      for (let h = 0; h < mm; h++) refs.push(`host${h} for guest${g}`);
      refs.push(`guest${g}`);
    }
    for (let h = 0; h < mm; h++) refs.push(`host${h} for data`);
    return refs.length;
  };
  for (let n = 1; n <= 5; n++) {
    assert.equal(m.walkRefs(n), n);
    for (let mm = 1; mm <= 5; mm++) assert.equal(m.walkRefs(n, mm), trace(n, mm), `n=${n} m=${mm}`);
  }
  assert.equal(m.walkRefs(4, 4), 24); // Bhargava et al.'s figure for four-level tables on both sides
});

test("line offsets match the C benchmark", () => {
  // Printed by tlb_sweep.c's off() compiled with gcc.
  const want = [[0, 0], [1, 2496], [2, 960], [3, 3456], [63, 3776], [64, 2240], [1000, 128], [262143, 1152], [2097151, 2432]];
  for (const [k, o] of want) assert.equal(m.lineOffset(k), o, `page ${k}`);
});

test("TLB level boundaries for 4 KiB pages", () => {
  assert.equal(m.tlbLevel4K(96), "L1 DTLB");
  assert.equal(m.tlbLevel4K(97), "STLB");
  assert.equal(m.tlbLevel4K(2048), "STLB");
  assert.equal(m.tlbLevel4K(2049), "page walk");
});

test("measured points match the benchmark summary", () => {
  assert.equal(m.MEASURED.length, summary.sweep.length);
  for (const s of summary.sweep) {
    const p = m.MEASURED.find((q) => q.page === s.page && q.bytes === s.region_bytes);
    assert.ok(p, `${s.page} ${s.region_bytes}`);
    assert.equal(p.median, s.median);
    assert.equal(p.min, s.min);
    assert.equal(p.max, s.max);
    assert.ok(s.n >= 5, `${s.page} ${s.region_bytes} has ${s.n} runs`);
  }
});

test("markup renders every part and survives bad props", () => {
  for (const props of [{}, { region: 8, page: "2M" }, { region: "x", page: "nope" }, { region: 1e9 }]) {
    const html = r.render(props);
    for (const part of ["chart", "readout", "addr", "walk", "table"]) assert.ok(html.includes(`data-part="${part}"`), part);
    assert.ok(!html.includes("NaN") && !html.includes("undefined"), JSON.stringify(props));
  }
  for (let i = 0; i < m.SIZES.length; i++) {
    for (const page of ["4K", "2M", "1G"]) {
      const s = { index: i, page, load: m.SIZES[i] / 4096 - 1 };
      const html = r.chartSvg(s) + r.chartSvg(s, true) + r.readoutHtml(s) + r.addressSvg(s) + r.addressSvg(s, true) + r.walkHtml(s) + r.tableHtml(s);
      assert.ok(!html.includes("NaN") && !html.includes("undefined"), `${i} ${page}`);
    }
  }
});
