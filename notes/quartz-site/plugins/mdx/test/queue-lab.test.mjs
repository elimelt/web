// Checks that the queue-lab simulator computes what the figure says it does:
// its results must match the exact M/M/1, M/M/c and M/G/1 formulas, obey
// Little's law, and agree with queue_experiments.py, a separate Python
// implementation, on the policies that have no formula.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "queue-lab-"));
after(() => rmSync(dir, { recursive: true, force: true }));

async function load(entry) {
  const outfile = path.join(dir, `${path.basename(entry, ".ts")}.mjs`);
  await esbuild.build({ entryPoints: [path.join(here, "../src/components/queue-lab", entry)], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

const m = await load("model.ts");
const r = await load("render.ts");

const close = (got, want, rel, what) => assert.ok(Math.abs(got - want) <= rel * Math.abs(want), `${what}: got ${got}, want ${want} within ${rel * 100}%`);

/** Average of a statistic over several long runs. */
function measure(config, jobs, seeds = 4) {
  const acc = { mean: 0, p50: 0, p99: 0, p999: 0 };
  for (let s = 0; s < seeds; s++) {
    const st = m.stats(m.responses(config, jobs, 500 + s)).stats;
    for (const k in acc) acc[k] += st[k] / seeds;
  }
  return acc;
}

test("Erlang C matches hand-computed values", () => {
  close(m.erlangC(1, 0.7), 0.7, 1e-12, "one server waits with probability rho");
  close(m.erlangC(2, 1), 1 / 3, 1e-12, "two servers, offered load 1");
  // c = 3, a = 2: P0 = 1/9, C = (a^c / c!) * (c / (c - a)) * P0 = 4/9.
  close(m.erlangC(3, 2), 4 / 9, 1e-12, "three servers, offered load 2");
});

test("the M/M/c response-time distribution reduces to M/M/1 and is a proper tail", () => {
  for (const rho of [0.3, 0.8, 0.95]) close(m.mmcQuantile(0.99, 1, rho), Math.log(100) / (1 - rho), 1e-6, `M/M/1 p99 at ${rho}`);
  for (const c of [2, 16]) {
    close(m.mmcCcdf(0, c, 0.9), 1, 1e-12, "P(R > 0)");
    let prev = 1;
    for (let t = 0.5; t < 30; t += 0.5) {
      const p = m.mmcCcdf(t, c, 0.9);
      assert.ok(p <= prev + 1e-15 && p >= 0, `tail is nonincreasing at t=${t}`);
      prev = p;
    }
    // Integrating the tail gives the mean.
    let integral = 0;
    for (let t = 0; t < 200; t += 0.001) integral += 0.001 * m.mmcCcdf(t + 0.0005, c, 0.9);
    close(integral, m.mmcMean(c, 0.9), 1e-4, `mean from the tail, c=${c}`);
  }
});

test("one exponential server matches M/M/1 at several loads", () => {
  for (const rho of [0.5, 0.8, 0.9]) {
    const got = measure({ servers: 1, rho, dist: "exp", policy: "shared" }, 600_000);
    close(got.mean, 1 / (1 - rho), 0.04, `mean at ${rho}`);
    close(got.p99, Math.log(100) / (1 - rho), 0.05, `p99 at ${rho}`);
  }
});

test("a shared queue over 16 exponential servers matches M/M/16", () => {
  const config = { servers: 16, rho: 0.9, dist: "exp", policy: "shared" };
  const got = measure(config, 600_000);
  close(got.mean, m.mmcMean(16, 0.9), 0.02, "mean");
  close(got.p99, m.mmcQuantile(0.99, 16, 0.9), 0.03, "p99");
  // The fraction of jobs that wait is Erlang C.
  const sim = new m.Simulator(config, 9);
  let waited = 0;
  const n = 400_000;
  for (let k = 0; k < n; k++) {
    const j = sim.next();
    if (k >= n / 10 && j.start > j.arrival) waited++;
  }
  close(waited / (0.9 * n), m.erlangC(16, 14.4), 0.03, "probability of waiting");
});

test("random dispatch turns c servers into c independent M/M/1 queues", () => {
  const got = measure({ servers: 8, rho: 0.8, dist: "exp", policy: "random" }, 600_000);
  close(got.mean, 5, 0.04, "mean");
  close(got.p99, Math.log(100) / 0.2, 0.05, "p99");
});

test("constant and bimodal service match Pollaczek-Khinchine", () => {
  for (const [dist, rho, tol] of [["det", 0.9, 0.03], ["det", 0.5, 0.01], ["bimodal", 0.7, 0.06]]) {
    const got = measure({ servers: 1, rho, dist, policy: "shared" }, 1_000_000);
    close(got.mean, m.pkMean(rho, dist), tol, `${dist} at ${rho}`);
  }
  close(m.secondMoment("bimodal") - 1, 7.7, 0.01, "bimodal squared coefficient of variation");
});

test("every job takes at least its own size, and Little's law holds", () => {
  for (const policy of ["shared", "random", "rr", "jsq2", "jsq"]) {
    const config = { servers: 4, rho: 0.85, dist: "bimodal", policy };
    const sim = new m.Simulator(config, 3);
    const jobs = [];
    for (let k = 0; k < 200_000; k++) jobs.push(sim.next());
    for (const j of jobs) assert.ok(j.finish - j.arrival >= j.size - 1e-9 && j.start >= j.arrival);
    // Time-average number in system over a window equals arrival rate times
    // mean response time of the jobs that arrive in it (edge effects aside).
    const t0 = jobs[20_000].arrival;
    const t1 = jobs[180_000].arrival;
    let area = 0;
    let sum = 0;
    let count = 0;
    for (const j of jobs) {
      area += Math.max(0, Math.min(j.finish, t1) - Math.max(j.arrival, t0));
      if (j.arrival >= t0 && j.arrival < t1) {
        sum += j.finish - j.arrival;
        count++;
      }
    }
    close(area / (t1 - t0), (count / (t1 - t0)) * (sum / count), 0.02, `Little's law, ${policy}`);
  }
});

test("agrees with the independent Python simulator on policies with no formula", () => {
  const file = path.join(here, "../../../../content/systems/scheduling/0-foundations/queueing-lab/queue_experiments_results.json");
  const results = JSON.parse(readFileSync(file, "utf8"));
  for (const row of results.dispatch) {
    if (row.rho !== 0.9 || row.dist !== "exp" || !["rr", "jsq2", "jsq"].includes(row.policy)) continue;
    const got = measure({ servers: 16, rho: 0.9, dist: "exp", policy: row.policy }, 500_000);
    close(got.mean, row.sim.mean.mean, 0.03, `${row.policy} mean`);
    close(got.p99, row.sim.p99.mean, 0.04, `${row.policy} p99`);
  }
});

test("renders a complete figure with no missing numbers", () => {
  for (const props of [{}, { servers: 16, policy: "random", dist: "bimodal", rho: 0.9 }]) {
    const html = r.render(props);
    assert.ok(html.startsWith('<figure class="ql"'));
    assert.ok(!/NaN|undefined/.test(html), "no NaN or undefined in the markup");
    assert.equal((html.match(/class="ql-pt /g) ?? []).length, 2 * m.SWEEP_RHOS.length, "a mean and a p99 point per load");
  }
});
