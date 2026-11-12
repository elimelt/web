// Checks the in-browser page replacement policies against pagesim.c, which
// computed the fault counts the figure plots and the note's tables.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const traces = path.join(here, "../../../../content/systems/operating-systems/lecture-notes/page-fault-experiments/traces");
const dir = mkdtempSync(path.join(tmpdir(), "page-replacement-"));
after(() => rmSync(dir, { recursive: true, force: true }));

async function load(entry) {
  const outfile = path.join(dir, `${path.basename(entry, ".ts")}.mjs`);
  await esbuild.build({ entryPoints: [path.join(here, "../src/components/page-replacement", entry)], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

const model = await load("model.ts");
const trace = (key) => {
  const buf = gunzipSync(readFileSync(path.join(traces, `${key}.u16.gz`)));
  return new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
};

test("reproduces Belady's anomaly on the textbook string", () => {
  const next = model.nextUses(model.BELADY);
  const faults = (p, f) => model.run(model.BELADY, next, p, f).faults;
  assert.equal(faults("fifo", 3), 9);
  assert.equal(faults("fifo", 4), 10);
  assert.equal(faults("lru", 3), 10);
  assert.equal(faults("lru", 4), 8);
  assert.equal(faults("opt", 3), 7);
  assert.equal(faults("opt", 4), 6);
});

test("matches pagesim.c's fault counts on every trace window", () => {
  for (const [key, info] of Object.entries(model.windows)) {
    const t = trace(key);
    assert.equal(t.length, info.refs);
    assert.equal(new Set(t).size, info.pages);
    const next = model.nextUses(t);
    const frames = [1, 2, 5, 13, Math.ceil(info.pages / 3), Math.ceil(info.pages / 2), info.pages - 1].filter((f) => f >= 1);
    for (const p of model.POLICIES) {
      for (const f of frames) assert.equal(model.run(t, next, p, f).faults, info.curves[p][f - 1], `${key} ${p} ${f} frames`);
    }
  }
});

test("each eviction follows its policy's rule", () => {
  const t = trace("bzip2").subarray(0, 60000);
  const next = model.nextUses(t);
  for (const policy of ["fifo", "lru", "opt"]) {
    const F = 9;
    const sim = model.makeSim(policy, F, next);
    const loaded = new Map();
    const lastUse = new Map();
    const nextUse = new Map();
    let evictions = 0;
    for (let i = 0; i < t.length; i++) {
      const s = sim.step(i, t[i]);
      if (s.victim >= 0) {
        evictions++;
        const resident = [...loaded.keys()];
        assert.ok(resident.includes(s.victim));
        if (policy === "fifo") assert.equal(Math.min(...resident.map((p) => loaded.get(p))), loaded.get(s.victim));
        if (policy === "lru") assert.equal(Math.min(...resident.map((p) => lastUse.get(p))), lastUse.get(s.victim));
        if (policy === "opt") assert.equal(Math.max(...resident.map((p) => nextUse.get(p))), nextUse.get(s.victim));
        if (policy !== "opt") assert.equal(s.victimTime, (policy === "fifo" ? loaded : lastUse).get(s.victim));
        loaded.delete(s.victim);
      }
      if (!s.hit) loaded.set(t[i], i);
      lastUse.set(t[i], i);
      nextUse.set(t[i], next[i]);
      assert.ok(loaded.size <= F);
      assert.deepEqual(new Set(sim.order()), new Set(loaded.keys()));
    }
    assert.ok(evictions > 1000, `${policy}: ${evictions} evictions`);
  }
});

test("renders the curves and marks every anomaly", async () => {
  const { render } = await load("render.ts");
  const html = render({ base: "/x/" });
  assert.match(html, /^<figure class="pr" data-trace="gzip9" data-base="\/x\/">/);
  assert.equal((html.match(/<polyline class="pr-line/g) ?? []).length, 4);
  const w = model.windows.gzip9;
  const rings = model.anomalies(w.curves.fifo).length + model.anomalies(w.curves.clock).length;
  assert.equal((html.match(/<circle class="pr-anomaly/g) ?? []).length, rings);
});
