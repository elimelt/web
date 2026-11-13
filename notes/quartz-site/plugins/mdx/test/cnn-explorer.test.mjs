// Checks the in-browser CNN against the NumPy network that trained it: the
// same weights and digits must give the logits cnn_mnist.py recorded.
import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./load.mjs";

const model = await load("components/cnn-explorer/model.ts");

test("matches the logits NumPy computed for every exported digit", () => {
  assert.equal(model.digits.length, 10);
  for (const d of model.digits) {
    const { logits } = model.forward(model.digitPixels(d));
    for (let i = 0; i < 10; i++) assert.ok(Math.abs(logits[i] - d.logits[i]) < 1e-3, `digit ${d.label}, class ${i}: ${logits[i]} vs ${d.logits[i]}`);
  }
});

test("a conv1 unit's input gradient is its own filter", () => {
  const pass = model.forward(model.digitPixels(model.digits[3]));
  const g = model.inputGradient(pass, { layer: 1, channel: 2, row: 10, col: 12 });
  for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) assert.equal(g[(8 + u) * 28 + 10 + v], model.W1[2 * 25 + u * 5 + v]);
});

test("a conv2 unit's input gradient matches finite differences and stays in its window", () => {
  // Blank MNIST pixels are exactly zero, which ties max-pool windows and puts
  // the input on a kink. A little deterministic noise moves it off them.
  const x = model.digitPixels(model.digits[7]).map((v, i) => v + 0.01 * (((i * 7919) % 101) / 101));
  const pass = model.forward(x);
  const unit = { layer: 2, channel: 5, row: 6, col: 7 };
  const at = (unit.channel * 14 + unit.row) * 14 + unit.col;
  const g = model.inputGradient(pass, unit);
  const rf = model.receptiveField(unit);
  const h = 1e-3;
  for (let p = 0; p < 784; p++) {
    const y = Math.floor(p / 28);
    const c = p % 28;
    if (y < rf.r0 || y >= rf.r1 || c < rf.c0 || c >= rf.c1) assert.equal(g[p], 0);
    else if (p % 3 === 0) {
      const up = Float32Array.from(x);
      up[p] += h;
      const down = Float32Array.from(x);
      down[p] -= h;
      const numeric = (model.forward(up).pre2[at] - model.forward(down).pre2[at]) / (2 * h);
      assert.ok(Math.abs(numeric - g[p]) < 2e-2, `pixel ${p}: ${numeric} vs ${g[p]}`);
    }
  }
});

test("renders the figure with real maps", async () => {
  const { render } = await load("components/cnn-explorer/component.ts");
  const html = render({});
  assert.match(html, /^<figure class="cx" data-digit="7">/);
  assert.equal((html.match(/class="cx-map[" ]/g) ?? []).length, 24);
  assert.ok(html.includes("data:image/png;base64,"));
  assert.ok(html.includes("labeled 7"));
});
