// Checks that the window-sim model obeys the rules it claims (the sender never
// exceeds the advertised window, the receiver never overflows its buffer, data
// arrives complete and in order) and that its throughput, probe timing and
// silly-window behavior match the figure's text.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "window-sim-"));
after(() => rmSync(dir, { recursive: true, force: true }));

async function load(entry) {
  const outfile = path.join(dir, `${path.basename(entry, ".ts")}.mjs`);
  await esbuild.build({ entryPoints: [path.join(here, "../src/components/window-sim", entry)], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

const model = await load("model.ts");
const state = await load("state.ts");
const render = await load("render.ts");
const { simulate, summarize, MSS } = model;

const base = { rateMbps: 100, rttMs: 40, bufBytes: 64 * 1024, readBps: Infinity, readChunk: 1460, stall: null, sws: true, loseFirstUpdate: false, durationMs: 1000, drops: [] };

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("random runs keep every invariant", () => {
  const r = rng(7);
  const pick = (a) => a[Math.floor(r() * a.length)];
  for (let i = 0; i < 150; i++) {
    const durationMs = pick([100, 300, 1000]);
    const p = {
      rateMbps: pick(state.RATES), rttMs: pick(state.RTTS), bufBytes: pick(state.BUFS) * 1024,
      readBps: pick(state.READS), readChunk: pick(state.CHUNKS),
      stall: r() < 0.3 ? [durationMs / 3, (2 * durationMs) / 3] : null,
      sws: r() < 0.5, loseFirstUpdate: r() < 0.2, durationMs,
      drops: r() < 0.4 ? [Math.floor(r() * 50), Math.floor(r() * 200)] : [],
    };
    const res = simulate(p);
    const label = JSON.stringify(p);
    assert.deepEqual(res.violations, [], label);
    assert.ok(res.maxBuffered <= p.bufBytes, label);
    for (const s of res.snd) assert.ok(s.inFlight <= s.window, `${label} in flight ${s.inFlight} > window ${s.window}`);
    let prev = { read: 0, rcvNxt: 0, right: 0 };
    for (const s of res.rcv) {
      assert.ok(s.read >= prev.read && s.rcvNxt >= prev.rcvNxt && s.right >= prev.right, `${label} went backwards`);
      assert.ok(s.read <= s.rcvNxt, label);
      prev = s;
    }
  }
});

test("throughput matches min(link, window / RTT) for a fast reader", () => {
  for (const [buf, rtt, rate] of [[64, 40, 100], [16, 10, 100], [512, 40, 100], [256, 100, 20], [1024, 200, 50]]) {
    const r = simulate({ ...base, bufBytes: buf * 1024, rttMs: rtt, rateMbps: rate, durationMs: Math.max(1000, 30 * rtt) });
    const s = summarize(r);
    const err = Math.abs(s.goodputMbps - s.predicted.mbps) / s.predicted.mbps;
    assert.ok(err < 0.03, `buf ${buf} KiB rtt ${rtt} rate ${rate}: ${s.goodputMbps} vs ${s.predicted.mbps}`);
  }
});

test("a slow reader sets the rate once the buffer fills", () => {
  const r = simulate({ ...base, bufBytes: 256 * 1024, readBps: 1e6, readChunk: 16384, durationMs: 2000 });
  const s = summarize(r);
  assert.equal(s.predicted.limit, "reader");
  assert.ok(Math.abs(s.goodputMbps - 8) / 8 < 0.03, String(s.goodputMbps));
});

test("zero-window probes back off by doubling", () => {
  const r = simulate({ ...base, stall: [200, 8000], durationMs: 9000 });
  assert.ok(r.probes.length >= 4, String(r.probes));
  const gaps = r.probes.slice(1).map((t, i) => t - r.probes[i]);
  for (let i = 1; i < gaps.length; i++) assert.ok(Math.abs(gaps[i] / gaps[i - 1] - 2) < 0.01, String(gaps));
  // The first probe waits one retransmission timeout (at least 200 ms) after
  // the window closed (to less than a segment, which the sender won't send).
  const closed = r.acks.find((a) => a.right - a.ack < MSS && a.t > 200).t;
  assert.ok(r.probes[0] - closed >= 199.9, `${r.probes[0]} vs ${closed}`);
});

test("a window update restarts the flow at once; losing it waits for a probe", () => {
  const stall = [1000, 2000];
  const ok = simulate({ ...base, stall, durationMs: 3000 });
  const firstAfter = (r) => r.txs.find((t) => t.kind === "new" && t.t >= stall[1]).t;
  assert.ok(firstAfter(ok) - stall[1] <= base.rttMs / 2 + 1, String(firstAfter(ok)));
  const lost = simulate({ ...base, stall, durationMs: 5000, loseFirstUpdate: true });
  const resume = firstAfter(lost);
  const probe = lost.probes.find((t) => t >= stall[1]);
  assert.ok(probe !== undefined && resume > probe, `resume ${resume}, probe ${probe}`);
  assert.ok(resume - stall[1] > 4 * base.rttMs, String(resume));
});

test("silly window avoidance keeps segments full", () => {
  const p = { ...base, bufBytes: 8192, readBps: 10e3, readChunk: 200, durationMs: 3000 };
  const off = summarize(simulate({ ...p, sws: false }));
  const on = simulate({ ...p, sws: true });
  assert.ok(off.meanSegment < 300, String(off.meanSegment));
  for (const t of on.txs) if (t.kind === "new" && t.t > 0) assert.ok(t.len >= Math.min(MSS, 8192 / 2), `segment of ${t.len} bytes`);
  // Both deliver what the reader asks for; only the packet count differs.
  assert.ok(Math.abs(summarize(on).goodputMbps - off.goodputMbps) / off.goodputMbps < 0.05);
});

test("a lost segment is retransmitted and everything arrives in order", () => {
  const r = simulate({ ...base, bufBytes: 512 * 1024, durationMs: 300, drops: [400] });
  assert.equal(r.retransmits, 1);
  assert.equal(r.fastRetransmits, 1);
  const lost = r.txs.find((t) => t.lost);
  const rtx = r.txs.find((t) => t.kind === "rtx");
  assert.equal(rtx.seq, lost.seq);
  const last = r.rcv[r.rcv.length - 1];
  assert.ok(last.read > lost.seq + lost.len);
  // While the hole is open, data above it occupies the buffer and the right edge stalls.
  assert.ok(r.maxBuffered > 100 * 1024, String(r.maxBuffered));
});

test("presets do what their notes say", () => {
  const run = (id) => {
    const r = simulate(state.toParams(state.presetById(id).state));
    return { r, s: summarize(r) };
  };
  assert.ok(Math.abs(run("small").s.goodputMbps - 13.1) < 0.5);
  assert.equal(run("full").s.predicted.limit, "link");
  const pause = run("pause").r;
  assert.ok(pause.probes.length >= 2 && pause.updates.length === 1 && !pause.updates[0].lost);
  const lu = run("lost-update").r;
  assert.ok(lu.updates[0].lost && lu.probes.some((t) => t > 5000 / 3 * 2));
  assert.ok(run("silly").s.meanSegment < 300);
  assert.equal(run("loss").r.retransmits, 1);
});

test("the figure renders and two copies on a page use different clip ids", () => {
  const a = render.render({ preset: "pause" });
  const b = render.render({ preset: "pause" });
  const id = (html) => html.match(/clipPath id="([^"]+)"/)[1];
  assert.notEqual(id(a), id(b));
  assert.match(a, /<figure class="ws"/);
  assert.ok(!a.includes("NaN"));
});
