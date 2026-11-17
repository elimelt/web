// Checks the bandwidth sweep figure against the benchmark's own outputs: every
// point it draws must match bandwidth_bench-summary.json, the per-level
// plateaus it reports must match the ones analyze_bandwidth_bench.py computes
// (a separate implementation of the same level rule), and the write-allocate
// and Little's law numbers in the readout are recomputed here from the JSON.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bench = path.join(here, "../../../../content/systems/operating-systems/benchmarks");
const summary = JSON.parse(readFileSync(path.join(bench, "bandwidth_bench-summary.json"), "utf8"));
// Single-chain pointer-chase samples (block,config,accesses,ns) from the same VM.
const latSamples = readFileSync(path.join(bench, "bandwidth_bench-latency.txt"), "utf8")
  .split("\n")
  .filter((l) => /^\d+,1,/.test(l))
  .map((l) => Number(l.split(",")[3]))
  .sort((a, b) => a - b);
const latency = latSamples[(latSamples.length - 1) / 2];
const m = await load("components/bandwidth-sweep/model.ts");
const r = await load("components/bandwidth-sweep/render.ts");

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const KERNELS = ["read", "copy", "triad", "copy-nt", "triad-nt"];

test("every drawn point matches the benchmark summary", () => {
  const cells = new Map(summary.cells.map((c) => [`${c.kernel}/${c.threads}/${c.nominal_bytes}`, c]));
  let n = 0;
  for (const k of KERNELS) {
    for (const t of [1, 2, 3, 4]) {
      const pts = m.series(k, t);
      assert.equal(pts.length, 37, `${k}/${t} sizes`);
      for (const [bytes, med, lo, hi] of pts) {
        const c = cells.get(`${k}/${t}/${bytes}`);
        assert.ok(c, `missing ${k}/${t}/${bytes}`);
        assert.equal(c.runs, 5);
        close(med, c.median_gbs, 0.006, `${k}/${t}/${bytes} median`);
        close(lo, c.min_gbs, 0.006, `${k}/${t}/${bytes} min`);
        close(hi, c.max_gbs, 0.006, `${k}/${t}/${bytes} max`);
        assert.ok(lo <= med && med <= hi);
        n++;
      }
    }
  }
  assert.equal(n, summary.cells.length);
});

test("plateaus match the Python analysis", () => {
  for (const k of KERNELS) {
    for (const t of [1, 2, 3, 4]) {
      for (const lv of m.LEVELS) {
        const ref = summary.plateaus[`${k}/${t}/${lv}`];
        assert.ok(ref, `no reference for ${k}/${t}/${lv}`);
        close(m.plateau(k, t, lv), ref.median_gbs, 0.006, `${k}/${t}/${lv}`);
      }
    }
  }
});

test("level bounds stay inside the capacities the figure marks", () => {
  for (const t of [1, 2, 3, 4]) {
    const [l1, l2, l3] = m.capacities(t).map((c) => c.bytes);
    for (let e = 10; e <= 33; e += 0.25) {
      const ws = Math.round(2 ** e);
      const lv = m.level(t, ws);
      if (lv === "L1") assert.ok(ws < l1);
      if (lv === "L2") assert.ok(ws > l1 && ws < l2);
      if (lv === "L3") assert.ok(ws > l2 && ws < l3);
      if (lv === "DRAM") assert.ok(ws >= 4 * l3 * 0.98);
    }
  }
});

test("every level's plateau is below the one above it, for read", () => {
  for (const t of [1, 2, 3, 4]) {
    const v = m.LEVELS.map((lv) => m.plateau("read", t, lv));
    for (let i = 1; i < v.length; i++) assert.ok(v[i] < v[i - 1], `read/${t}: ${v}`);
  }
});

test("write-allocate factors and bus bandwidth match the Python analysis", () => {
  assert.equal(m.busFactor("copy"), 1.5);
  assert.equal(m.busFactor("triad"), 4 / 3);
  for (const k of ["read", "copy-nt", "triad-nt"]) assert.equal(m.busFactor(k), 1);
  for (const k of KERNELS) assert.equal(m.busFactor(k), summary.bus_factor[k]);
  for (const k of KERNELS) {
    for (const t of [1, 2, 3, 4]) {
      // The figure's DRAM plateau is the median of per-size medians; the
      // Python table pools every process. Both must agree to within the spread.
      const d = summary.dram[`${k}/${t}`];
      const mine = m.plateau(k, t, "DRAM", true);
      assert.ok(mine >= d.min_gbs * m.busFactor(k) - 0.01 && mine <= d.max_gbs * m.busFactor(k) + 0.01, `${k}/${t}`);
    }
  }
});

test("latency is the median of the pointer-chase runs on the same VM", () => {
  assert.equal(latSamples.length, 15);
  close(m.LATENCY_NS, latency, 0.05, "latency");
});

test("readout recomputes Little's law and the write-allocate total", () => {
  const p = m.preset({ kernels: "read", threads: 1 });
  const d1 = summary.plateaus["read/1/DRAM"].median_gbs;
  const html = r.readoutHtml(p, 1, false);
  const inflight = Math.round((d1 * m.LATENCY_NS) / 64);
  close((d1 * latency) / 64, inflight, 0.6, "lines in flight from the raw latency");
  assert.match(html, new RegExp(`<b>${inflight}</b> lines in flight`));
  const q = m.preset({ kernels: "copy,copy-nt", threads: 1 });
  const copy = summary.plateaus["copy/1/DRAM"].median_gbs;
  assert.match(r.readoutHtml(q, 1, true), new RegExp(`<b>${(copy * 1.5).toFixed(1)} GB/s</b>`));
  assert.match(r.readoutHtml(q, 1, false), new RegExp(`<b>${copy.toFixed(1)} GB/s</b>`));
});

test("build-time markup is complete, disabled, and safe to place twice", () => {
  const a = r.render({ kernels: "read" });
  const b = r.render({ kernels: "copy,copy-nt", bus: "false" });
  for (const html of [a, b]) {
    assert.ok(!/\sid="/.test(html), "no page-global ids");
    for (const tag of html.match(/<(button|input)\b[^>]*>/g) ?? []) assert.match(tag, /disabled/);
    assert.match(html, /<svg[^>]*class="bw-chart"/);
    assert.ok(!html.includes("NaN"));
  }
  assert.ok(!a.includes('name="bus"'), "no write-allocate box for read");
  assert.ok(b.includes('name="bus"'));
  assert.deepEqual(m.preset({ kernels: "bogus" }).kernels, ["read"]);
  assert.equal(m.preset({ threads: 9 }).threads, 1);
});
