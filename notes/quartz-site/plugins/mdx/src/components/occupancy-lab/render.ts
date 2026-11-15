// Markup for the occupancy and latency-hiding figure. render() draws the
// preset's finished state with its controls disabled; the client redraws the
// same parts from these functions when a control changes.

import { esc, num } from "../../shared/format";
import {
  BYTE_CHOICES,
  H100,
  LIMITS,
  littles,
  occupancy,
  presetKey,
  PRESETS,
  THREAD_CHOICES,
  type Launch,
  type Limit,
  type Occupancy,
} from "./model";

const NAMES: Record<Limit, string> = {
  threads: "Warp slots (64)",
  registers: "Registers (64K)",
  shared: "Shared memory (228 KB)",
  blocks: "Block slots (32)",
};

// two decimals below 10 KB, without trailing zeros: 8.75 KB, 8 KB, 12 KB
const kb = (bytes: number) => `${num(bytes / 1024, bytes < 10240 ? 2 : 0).replace(/\.?0+$/, "")} KB`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function limitsHtml(o: Occupancy): string {
  return LIMITS.map((k) => {
    const blocks = o.byLimit[k];
    const warps = blocks * o.warpsPerBlock;
    const width = Math.min(1, warps / H100.maxWarps) * 100;
    const bind = o.binding.includes(k);
    const warpText = warps > H100.maxWarps ? `room for ${plural(warps, "warp")}` : plural(warps, "warp");
    return `<div class="occ-row${bind ? " occ-bind" : ""}"><span class="occ-name">${NAMES[k]}</span><span class="occ-track"><span class="occ-bar" style="width:${width.toFixed(1)}%"></span></span><span class="occ-val">${plural(blocks, "block")}, ${warpText}</span></div>`;
  }).join("");
}

export function flightHtml(o: Occupancy, l: Launch): string {
  const f = littles(o.warps, l.bytesPerThread);
  const scale = Math.max(f.required * 1.6, f.inFlight * 1.05);
  const w = (x: number) => ((x / scale) * 100).toFixed(1);
  return `<div class="occ-row occ-flight-row${f.coverage >= 1 ? " occ-ok" : " occ-short"}"><span class="occ-name">Bytes in flight</span><span class="occ-track"><span class="occ-bar" style="width:${w(f.inFlight)}%"></span><span class="occ-need" style="left:${w(f.required)}%"></span></span><span class="occ-val">${kb(f.inFlight)} of ${kb(f.required)} needed</span></div>`;
}

function why(o: Occupancy, l: Launch): string {
  const k = o.binding[0];
  switch (k) {
    case "threads":
      return `${o.warpsPerBlock}-warp blocks fill the 64 warp slots`;
    case "registers": {
      const perSub = Math.floor(H100.regsPerSm / H100.subpartitions / o.regsPerWarp);
      return `${l.regs} registers × 32 threads round to ${o.regsPerWarp.toLocaleString("en-US")} per warp, and each quarter of the register file (16,384) holds ${plural(perSub, "warp")}`;
    }
    case "shared":
      return `each block takes ${kb(o.smemPerBlock)} of the 228 KB (its ${l.smemKB} KB plus 1 KB reserved, in 128-byte units)`;
    case "blocks":
      return `${o.warpsPerBlock}-warp blocks hit the limit of 32 blocks per SM`;
  }
}

export function readout(l: Launch): string {
  const o = occupancy(l);
  if (o.blocks === 0) return "This launch does not fit on an SM.";
  const f = littles(o.warps, l.bytesPerThread);
  const resident = `${plural(o.blocks, "block")} of ${o.warpsPerBlock} warps per SM, ${o.warps} of 64 warp slots: ${why(o, l)}.`;
  const bound =
    f.coverage >= 1
      ? `enough to sustain the full ${num(H100.bandwidth / 1e12, 2)} TB/s.`
      : `which bounds bandwidth at ${Math.round(f.coverage * 100)}% of peak, ${num(f.bandwidthBound / 1e12, 2)} TB/s.`;
  return `${resident} ${o.warps} warps × 32 threads × ${l.bytesPerThread} B put ${kb(f.inFlight)} in flight per SM against the ${kb(f.required)} that ${num(H100.bandwidth / 1e12, 2)} TB/s ÷ ${H100.sms} SMs × ${H100.latencyNs} ns requires, ${bound}`;
}

const options = (choices: number[], value: number, unit = "") =>
  choices.map((c) => `<option value="${c}"${c === value ? " selected" : ""}>${c}${unit}</option>`).join("");

export interface Props {
  preset?: string;
}

export function render(props: Props = {}): string {
  const key = presetKey(props.preset);
  const l = PRESETS[key];
  const o = occupancy(l);
  return `<figure class="occ" data-preset="${key}">
<div class="occ-controls">
<label class="occ-field"><span>Threads per block</span><select name="threads" disabled>${options(THREAD_CHOICES, l.threads)}</select></label>
<label class="occ-field"><span>Bytes in flight per thread</span><select name="bytes" disabled>${options(BYTE_CHOICES, l.bytesPerThread, " B")}</select></label>
<label class="occ-slider"><span>Registers per thread <output name="regs-out">${l.regs}</output></span><input type="range" name="regs" min="16" max="255" step="1" value="${l.regs}" disabled></label>
<label class="occ-slider"><span>Shared memory per block <output name="smem-out">${l.smemKB} KB</output></span><input type="range" name="smem" min="0" max="227" step="1" value="${l.smemKB}" disabled></label>
</div>
<div class="occ-rows" data-part="limits">${limitsHtml(o)}</div>
<div class="occ-rows occ-flight" data-part="flight">${flightHtml(o, l)}</div>
<p class="occ-readout" data-part="readout" aria-live="polite">${esc(readout(l))}</p>
<figcaption>One H100 SXM SM, computed from the compute capability 9.0 limits and the allocation rules of NVIDIA's occupancy calculator. Each bar is the number of warps that one resource alone would allow, out of 64; the shortest (highlighted) sets the resident warps. The last bar applies Little's law: the dashed line is the 3.35 TB/s datasheet bandwidth divided among 132 SMs and multiplied by the 353 ns unloaded HBM latency measured on an H100 SXM5, the minimum each SM must keep in flight.</figcaption>
</figure>`;
}
