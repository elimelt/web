// Checks the disk-queue simulation against independent references: the
// closed-form service time of one random request (OSTEP's 13.2 ms for the
// Barracuda), the mean of the seek curve over uniform track pairs, Little's
// law, and a separate Python implementation of the same disk and policies
// (content/systems/operating-systems/lecture-notes/io-experiments/disk_sched_ref.py,
// output saved in disk-queue.fixture.json).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/disk-queue/model.ts");
const r = await load("components/disk-queue/render.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(path.join(here, "disk-queue.fixture.json"), "utf8"));
const D = m.BARRACUDA;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a / b - 1) <= tol, `${msg}: ${a.toFixed(3)} vs ${b.toFixed(3)}`);

test("the seek curve averages 9 ms over uniform random pairs of tracks", () => {
  const N = 2000;
  let sum = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) sum += m.seekMs(D, (i + 0.5) / N, (j + 0.5) / N);
  close(sum / (N * N), D.avgSeekMs, 0.002, "mean seek");
  assert.equal(m.seekMs(D, 0.3, 0.3), 0);
  close(m.seekMs(D, 0, 1), m.fullSeekMs(D), 1e-12, "full stroke");
});

test("at queue depth 1 every policy serves the same requests in 13.2 ms each", () => {
  const e = m.expectedQd1Ms(D);
  close(e.total, 13.2, 0.01, "OSTEP's Barracuda T_I/O");
  const runs = m.POLICIES.map((p) => m.simulate({ policy: p, qd: 1, n: 40000, seed: 3 }));
  for (const x of runs.slice(1)) assert.deepEqual(x.served.map((s) => s.id), runs[0].served.map((s) => s.id));
  const a = runs[0];
  close(a.meanSeek, e.seek, 0.02, "mean seek");
  close(a.meanRot, e.rot, 0.02, "mean rotational wait");
  close(a.meanService, e.total, 0.015, "mean service");
  close(a.iops, 1000 / e.total, 0.015, "IOPS");
});

test("Little's law holds for every policy and depth", () => {
  for (const p of m.POLICIES)
    for (const q of m.QDS) {
      const x = m.simulate({ policy: p, qd: q, n: 4000, seed: 7 });
      close((x.iops * x.meanResponse) / 1000, q, 0.02, `${p} qd ${q}`);
    }
});

test("throughput matches the independent Python implementation within 3%", () => {
  for (const p of Object.keys(ref))
    for (const q of Object.keys(ref[p])) {
      const x = m.simulate({ policy: p, qd: Number(q), n: 40000, seed: 5 });
      close(x.iops, ref[p][q].iops, 0.03, `${p} qd ${q} IOPS`);
      close(x.meanSeek + x.meanRot, ref[p][q].pos, 0.03, `${p} qd ${q} positioning`);
    }
});

test("policy properties: FCFS keeps arrival order, C-LOOK sweeps inward, SPTF positions fastest", () => {
  const f = m.simulate({ policy: "fcfs", qd: 16, n: 2000, seed: 2 });
  for (let i = 1; i < f.served.length; i++) assert.ok(f.served[i].id > f.served[i - 1].id);
  const c = m.simulate({ policy: "clook", qd: 16, n: 4000, seed: 2 });
  let wraps = 0;
  for (let i = 1; i < c.served.length; i++) if (c.served[i].r < c.served[i - 1].r) wraps++;
  // A sweep serves many requests before it wraps back to the outer edge.
  assert.ok(wraps < c.served.length / 8, `C-LOOK wrapped ${wraps} times`);
  for (const q of [4, 16, 64]) {
    const pos = Object.fromEntries(m.POLICIES.map((p) => {
      const x = m.simulate({ policy: p, qd: q, n: 4000, seed: 9 });
      return [p, x.meanSeek + x.meanRot];
    }));
    assert.ok(pos.sptf < pos.sstf && pos.sptf < pos.clook && pos.sstf < pos.fcfs && pos.clook < pos.fcfs, JSON.stringify(pos));
  }
});

test("the figure renders every preset with disabled controls and a finite chart", () => {
  for (const p of m.POLICIES)
    for (const q of m.QDS) {
      const html = r.render({ policy: p, qd: q });
      assert.match(html, /<figure class="dq"/);
      assert.match(html, /disabled/);
      assert.doesNotMatch(html, /NaN|Infinity|undefined/);
    }
  assert.ok(r.doneInWindow("sptf", 32) > r.doneInWindow("fcfs", 32));
  assert.deepEqual(r.parseProps({ policy: "bogus", qd: 3 }), { policy: "fcfs", qd: 1 });
});
