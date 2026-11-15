// Checks the figure's allocators against kvsim.py, the separate Python
// implementation whose replays of the Azure LLM inference traces produced the
// note's tables (results.json holds its outputs on the same trace slices).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/ml/serving-systems/memory-management");
const slices = JSON.parse(readFileSync(path.join(dir, "slices.json"), "utf8"));
const results = JSON.parse(readFileSync(path.join(dir, "results.json"), "utf8"));
const model = await load("components/kv-alloc/model.ts");

const CONFIGS = [
  ["max", "max", 16],
  ["double", "double", 16],
  ["paged8", "paged", 8],
  ["paged16", "paged", 16],
  ["paged32", "paged", 32],
];

test("uses the note's model and budget", () => {
  assert.equal(model.KV_BYTES_PER_TOKEN, results.model.kv_bytes_per_token);
  assert.equal(model.BUDGET, results.budget.tokens);
  assert.equal(slices.budget, model.BUDGET);
  assert.equal(slices.max_len, model.config("max").maxLen);
});

test("matches kvsim.py on both trace slices for every allocator", () => {
  for (const trace of ["conv", "code"]) {
    for (const [key, kind, block] of CONFIGS) {
      const py = results.slices[trace][key];
      const s = model.run(slices[trace], model.config(kind, block)).summary;
      const at = `${trace} ${key}`;
      for (const f of ["used", "reserved", "internal", "external", "free", "running"]) assert.ok(Math.abs(s[f] - py[f]) < 1e-9, `${at} ${f}: ${s[f]} vs ${py[f]}`);
      assert.equal(s.steadyIterations, py.steady_iterations, at);
      assert.equal(s.iterations, py.iterations, at);
      assert.equal(s.preemptions, py.preemptions, at);
      assert.equal(s.recomputed, py.recomputed_tokens, at);
      assert.equal(s.copied, py.copied_tokens, at);
      assert.equal(s.peakRunning, py.peak_running, at);
    }
  }
});

test("memory is conserved and the layout agrees with the counts", () => {
  const reqs = slices.conv.slice(0, 600);
  for (const [, kind, block] of CONFIGS) {
    const cfg = model.config(kind, block);
    const sim = new model.Sim(reqs, cfg);
    let checked = 0;
    while (!sim.done) {
      const s = sim.step();
      assert.equal(s.used + s.reserved + s.internal + s.external + s.free, cfg.budget);
      if (kind === "max") assert.ok(s.running <= cfg.budget / cfg.maxLen);
      if (sim.iteration % 37 === 0) {
        const segs = model.layout(sim);
        const tot = { used: 0, reserved: 0, internal: 0 };
        let end = 0;
        for (const g of segs) {
          assert.ok(g.addr >= end, `${kind}: segments overlap at ${g.addr}`);
          end = g.addr + g.size;
          tot[g.cat] += g.size;
        }
        assert.ok(end <= cfg.budget);
        assert.deepEqual(tot, { used: s.used, reserved: s.reserved, internal: s.internal });
        if (kind !== "paged") for (const r of sim.running) assert.equal(r.addr % r.cap, 0, "buddy blocks are aligned to their size");
        checked++;
      }
    }
    assert.ok(checked > 5);
  }
});

test("reserve-max holds exactly budget / max_len requests while the queue is non-empty", () => {
  const { summary } = model.run(slices.code, model.config("max"));
  assert.equal(summary.running, model.BUDGET / 8192);
});

test("the buddy allocator coalesces back to its roots", () => {
  const b = new model.Buddy(4 * 1024, 1024);
  const got = [16, 64, 32, 512, 16, 256, 128].map((s) => [b.alloc(s), s]);
  for (const [a, s] of got) assert.equal(a % s, 0);
  for (const [a, s] of got.reverse()) b.free(a, s);
  assert.equal(b.freeSlots, 4 * 1024);
  assert.equal(b.alloc(1024), 0);
  assert.ok(b.fits(1024));
});

test("renders the default replay, and two copies stay independent", async () => {
  const { render } = await load("components/kv-alloc/render.ts");
  const a = render({ kind: "max", trace: "code", src: "/x/slices.json" });
  const b = render({ kind: "paged", trace: "conv", block: 16 });
  assert.match(a, /^<figure class="kva" data-kind="max" data-trace="code" data-block="16" data-src="\/x\/slices.json">/);
  assert.match(a, /<button type="button" name="kind" value="max" aria-pressed="true" disabled>/);
  assert.match(b, /name="kind" value="paged" aria-pressed="true"/);
  assert.match(a, /56\.0 running on average/);
  assert.equal((a.match(/<polygon class="kva-/g) ?? []).length, 4);
  assert.ok(!/ id="/.test(a + b), "no page-global ids");
  assert.doesNotThrow(() => render({ kind: "nonsense", trace: "?", block: 7 }));
});
