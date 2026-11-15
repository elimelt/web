// Checks the history checker's three checkers against the independent Python
// implementation beside the consistency note (checkers.py, itself checked
// against brute-force enumeration and against Porcupine by validate.py), on
// the 900 random histories in fixtures.json; checks the presets against the
// verdicts the note states; and checks the editing operations and witnesses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const m = await load("components/history-checker/model.ts");
const r = await load("components/history-checker/render.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(path.join(here, "../../../../content/systems/distributed-systems/consistency-experiments/fixtures.json"), "utf8"),
);

const toOps = (ops) => ops.map((o, i) => ({ id: `o${i}`, p: o.p, kind: o.kind, v: o.v, call: o.call, ret: o.ret }));

test("fixtures cover every class", () => {
  assert.ok(fixtures.length >= 900);
  const classes = new Set(fixtures.map((f) => `${f.linearizable}${f.sequential}${f.causal}`));
  for (const c of ["truetruetrue", "falsetruetrue", "falsefalsetrue", "falsefalsefalse"]) assert.ok(classes.has(c), c);
});

test("all three checkers agree with checkers.py on every fixture", () => {
  for (const f of fixtures) {
    const ops = toOps(f.ops);
    assert.equal(m.linearize(ops) !== null, f.linearizable, JSON.stringify(f.ops));
    assert.equal(m.serialize(ops) !== null, f.sequential, JSON.stringify(f.ops));
    assert.equal(m.causalViews(ops) !== null, f.causal, JSON.stringify(f.ops));
  }
});

function legal(ops, order) {
  let v = m.INIT;
  for (const i of order) {
    if (ops[i].kind === "w") v = ops[i].v;
    else if (ops[i].v !== v) return false;
  }
  return true;
}

test("witnesses are valid orders", () => {
  for (const f of fixtures) {
    const ops = toOps(f.ops);
    const lin = m.linearize(ops);
    if (lin) {
      assert.ok(legal(ops, lin));
      const pos = new Map(lin.map((i, k) => [i, k]));
      for (let a = 0; a < ops.length; a++)
        for (let b = 0; b < ops.length; b++) if (ops[a].ret < ops[b].call) assert.ok(pos.get(a) < pos.get(b), "real-time order");
      const points = m.linearizationPoints(ops, lin);
      let last = -Infinity;
      for (const i of lin) {
        const t = points.get(ops[i].id);
        assert.ok(t >= ops[i].call && t <= ops[i].ret, "point inside interval");
        assert.ok(t >= last);
        last = t;
      }
    }
    const sc = m.serialize(ops);
    if (sc) {
      assert.ok(legal(ops, sc));
      const pos = new Map(sc.map((i, k) => [i, k]));
      for (const seq of m.programOrder(ops)) for (let k = 1; k < seq.length; k++) assert.ok(pos.get(seq[k - 1]) < pos.get(seq[k]));
    }
  }
});

test("a minimal rejected core is rejected, and every closed deletion from it is admitted", () => {
  let checked = 0;
  for (const f of fixtures.slice(0, 400)) {
    const ops = toOps(f.ops);
    for (const model of m.MODELS) {
      if (m.admits(model, ops)) continue;
      const ids = new Set(m.minimalRejected(model, ops));
      const core = ops.filter((o) => ids.has(o.id));
      assert.ok(!m.admits(model, core));
      for (const o of core) {
        const rest = core.filter((x) => x !== o && !(o.kind === "w" && x.kind === "r" && x.v === o.v));
        assert.ok(m.admits(model, rest), `${model} core is not minimal`);
      }
      checked++;
    }
  }
  assert.ok(checked > 100);
});

test("presets match the verdicts the note states", () => {
  const want = {
    stale: [false, true, true],
    inversion: [false, true, true],
    orders: [false, false, true],
    causal: [false, false, false],
    etcd: [false, true, true],
  };
  for (const [key, verdict] of Object.entries(want)) {
    const ops = m.presets[key].ops;
    assert.ok(ops.length > 0, key);
    assert.deepEqual(m.MODELS.map((x) => m.admits(x, ops)), verdict, key);
  }
});

test("editing keeps each process's operations ordered and apart", () => {
  const axis = { max: 20, step: 1, unit: "" };
  let ops = m.cloneOps(m.presets.causal.ops);
  const apart = (ops) => {
    for (const a of ops)
      for (const b of ops) if (a !== b && a.p === b.p) assert.ok(a.ret < b.call || b.ret < a.call, "overlap");
    for (const o of ops) assert.ok(o.call >= 0 && o.ret <= axis.max && o.call < o.ret);
  };
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 500; k++) {
    const o = ops[Math.floor(rnd() * ops.length)];
    const x = rnd();
    if (x < 0.4) ops = m.move(ops, o.id, Math.round((rnd() - 0.5) * 20), axis);
    else if (x < 0.7) ops = m.stretch(ops, o.id, rnd() < 0.5 ? "call" : "ret", rnd() * 20, axis);
    else if (x < 0.8) ops = m.cycleRead(ops, o.id);
    else if (x < 0.9 && ops.length < 9) ops = m.add(ops, Math.floor(rnd() * 3), rnd() < 0.5 ? "w" : "r", axis) ?? ops;
    else if (ops.length > 2) ops = m.remove(ops, o.id);
    apart(ops);
    const values = ops.filter((w) => w.kind === "w").map((w) => w.v);
    assert.equal(new Set(values).size, values.length, "written values stay unique");
    for (const rd of ops) if (rd.kind === "r") assert.ok(rd.v === 0 || values.includes(rd.v));
  }
});

test("render shows the preset's verdicts with the controls disabled", () => {
  const html = r.render({ preset: "orders" });
  assert.match(html, /data-preset="orders"/);
  assert.equal((html.match(/data-ok="true"/g) || []).length, 1);
  assert.ok(!/<(select|button)(?![^>]*disabled)[^>]*>/.test(html), "every control starts disabled");
  assert.match(r.render({ preset: "nonsense" }), /data-preset="stale"/);
});
