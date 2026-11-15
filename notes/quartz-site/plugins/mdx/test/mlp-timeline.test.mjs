// Checks the MLP timeline's queue simulation against two independent
// references: the closed form L / min(k, C) with Little's law, and a separate
// Python simulator (mlp_queue_reference.py beside the note) on fixed and
// varying latencies. Also checks that the measured points the figure draws
// match the benchmark summary, and that the markup renders.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bench = path.join(here, "../../../../content/systems/operating-systems/benchmarks");
const reference = JSON.parse(readFileSync(path.join(bench, "mlp_queue_reference.json"), "utf8"));
const summary = JSON.parse(readFileSync(path.join(bench, "mlp_bench-summary.json"), "utf8"));
const m = await load("components/mlp-timeline/model.ts");
const r = await load("components/mlp-timeline/render.ts");

const PHI = (Math.sqrt(5) - 1) / 2;
const spread = (i) => 120 + 120 * ((i * PHI) % 1);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("fixed latency matches L / min(k, C) and Little's law", () => {
  for (const latency of [50, 178, 300]) {
    for (const buffers of [4, 10, 16, 24]) {
      for (let chains = 1; chains <= 32; chains++) {
        const res = m.simulate(chains, buffers, latency);
        const want = m.closedForm(chains, buffers, latency);
        const label = `k=${chains} C=${buffers} L=${latency}`;
        // The second-half window can cut a periodic pattern mid-period, so
        // allow one latency spread over the 1,200 completions measured.
        close(res.timePerAccess, want, latency / 1200 + 1e-9, label);
        close(res.inFlight, Math.min(chains, buffers), 0.02 * Math.min(chains, buffers), `${label} in flight`);
        // Little's law: in flight = throughput x latency.
        close(res.inFlight, latency / res.timePerAccess, 0.03 * Math.min(chains, buffers), `${label} Little`);
        // Nobody waits while there are buffers to spare.
        if (chains <= buffers) assert.equal(res.meanWait, 0, label);
        // Past C, each load waits (k - C) / C latencies on average.
        else close(res.meanWait, ((chains - buffers) / buffers) * latency, latency * 0.02, `${label} wait`);
      }
    }
  }
});

test("agrees with the independent Python simulator", () => {
  assert.ok(reference.cases.length >= 20);
  for (const c of reference.cases) {
    const lat = c.latency === "fixed" ? 178 : spread;
    const res = m.simulate(c.chains, c.buffers, lat, 2400);
    const label = `k=${c.chains} C=${c.buffers} ${c.latency}`;
    close(res.timePerAccess, c.time_per_access, 1e-5, label);
    close(res.inFlight, c.in_flight, 1e-5, `${label} in flight`);
    c.first.forEach(([chain, start, end], i) => {
      const got = res.misses[i];
      assert.equal(got.chain, chain, `${label} miss ${i} chain`);
      close(got.start, start, 1e-5, `${label} miss ${i} start`);
      close(got.end, end, 1e-5, `${label} miss ${i} end`);
    });
  }
});

test("each chain has at most one miss outstanding and buffers are never oversubscribed", () => {
  for (const [chains, buffers] of [[5, 16], [16, 16], [23, 10], [32, 4]]) {
    const res = m.simulate(chains, buffers, spread, 1500);
    const events = [];
    const byChain = new Map();
    for (const x of res.misses) {
      events.push([x.start, 1], [x.end, -1]);
      const prev = byChain.get(x.chain);
      if (prev) assert.ok(x.ready >= prev.end - 1e-9, "a chain's next load waits for the previous one");
      assert.ok(x.start >= x.ready - 1e-9);
      byChain.set(x.chain, x);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let open = 0;
    for (const [, d] of events) {
      open += d;
      assert.ok(open <= buffers, `k=${chains} C=${buffers}: ${open} in flight`);
    }
  }
});

test("measured points match the benchmark summary (2 MB pages)", () => {
  const rows = summary["2m"].rows.filter((row) => row.chains > 0);
  assert.equal(m.MEASURED.length, rows.length);
  rows.forEach((row, i) => {
    const p = m.MEASURED[i];
    assert.equal(p.chains, row.chains);
    close(p.median, row.median, 0.051, `median k=${row.chains}`);
    close(p.min, row.min, 0.051, `min k=${row.chains}`);
    close(p.max, row.max, 0.051, `max k=${row.chains}`);
  });
  close(m.DEFAULTS.latency, summary["2m"].latency_ns, 0.5, "default latency is the measured single-chain median");
});

test("renders disabled controls and clamps attributes", () => {
  const html = r.render({ chains: 99, latency: "x", buffers: 2 });
  assert.match(html, /name="chains"[^>]*value="32" disabled/);
  assert.match(html, /name="latency"[^>]*value="50" disabled/);
  assert.match(html, /name="buffers"[^>]*value="4" disabled/);
  assert.equal((html.match(/data-part="/g) ?? []).length, 3);
  const def = r.render();
  assert.match(def, /<output name="chains-out">8<\/output>/);
  assert.ok(!def.includes("NaN"));
});
