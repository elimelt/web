// The pruning figure's model against an independent numpy implementation
// (content/ml/serving-systems/sparsity-and-pruning/figure_check.py, which
// calls prune.py, the code that prunes the whole model), on the same real
// layer data, plus structural properties of the masks.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.join(here, "../../../../content/ml/serving-systems");
const layer = JSON.parse(readFileSync(path.join(content, "quantization/outlier-layer.json"), "utf8"));
const pdata = JSON.parse(readFileSync(path.join(content, "sparsity-and-pruning/prune-layer.json"), "utf8"));
const expected = JSON.parse(readFileSync(path.join(content, "sparsity-and-pruning/figure-check.json"), "utf8")).cases;
const m = await load("components/prune-lab/model.ts");
const render = await load("components/prune-lab/render.ts");
const L = m.loadLayer(layer, pdata);

test("loads the layer and the pruning statistics", () => {
  assert.equal(L.N, 2048);
  assert.equal(L.rms.length, 2048);
  assert.equal(m.loudest(L), 888);
  assert.equal(L.grid.length, pdata.layer_threshold.wanda.length);
});

test("matches the numpy reference on every checked setting", () => {
  for (const c of expected) {
    const set = { method: c.method, group: c.group, pattern: c.pattern, level: c.level };
    const r = m.prune(L, set);
    const label = JSON.stringify(set);
    assert.ok(Math.abs(r.relErr - c.relErr) <= 1e-9 * Math.max(1, c.relErr), `${label}: relErr ${r.relErr} vs ${c.relErr}`);
    assert.ok(Math.abs(r.sparsity - c.sparsity) < 1e-12, `${label}: sparsity ${r.sparsity} vs ${c.sparsity}`);
    assert.equal(Math.round(r.keptByChannel[888] * L.C), c.kept888, `${label}: channel 888`);
  }
});

test("n:m masks keep exactly n of every m consecutive inputs per output", () => {
  for (const [pattern, mm] of [["2:4", 4], ["4:8", 8]]) {
    for (const method of ["magnitude", "wanda"]) {
      const keep = m.mask(L, { method, group: "output", pattern, level: 10 });
      for (let c = 0; c < L.C; c++)
        for (let j0 = 0; j0 < L.N; j0 += mm) {
          let k = 0;
          for (let i = 0; i < mm; i++) k += keep[(j0 + i) * L.C + c];
          assert.equal(k, mm / 2);
        }
    }
  }
});

test("per-output masks remove the same count from every column", () => {
  for (const level of [3, 10, 17]) {
    const keep = m.mask(L, { method: "wanda", group: "output", pattern: "unstructured", level });
    const k = Math.floor(L.N * L.grid[level]);
    for (let c = 0; c < L.C; c++) {
      let removed = 0;
      for (let j = 0; j < L.N; j++) removed += 1 - keep[j * L.C + c];
      assert.equal(removed, k);
    }
  }
});

test("magnitude keeps the most weight norm; Wanda gives the smaller output error", () => {
  // Magnitude pruning per output is the mask that minimizes ||W - Wp|| for a
  // given count, so it can never remove more norm than Wanda's mask.
  for (const level of [4, 10, 16]) {
    const mag = m.prune(L, { method: "magnitude", group: "output", pattern: "unstructured", level });
    const wan = m.prune(L, { method: "wanda", group: "output", pattern: "unstructured", level });
    assert.ok(mag.normRemoved <= wan.normRemoved + 1e-12);
    assert.ok(wan.relErr < mag.relErr);
  }
});

test("renders the default state with disabled controls", () => {
  const html = render.render({ src: "/x/outlier-layer.json" });
  assert.match(html, /<figure class="pl" data-src="\/x\/outlier-layer.json">/);
  assert.match(html, /name="level"[^>]*disabled/);
  assert.match(html, /channel 888/);
  assert.equal((html.match(/class="pl-chip"/g) || []).length, L.T);
});
