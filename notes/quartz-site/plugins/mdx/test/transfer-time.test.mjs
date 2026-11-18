// Checks the transfer-time model against an independent event-driven
// simulation (performance-lab/model_reference.py), against closed forms in the
// cases that have one, and checks that the figure's data matches the raw runs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/transfer-time/model.ts");
const r = await load("components/transfer-time/render.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const lab = path.join(here, "../../../../content/systems/networks/0-foundation/performance-lab");
const json = (name) => JSON.parse(readFileSync(path.join(lab, name), "utf8"));

test("matches the event-driven reference simulation", () => {
  const cases = json("transfer-time.fixture.json");
  assert.ok(cases.length >= 100);
  for (const c of cases) {
    const p = { rateMbit: c.rate, rttMs: c.rtt };
    const got = m.modelMs(p, c.n, c.w0, c.start);
    assert.ok(Math.abs(got - c.ms) < 1e-6 * Math.max(1, c.ms), `${JSON.stringify(c)} got ${got}`);
  }
});

test("closed forms: one flight, and an open window", () => {
  for (const [rate, rtt] of [[10, 100], [100, 20], [1000, 2]]) {
    const p = { rateMbit: rate, rttMs: rtt };
    for (const n of [1, 500, 1448, 10 * 1448]) {
      // Fits in the initial window: handshake RTT + request d + serialization + d.
      const want = 2 * rtt + m.wireS(m.tcpWireBytes(n), rate) * 1e3;
      assert.ok(Math.abs(m.modelMs(p, n, m.IW, "fresh") - want) < 1e-9, `${rate} ${rtt} ${n}`);
    }
    for (const n of [1000, 1e5, 1e7]) {
      // A window that never binds: one round trip plus serialization of every byte.
      const want = rtt + m.wireS(m.tcpWireBytes(n), rate) * 1e3;
      assert.ok(Math.abs(m.modelMs(p, n, 1e9, "open") - want) < 1e-9, `${rate} ${rtt} ${n}`);
    }
  }
});

test("slow start costs about one round trip per doubling until the pipe is full", () => {
  // A path whose BDP is far above the response: every flight is a separate round trip.
  const p = { rateMbit: 1e5, rttMs: 100 };
  for (const n of [14480, 14481, 43440, 43441, 101360, 101361]) {
    const t = m.modelMs(p, n, m.IW, "open");
    assert.ok(Math.abs(t - p.rttMs * m.flights(n, m.IW)) < 1, `${n}: ${t} vs ${m.flights(n, m.IW)} flights`);
  }
  // Once the window covers the BDP, the remaining time grows as L/R.
  const q = { rateMbit: 10, rttMs: 20 };
  const a = m.modelMs(q, 8e6, m.IW, "fresh");
  const b = m.modelMs(q, 16e6, m.IW, "fresh");
  const slope = (b - a) / (m.wireS(m.tcpWireBytes(16e6) - m.tcpWireBytes(8e6), 10) * 1e3);
  assert.ok(Math.abs(slope - 1) < 1e-6);
});

test("the figure's points are the medians of the raw runs", () => {
  const raw = json("results.json");
  const data = json("transfer-times.json");
  const runs = new Map();
  for (const c of raw.configs)
    for (const t of c.trials) {
      const k = [c.rate_mbit, c.rtt_ms, c.cc, t.mode, t.n].join();
      (runs.get(k) ?? runs.set(k, []).get(k)).push(t.t_s * 1e3);
    }
  assert.equal(data.points.length, runs.size);
  for (const p of data.points) {
    const ts = runs.get([p.rate, p.rtt, p.cc, p.mode, p.n].join()).sort((a, b) => a - b);
    const med = ts.length % 2 ? ts[(ts.length - 1) / 2] : (ts[ts.length / 2 - 1] + ts[ts.length / 2]) / 2;
    assert.ok(Math.abs(med - p.med) < 0.001, JSON.stringify(p));
    assert.ok(Math.abs(ts[0] - p.min) < 0.001 && Math.abs(ts.at(-1) - p.max) < 0.001);
  }
  // Every UDP burst arrived whole.
  for (const c of raw.configs) for (const t of c.trials) if (t.mode === "udp") assert.equal(t.received, t.expected);
});

test("renders a finished figure with disabled controls for every path", () => {
  for (const rate of m.RATES)
    for (const rtt of m.RTTS)
      for (const cc of ["bbr", "cubic"]) {
        const html = r.render({ rate, rtt, cc });
        assert.match(html, /<svg/);
        assert.ok(!html.includes("NaN"), `${rate} ${rtt} ${cc}`);
        for (const tag of html.match(/<(button|input)[^>]*>/g)) assert.match(tag, /disabled/);
      }
});

test("the idle restart window follows tcp_cwnd_restart", () => {
  // Direct transcription of the kernel loop (net/ipv4/tcp_output.c, Linux 6.18),
  // in integer jiffies at HZ=1000:
  //   restart_cwnd = min(restart_cwnd, cwnd);
  //   while ((delta -= icsk_rto) > 0 && cwnd > restart_cwnd) cwnd >>= 1;
  //   snd_cwnd = max(cwnd, restart_cwnd);
  const kernel = (cwnd, rto, delta, iw = 10) => {
    const restart = Math.min(iw, cwnd);
    while ((delta -= rto) > 0 && cwnd > restart) cwnd >>= 1;
    return Math.max(cwnd, restart);
  };
  let seed = 7;
  const rnd = (k) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % k);
  for (let i = 0; i < 2000; i++) {
    const cwnd = 1 + rnd(20000);
    const rto = 200 + rnd(800);
    const idle = rto + 1 + rnd(5000); // the check only runs when idle exceeds one RTO
    assert.equal(m.restartWindow(cwnd, rto, idle, "cubic"), kernel(cwnd, rto, idle), `${cwnd} ${rto} ${idle}`);
    assert.equal(m.restartWindow(cwnd, rto, idle, "bbr"), cwnd);
  }
  assert.equal(m.restartWindow(1184, 336, 1100, "cubic"), 148);
  assert.equal(m.restartWindow(500, 300, 250, "cubic"), 500);
});
