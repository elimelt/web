// Checks the timeline figure's schedules against policies.py, a separate
// Python implementation of the same policies that the note's experiment uses
// (fixtures written by policy-experiments/make_fixtures.py), and checks the
// exchange argument the figure's swap view demonstrates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(path.join(here, "../../../../content/systems/scheduling/1-single-resource/policy-experiments/timeline_fixtures.json"), "utf8"),
);
const model = await load("components/schedule-timeline/model.ts");
const view = await load("components/schedule-timeline/render.ts");

const close = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);

test("every policy matches policies.py on 300 random job sets", () => {
  let checked = 0;
  for (const c of fixtures) {
    const params = { quantum: c.quantum, q0: c.q0, levels: c.levels, boost: c.boost };
    for (const [policy, want] of Object.entries(c.done)) {
      const got = model.simulate(policy, c.jobs, params).done;
      assert.ok(close(got, want), `${policy} ${JSON.stringify(c.jobs)} ${JSON.stringify(params)}: ${got} vs ${want}`);
      checked++;
    }
  }
  assert.equal(checked, fixtures.length * 6);
});

test("pieces account for exactly each job's size, and never overlap beyond the server", () => {
  for (const c of fixtures.slice(0, 120)) {
    const params = { quantum: c.quantum, q0: c.q0, levels: c.levels, boost: c.boost };
    for (const policy of ["fifo", "sjf", "srpt", "ps", "rr", "mlfq"]) {
      const s = model.simulate(policy, c.jobs, params);
      const work = c.jobs.map(() => 0);
      for (const p of s.pieces) {
        work[p.job] += (p.end - p.start) / p.lanes;
        assert.ok(p.start >= c.jobs[p.job].arrival - 1e-9, `${policy} runs ${p.job} before it arrives`);
        assert.ok(p.end <= s.done[p.job] + 1e-9);
      }
      c.jobs.forEach((j, i) => assert.ok(Math.abs(work[i] - j.size) < 1e-6, `${policy} job ${i} got ${work[i]} of ${j.size}`));
    }
  }
});

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

test("swapping adjacent jobs changes the total completion time by the second's size minus the first's", () => {
  const jobs = [8, 4, 1, 6, 3].map((size) => ({ arrival: 0, size }));
  const total = (order) => model.simulate("order", jobs, {}, order).done.reduce((a, b) => a + b, 0);
  let best = Infinity;
  for (const order of permutations([0, 1, 2, 3, 4])) {
    const t = total(order);
    best = Math.min(best, t);
    for (let k = 0; k < order.length - 1; k++) {
      const swapped = [...order];
      [swapped[k], swapped[k + 1]] = [swapped[k + 1], swapped[k]];
      assert.equal(total(swapped) - t, model.swapDelta(jobs, order, k));
    }
  }
  // Shortest first is the best order; it equals SJF's schedule.
  const sjf = model.simulate("sjf", jobs).done.reduce((a, b) => a + b, 0);
  assert.equal(best, sjf);
  assert.equal(best, 1 * 5 + 3 * 4 + 4 * 3 + 6 * 2 + 8);
});

test("the note's tiny trace: FIFO 11, SJF 19/3, RR q=1 and PS 25/3", () => {
  const jobs = model.parseJobs("0:8, 0:4, 0:1");
  const mean = (p, params = {}) => model.meanResponse(jobs, model.simulate(p, jobs, params));
  assert.equal(mean("fifo"), 11);
  assert.ok(Math.abs(mean("sjf") - 19 / 3) < 1e-12);
  assert.deepEqual(model.simulate("rr", jobs, { quantum: 1 }).done, [13, 9, 3]);
  assert.ok(Math.abs(mean("ps") - 25 / 3) < 1e-12);
  // A quantum as long as the longest job turns round robin into FIFO.
  assert.deepEqual(model.simulate("rr", jobs, { quantum: 8 }).done, model.simulate("fifo", jobs).done);
});

test("renders every control with its parts, disabled until the script runs", () => {
  for (const control of ["none", "swap", "arrival", "quantum", "boost"]) {
    const html = view.render({ jobs: "0:8, 3:2", policies: "sjf,srpt,rr,ps,mlfq", control, caption: "c" });
    assert.ok(html.includes('data-part="chart"'));
    assert.ok(!/NaN|undefined|Infinity/.test(html), control);
    if (control !== "none") assert.ok(/ disabled/.test(html));
    if (["arrival", "quantum", "boost"].includes(control)) assert.ok(html.includes('name="value"'));
  }
});
