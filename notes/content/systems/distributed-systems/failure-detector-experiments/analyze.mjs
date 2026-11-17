// Replays the recorded heartbeat traces through the figure's detector model
// (plugins/mdx/src/components/phi-detector/model.ts) and writes results.json
// and the figure's data file.
// Usage (from notes/quartz-site/plugins/mdx, after npm install):
//   node ../../../content/systems/distributed-systems/failure-detector-experiments/analyze.mjs TRACEDIR
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const plugin = path.resolve(here, "../../../../quartz-site/plugins/mdx");
const out = path.join(here, ".model.mjs");
const esbuild = createRequire(path.join(plugin, "package.json"))("esbuild");
await esbuild.build({ entryPoints: [path.join(plugin, "src/components/phi-detector/model.ts")], outfile: out, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
const M = await import(pathToFileURL(out).href);
const dir = process.argv[2];
const CHURN = [180_000, 420_000];
const JUDGE = 1000;

function load(file) {
  const rows = readFileSync(file, "utf8").trim().split("\n").slice(1).map((l) => l.split(",").map(Number));
  return {
    seq: rows.map((r) => r[0]),
    sent: Float64Array.from(rows.map((r) => r[1] / 1e6)),
    arrivals: Float64Array.from(rows.map((r) => r[2] / 1e6)),
  };
}

const pct = (xs, q) => {
  const s = Float64Array.from(xs).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// mistakes per hour at a given mean timeout, by log-log interpolation on a curve
function atDetection(curve, target) {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1].q, b = curve[i].q;
    if ((a.detection - target) * (b.detection - target) <= 0) {
      const f = (Math.log(target) - Math.log(a.detection)) / (Math.log(b.detection) - Math.log(a.detection));
      return { mph: a.mistakesPerHour + f * (b.mistakesPerHour - a.mistakesPerHour), threshold: curve[i - 1].threshold + f * (curve[i].threshold - curve[i - 1].threshold) };
    }
  }
  return null;
}

const results = { runs: [] };
for (const seed of [1, 2, 3]) {
  const t = load(path.join(dir, `run${seed}.csv`));
  const a = t.arrivals;
  const t0 = a[0];
  const ivs = [], ivIdle = [], ivGc = [], delay = [], late = [];
  for (let k = 1; k < a.length; k++) {
    const d = a[k] - a[k - 1];
    ivs.push(d);
    const rel = a[k - 1] - t0;
    (rel >= CHURN[0] && rel < CHURN[1] ? ivGc : ivIdle).push(d);
  }
  const sent0 = t.sent[0];
  for (let k = 0; k < a.length; k++) {
    delay.push(a[k] - t.sent[k]);
    late.push(t.sent[k] - sent0 - t.seq[k] * 100); // lateness relative to the schedule (relative to heartbeat 0)
  }
  const lost = t.seq[t.seq.length - 1] + 1 - t.seq.length;
  const run = {
    seed,
    heartbeats: a.length,
    lost,
    minutes: (a[a.length - 1] - t0) / 60000,
    interval: {
      idle: { mean: ivIdle.reduce((x, y) => x + y, 0) / ivIdle.length, p50: pct(ivIdle, 0.5), p99: pct(ivIdle, 0.99), p999: pct(ivIdle, 0.999), max: Math.max(...ivIdle) },
      gc: { mean: ivGc.reduce((x, y) => x + y, 0) / ivGc.length, p50: pct(ivGc, 0.5), p90: pct(ivGc, 0.9), p99: pct(ivGc, 0.99), max: Math.max(...ivGc), over150: ivGc.filter((x) => x > 150).length },
    },
    transit: { p50: pct(delay, 0.5), p99: pct(delay, 0.99), max: Math.max(...delay) },
    lateness: { p99: pct(late, 0.99), max: Math.max(...late) },
    windows: {},
  };
  for (const w of [100, 1000]) {
    const stats = M.windowStats(a, w);
    const res = {};
    for (const kind of M.KINDS) {
      const thr = kind === "timeout" ? [150, 200, 300, 400, 500, 700, 1000, 2000] : [1, 2, 3, 5, 8, 12, 16];
      const pts = {};
      for (const th of thr) {
        const tau = M.timeouts(kind, th, stats, JUDGE);
        const q = M.quality(a, tau, JUDGE);
        let gc = 0;
        for (let k = JUDGE; k < a.length - 1; k++) if (a[k + 1] - a[k] > tau[k - JUDGE] && a[k] - t0 >= CHURN[0] && a[k] - t0 < CHURN[1]) gc++;
        // mistakes in the first minute after the workload starts and after it stops
        let onset = 0, after = 0;
        for (let k = JUDGE; k < a.length - 1; k++) {
          if (a[k + 1] - a[k] <= tau[k - JUDGE]) continue;
          const rel = a[k] - t0;
          if (rel >= CHURN[0] && rel < CHURN[0] + 60000) onset++;
          if (rel >= CHURN[1]) after++;
        }
        pts[th] = { ...q, gcPhase: gc, firstMinuteOfWorkload: onset, afterWorkload: after };
      }
      const curve = M.curve(kind, a, stats, JUDGE, M.grid(kind, 100));
      const at = {};
      for (const target of [200, 300, 500, 1000]) at[target] = atDetection(curve, target);
      res[kind] = { points: pts, atDetection: at };
      if (kind === "timeout") break;
    }
    run.windows[w] = res;
  }
  // timeout reached by phi-normal at threshold 8 in the idle phase vs the gc phase (window 1000)
  const stats = M.windowStats(a, 1000);
  const tau8 = M.timeouts("phiNormal", 8, stats, JUDGE);
  const tauIdle = [], tauGc = [];
  for (let k = JUDGE; k < a.length - 1; k++) {
    const rel = a[k] - t0;
    (rel >= CHURN[0] + 60000 && rel < CHURN[1] ? tauGc : rel < CHURN[0] ? tauIdle : []).push(tau8[k - JUDGE]);
  }
  run.phiNormal8Tau = { idleMedian: pct(tauIdle, 0.5), gcMedian: pct(tauGc, 0.5), gcMax: Math.max(...tauGc) };
  results.runs.push(run);
}
results.meta = { churn: CHURN, judgeFrom: JUDGE, node: process.version };
writeFileSync(path.join(here, "results.json"), JSON.stringify(results, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v), 1));

// The figure replays run 1: inter-arrival intervals as uint16 in units of 0.1 ms.
const fig = load(path.join(dir, "run1.csv")).arrivals;
const buf = Buffer.alloc((fig.length - 1) * 2);
for (let k = 1; k < fig.length; k++) {
  const v = Math.round((fig[k] - fig[k - 1]) * 10);
  if (v > 65535) throw new Error(`interval ${v / 10} ms does not fit`);
  buf.writeUInt16LE(v, (k - 1) * 2);
}
const ts = `// Generated by content/systems/distributed-systems/failure-detector-experiments/analyze.mjs
// from run 1 of the recorded heartbeat traces. Do not edit.
export const TRACE = {
  intervals: "${buf.toString("base64")}",
  unit: 0.1,
  period: 100,
  churn: [${CHURN[0]}, ${CHURN[1]}] as [number, number],
  judgeFrom: ${JUDGE},
  caption: "Recorded data: ${fig.length} heartbeats sent every 100 ms over UDP by a JVM (OpenJDK 21, Parallel GC, 2 GB heap) to a receiver on the same 4-vCPU cloud VM; an allocation workload in the sender's JVM ran from minute 3 to minute 7.",
};
`;
writeFileSync(path.join(plugin, "src/components/phi-detector/data.ts"), ts);
console.log(JSON.stringify(results.runs.map((r) => ({ seed: r.seed, n: r.heartbeats, lost: r.lost, iv: r.interval, transit: r.transit, tau8: r.phiNormal8Tau })), null, 1));
