// Checks the overload-lab simulator against closed forms that do not depend on
// it: the M/M/1 processor-sharing mean response time, and the blocking
// probability of the birth-death chain that a capped processor-sharing
// server forms (M/M/c/K). Also checks conservation and the qualitative
// claims the note makes from the simulation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/overload-lab/model.ts");
const r = await load("components/overload-lab/render.ts");
const measured = await load("components/overload-lab/measured.ts");

const close = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, want ${want} ± ${tol}`);

/** Blocking probability of M/M/c/K: birth rate lambda, death rate mu*min(n, c). */
function mmcK(lambda, mu, c, K) {
  const p = [1];
  for (let n = 1; n <= K; n++) p.push((p[n - 1] * lambda) / (mu * Math.min(n, c)));
  const z = p.reduce((a, b) => a + b, 0);
  return p[K] / z;
}

const base = { ...m.DEFAULTS, deadline: 1e9, duration: 400, bucket: 10 };

test("one core with no admission control is M/M/1-PS: mean response s/(1 - rho)", () => {
  for (const rho of [0.5, 0.8]) {
    const s = 0.001;
    const res = m.simulate({ ...base, policy: "none", cores: 1, meanService: s, rate: rho / s }, 3);
    close(res.meanLatency, s / (1 - rho), 0.06 * (s / (1 - rho)), `rho ${rho}`);
  }
});

test("a fixed limit on a processor-sharing server blocks like M/M/c/K", () => {
  const s = m.DEFAULTS.meanService;
  for (const [cores, K, rho] of [
    [1, 4, 0.9],
    [2, 16, 0.95],
    [2, 8, 1.3],
  ]) {
    const lambda = (rho * cores) / s;
    const res = m.simulate({ ...base, policy: "fixed", cores, fixedLimit: K, rate: lambda }, 5);
    const want = mmcK(lambda, 1 / s, cores, K);
    close(res.shed / res.offered, want, 0.01, `c=${cores} K=${K} rho=${rho}`);
  }
});

test("a count-bounded queue in front of 4 workers on 2 cores blocks like M/M/2/(4+Q)", () => {
  const s = m.DEFAULTS.meanService;
  const lambda = 1.1 * (2 / s);
  const res = m.simulate({ ...base, policy: "queue", queueLimit: 6, rate: lambda }, 7);
  close(res.shed / res.offered, mmcK(lambda, 1 / s, 2, 10), 0.01, "Q=6");
});

test("work is conserved: completions equal admitted callers when nothing times out", () => {
  const res = m.simulate({ ...base, policy: "codel", rate: 1500 }, 2);
  close(res.completions, res.goodput, 0.01 * res.goodput, "completions vs goodput");
  close(res.goodput + res.shed + res.timedOut, res.offered, 1e-9, "every caller accounted for");
});

test("past saturation, goodput collapses without admission control and holds with shedding", () => {
  const cap = 2 / m.DEFAULTS.meanService;
  const none = m.simulate({ ...m.DEFAULTS, policy: "none", rate: 1.7 * cap, duration: 20 }, 1);
  const codel = m.simulate({ ...m.DEFAULTS, policy: "codel", rate: 1.7 * cap, duration: 20 }, 1);
  const queue = m.simulate({ ...m.DEFAULTS, policy: "queue", rate: 1.7 * cap, duration: 20 }, 1);
  assert.ok(none.goodput < 0.05 * cap, `none ${none.goodput}`);
  assert.ok(queue.goodput < 0.05 * cap, `count-bounded queue ${queue.goodput}`);
  assert.ok(codel.goodput > 0.95 * cap, `codel ${codel.goodput}`);
  assert.ok(none.wasted > 0.9, `none wastes ${none.wasted}`);
});

test("immediate retries multiply attempts by up to retries + 1 when every attempt fails", () => {
  const cap = 2 / m.DEFAULTS.meanService;
  const res = m.simulate({ ...m.DEFAULTS, policy: "none", rate: 1.5 * cap, retries: 2 }, 1);
  close(res.attempts / res.offered, 3, 0.1, "attempts per caller");
});

test("arrivals follow the stepped rate during and after a spike", () => {
  const p = { ...m.DEFAULTS, policy: "codel", rate: 1000, duration: 40, bucket: 1, spikeAt: 10, spikeFor: 10, spikeRate: 3000 };
  const res = m.simulate(p, 4);
  const inSpike = res.series.slice(10, 20).reduce((a, b) => a + b.attempts, 0) / 10;
  const outside = res.series.slice(25, 39).reduce((a, b) => a + b.attempts, 0) / 14;
  close(inSpike / ((1 + 0) * 3000), 1, 0.15, "attempts per second during the spike, before retries");
  close(outside, 1000, 40, "attempts per second after the spike");
});

test("with retries, a spike leaves the server without admission control stuck after the load returns; shedding recovers", () => {
  const spike = { spikeAt: 4, spikeFor: 2, spikeRate: 3500 };
  const tail = (policy, retries) => {
    const res = m.simulate({ ...m.DEFAULTS, policy, rate: 1400, retries, duration: 16, bucket: 1, ...spike }, 1);
    const xs = res.series.slice(9, 15);
    return { good: xs.reduce((a, b) => a + b.goodput, 0) / xs.length, att: xs.reduce((a, b) => a + b.attempts, 0) / xs.length };
  };
  const stuck = tail("none", 2);
  assert.ok(stuck.good < 70, `none with retries: goodput ${stuck.good}`);
  close(stuck.att / 1400, 3, 0.15, "every caller uses all three attempts");
  for (const policy of ["fixed", "codel", "gradient"]) {
    const t = tail(policy, 2);
    assert.ok(t.good > 0.95 * 1400, `${policy}: goodput ${t.good}`);
  }
});

test("the simulation reproduces the Go server's measured goodput within 7% of capacity at every point", () => {
  const cap = 2 / m.DEFAULTS.meanService;
  const median3 = (a) => [...a].sort((x, y) => x - y)[1];
  for (const policy of m.POLICY_KEYS) {
    for (const rate of measured.MEASURED.rates) {
      const want = median3(measured.MEASURED.policies[policy][String(rate)].goodput);
      const got = m.simulate({ ...m.DEFAULTS, policy, rate }, 1).goodput;
      close(got, want, 0.07 * cap, `${policy} at ${rate}/s`);
    }
  }
});

test("the simulation is deterministic per seed", () => {
  const a = m.simulate({ ...m.DEFAULTS, policy: "gradient", rate: 2400 }, 9);
  const b = m.simulate({ ...m.DEFAULTS, policy: "gradient", rate: 2400 }, 9);
  assert.deepEqual(a, b);
});

test("render produces a complete figure with disabled controls", () => {
  const html = r.render({});
  assert.match(html, /<figure class="ovl"/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /NaN|undefined/);
});
