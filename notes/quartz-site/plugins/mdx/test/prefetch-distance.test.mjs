// Checks the prefetch distance figure against the benchmark's own outputs:
// every point it draws must match prefetch_bench-summary.json, the latency it
// uses must match the MLP benchmark's single-chain median on the same VM, and
// the derived numbers in the readout (speedup, lead time, Little's law, the
// Mowry distance) are recomputed here from the JSON, not from the figure's data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bench = path.join(here, "../../../../content/systems/operating-systems/benchmarks");
const summary = JSON.parse(readFileSync(path.join(bench, "prefetch_bench-summary.json"), "utf8")).pages;
const mlp = JSON.parse(readFileSync(path.join(bench, "mlp_bench-summary.json"), "utf8"));
const m = await load("components/prefetch-distance/model.ts");
const r = await load("components/prefetch-distance/render.ts");

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const key = (w, d, h) => (d === 0 ? `g:${w}:0:3` : `g:${w}:${d}:${h}`);

test("every drawn point matches the benchmark summary", () => {
  let n = 0;
  for (const pages of ["2m", "4k"]) {
    for (const w of [0, 4, 16, 64]) {
      const set = m.DATA[pages][w];
      close(set.hot, summary[pages][`hot:${w}`].median, 0.006, `hot ${pages} W=${w}`);
      assert.deepEqual(set.curves.map((c) => c.hint), w === 0 ? [3, 2, 1, 0] : [3]);
      for (const c of set.curves) {
        for (const [d, med, lo, hi] of c.rows) {
          const s = summary[pages][key(w, d, c.hint)];
          assert.ok(s, `missing ${key(w, d, c.hint)}`);
          assert.equal(s.n, 12);
          close(med, s.median, 0.006, `${pages} ${key(w, d, c.hint)} median`);
          close(lo, s.min, 0.006, `${pages} ${key(w, d, c.hint)} min`);
          close(hi, s.max, 0.006, `${pages} ${key(w, d, c.hint)} max`);
          assert.ok(lo <= med && med <= hi);
          n++;
        }
      }
    }
  }
  assert.ok(n >= 140, `${n} points`);
});

test("latency is the MLP benchmark's single-chain median on the same VM", () => {
  close(m.LATENCY["2m"], mlp["2m"].latency_ns, 0.05, "2m");
  close(m.LATENCY["4k"], mlp["4k"].latency_ns, 0.05, "4k");
});

test("derived readout numbers match a recomputation from the JSON", () => {
  for (const pages of ["2m", "4k"]) {
    const L = mlp[pages].latency_ns;
    for (const w of [0, 4, 16, 64]) {
      const hints = w === 0 ? [3, 2, 1, 0] : [3];
      const p = m.preset({ pages, work: w, hints: hints.join(",") });
      const c = summary[pages][`hot:${w}`].median;
      assert.equal(m.mowry(p), Math.ceil(m.LATENCY[pages] / Number(c.toFixed(2))));
      close(m.mowry(p), L / c, 1.5, "Mowry distance");
      for (const h of hints) {
        const base = summary[pages][key(w, 0, h)].median;
        for (const d of m.distances({ ...p, hints: [h] })) {
          const t = summary[pages][key(w, d, h)].median;
          const x = m.derive(p, h, d);
          close(x.speedup, base / t, 0.002 * (base / t), `speedup ${pages} W=${w} D=${d} h=${h}`);
          close(x.lead, d * t, 0.006 * d + 1e-9, `lead ${pages} W=${w} D=${d}`);
          close(x.inFlight, L / t, 0.01 * (L / t), `in flight ${pages} W=${w} D=${d}`);
        }
        // best() is the true minimum over D > 0.
        const ds = m.distances({ ...p, hints: [h] }).filter((d) => d > 0);
        const want = Math.min(...ds.map((d) => summary[pages][key(w, d, h)].median));
        close(m.best(p, h)[1], want, 0.006, `best ${pages} W=${w} h=${h}`);
      }
    }
  }
});

test("presets clamp bad attributes and render without NaN", () => {
  assert.deepEqual(m.preset({ work: "7", pages: "1g", hints: "9" }), { pages: "2m", work: 16, hints: [3] });
  assert.deepEqual(m.preset({ work: "0", hints: "3,2,2,0,5" }).hints, [3, 2, 0]);
  // Hints other than t0 were swept only with W = 0.
  assert.deepEqual(m.preset({ work: "16", hints: "3,2" }).hints, [3]);
  for (const pages of ["2m", "4k"]) {
    for (const work of [0, 4, 16, 64]) {
      const hints = work === 0 ? "3,2,1,0" : "3";
      const p = m.preset({ pages, work, hints });
      for (const d of m.distances(p)) {
        const html = r.render({ pages, work, hints, distance: d });
        assert.ok(!html.includes("NaN") && !html.includes("undefined") && !html.includes("Infinity"), `${pages} W=${work} D=${d}`);
        assert.match(html, /name="d"[^>]*disabled/);
        assert.match(html, new RegExp(`value="${m.distances(p).indexOf(d)}" disabled`));
      }
    }
  }
  // Default distance is the measured best for the primary hint.
  const p = m.preset({ work: 16 });
  assert.match(r.render({ work: 16 }), new RegExp(`<output name="d-out">${m.best(p, 3)[0]}</output>`));
});

test("chart x positions increase with distance and stay inside the plot", () => {
  const xs = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 4096].map(r.xPos);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1]);
  assert.ok(xs[0] > 0 && xs[xs.length - 1] < r.W);
});
