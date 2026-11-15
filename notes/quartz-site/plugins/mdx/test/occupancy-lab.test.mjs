// Checks the occupancy figure against NVIDIA's own occupancy calculator
// (cuda_occupancy.h, compiled for the host and run on 6,188 launch
// configurations by notes/content/hardware/gpu-architecture-rtl/occupancy/),
// against configurations worked out by hand from the documented compute
// capability 9.0 limits, and against Little's law in closed form.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(here, "../../../../content/hardware/gpu-architecture-rtl/occupancy/occupancy_h100_reference.csv");
const m = await load("components/occupancy-lab/model.ts");
const r = await load("components/occupancy-lab/render.ts");

const rows = readFileSync(csvPath, "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => line.split(",").map(Number));

test("matches cuda_occupancy.h on every reference configuration", () => {
  assert.equal(rows.length, 6188);
  for (const [threads, regs, smem, blocks, warps, lw, lr, ls, lb] of rows) {
    const o = m.occupancy({ threads, regs, smemKB: smem / 1024, bytesPerThread: 4 });
    const where = `threads=${threads} regs=${regs} smem=${smem}`;
    assert.equal(o.blocks, blocks, where);
    assert.equal(o.warps, warps, where);
    assert.equal(o.byLimit.threads, lw, where);
    assert.equal(o.byLimit.registers, lr, where);
    assert.equal(o.byLimit.shared, ls, where);
    assert.equal(o.byLimit.blocks, lb, where);
  }
});

test("configurations worked out from the documented limits", () => {
  const cases = [
    // [threads, regs, smem KB, blocks, warps, binding]
    [256, 32, 0, 8, 64, "threads"], // 64 warp slots / 8 warps per block
    [256, 255, 0, 1, 8, "registers"], // 255*32 -> 8192 per warp, 16384 per quarter -> 2 warps per quarter
    [32, 16, 0, 32, 32, "blocks"], // 32 resident blocks per SM
    [1024, 64, 0, 1, 32, "registers"], // 64*32*32 warps = 65536 registers
    [128, 32, 227, 1, 4, "shared"], // 227 KB + 1 KB reserved = 228 KB
    [128, 32, 113, 2, 8, "shared"], // 2 x 114 KB = 228 KB
    [128, 32, 114, 1, 4, "shared"], // 2 x 115 KB > 228 KB
    [128, 32, 228, 0, 0, "shared"], // over 227 KB per block
    [128, 256, 0, 0, 0, "registers"], // over 255 registers per thread
  ];
  for (const [threads, regs, smemKB, blocks, warps, binding] of cases) {
    const o = m.occupancy({ threads, regs, smemKB, bytesPerThread: 4 });
    const where = `${threads} threads, ${regs} regs, ${smemKB} KB`;
    assert.equal(o.blocks, blocks, where);
    assert.equal(o.warps, warps, where);
    assert.ok(o.binding.includes(binding), `${where}: binding ${o.binding}`);
  }
});

test("Little's law: bytes in flight per SM", () => {
  const need = (3.35e12 / 132) * 353e-9;
  const full = m.littles(64, 4);
  assert.ok(Math.abs(full.required - need) < 1e-6);
  assert.equal(full.inFlight, 8192);
  assert.ok(Math.abs(full.coverage - 8192 / need) < 1e-12);
  assert.ok(full.coverage < 1 && full.coverage > 0.9);
  assert.equal(m.littles(64, 16).bandwidthBound, 3.35e12);
  // the smallest warp count that covers the requirement with 16-byte loads
  const warps = Math.ceil(need / (32 * 16));
  assert.ok(m.littles(warps, 16).coverage >= 1 && m.littles(warps - 1, 16).coverage < 1);
  assert.equal(warps, 18);
});

test("every preset renders a finished, disabled figure without page-global ids", () => {
  for (const key of Object.keys(m.PRESETS)) {
    const html = r.render({ preset: key });
    assert.match(html, /data-preset="/);
    assert.equal((html.match(/ disabled/g) ?? []).length, 4, key);
    assert.doesNotMatch(html, /\sid="/);
    const o = m.occupancy(m.PRESETS[key]);
    assert.equal((html.match(/occ-bind/g) ?? []).length, o.binding.length, key);
  }
  assert.equal(m.presetKey("nope"), "full");
  assert.match(r.readout(m.PRESETS.registers), /^1 block of 8 warps per SM, 8 of 64 warp slots/);
  assert.match(r.readout(m.PRESETS.vector), /full 3\.35 TB\/s/);
});
