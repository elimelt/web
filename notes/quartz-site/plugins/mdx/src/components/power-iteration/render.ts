// Markup for the power iteration figure. The build renders the whole figure
// from the preset's ratio, so the page shows a finished chart before any
// script runs; the client redraws the chart and the readout from the same
// functions when the reader moves the slider.

import { esc, num } from "../../shared/format";
import { FLOOR, N, presetById, run, type Preset, type Run } from "./model";

const W = 640;
const H = 250;
// The bottom margin holds two rows, tick numbers and then the axis label, so
// they stay apart at the larger phone font.
const M = { left: 50, right: 14, top: 12, bottom: 48 };
const LOG_TOP = 2;
const LOG_BOTTOM = Math.log10(FLOOR);

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
export const pow10 = (e: number): string => (e === 0 ? "1" : `10${String(e).replace(/./g, (c) => SUP[c] ?? c)}`);

const niceStep = (steps: number): number => {
  for (const s of [5, 10, 20, 25, 50, 100, 200, 250, 500]) if (steps / s <= 6) return s;
  return 1000;
};

export function chart(r: Run, preset: Preset): string {
  const steps = r.vector.length - 1;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (k: number) => M.left + (k / steps) * plotW;
  const y = (v: number) => M.top + ((LOG_TOP - Math.log10(Math.max(v, FLOOR))) / (LOG_TOP - LOG_BOTTOM)) * plotH;
  const parts: string[] = [];
  for (let e = 0; e >= LOG_BOTTOM; e -= 4) {
    parts.push(
      `<line class="pi-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(10 ** e)}" y2="${y(10 ** e)}"/>`,
      `<text class="pi-tick" x="${M.left - 6}" y="${y(10 ** e) + 4}" text-anchor="end">${pow10(e)}</text>`,
    );
  }
  const step = niceStep(steps);
  for (let k = 0; k <= steps; k += step) {
    parts.push(`<text class="pi-tick" x="${x(k)}" y="${H - M.bottom + 19}" text-anchor="middle">${k}</text>`);
  }
  parts.push(
    `<text class="pi-tick pi-axis" x="${W - M.right}" y="${H - 3}" text-anchor="end">step k →</text>`,
    `<line class="pi-tol" x1="${M.left}" x2="${W - M.right}" y1="${y(1e-8)}" y2="${y(1e-8)}"/>`,
  );
  const path = (vals: number[]) => vals.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  parts.push(`<path class="pi-line pi-bound" d="${path(r.bound)}"/>`);
  if (preset.rayleigh) parts.push(`<path class="pi-line pi-value" d="${path(r.value)}"/>`);
  parts.push(`<path class="pi-line pi-vector" d="${path(r.vector)}"/>`);
  const label = `Error of power iteration against step k on a log scale, for r = ${num(r.ratio, 2)}. ${readoutText(r, preset).replace(/<[^>]+>/g, "")}`;
  return `<svg class="pi-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

export function readoutText(r: Run, preset: Preset): string {
  const steps = r.vector.length - 1;
  const ratio = num(r.ratio, 2);
  const lines: string[] = [];
  if (r.ratio >= 1) {
    lines.push(
      `With r = 1 the error stops shrinking: λ₂ ties λ₁, so x settles somewhere in the plane of their two eigenvectors and never picks out q₁.`,
    );
  } else {
    const bound = r.stepsBound === null ? "" : ` The bound promises it by step ${r.stepsBound}.`;
    lines.push(
      r.stepsVector === null
        ? `After ${steps} steps the direction is still off by more than ${pow10(-8)}.${bound}`
        : `The direction is within ${pow10(-8)} after <strong>${r.stepsVector}</strong> steps.${bound}`,
    );
    if (r.rate !== null) lines.push(`Each step shrinks the error by a factor of <strong>${num(r.rate, 3)}</strong>, and r = ${ratio}.`);
  }
  if (preset.rayleigh && r.ratio < 1) {
    const at = r.stepsValue === null ? `isn't there after ${steps} steps` : `gets there after <strong>${r.stepsValue}</strong> steps`;
    lines.push(`The eigenvalue estimate xᵀAx ${at}, shrinking by about r² = ${num(r.ratio ** 2, 3)} per step.`);
  }
  return lines.join(" ");
}

export const ratioLabel = (ratio: number): string => num(ratio, 2);

export interface Props {
  preset?: string;
}

/** The whole figure, rendered at build time from a preset. */
export function render(props: Props): string {
  const preset = presetById(props.preset);
  const r = run(preset.ratio, preset.steps);
  const legend = [
    `<span class="pi-key pi-key-vector">— direction error sin θₖ</span>`,
    preset.rayleigh ? `<span class="pi-key pi-key-value">— eigenvalue error</span>` : "",
    `<span class="pi-key pi-key-bound">- - bound tan θ₀ · rᵏ</span>`,
    `<span class="pi-key pi-key-tol">··· ${pow10(-8)}</span>`,
  ].join("");
  return [
    `<figure class="pi" data-preset="${preset.id}">`,
    `<label class="pi-slider"><span>r = |λ₂ / λ₁| <output name="ratio-out">${ratioLabel(preset.ratio)}</output></span>`,
    `<input type="range" name="ratio" min="0.05" max="1" step="0.01" value="${preset.ratio}" aria-label="ratio of the second eigenvalue to the first" disabled></label>`,
    `<div class="pi-legend" aria-hidden="true">${legend}</div>`,
    `<div class="pi-plot" data-part="chart">${chart(r, preset)}</div>`,
    `<p class="pi-readout" data-part="readout" aria-live="polite">${readoutText(r, preset)}</p>`,
    `<figcaption>Power iteration running in your browser on a ${N} × ${N} symmetric matrix with eigenvalues 1, r, and ${N - 2} more spread evenly over [−0.8r, 0.8r]. The eigenvectors and the starting vector are random but fixed, so only r changes.</figcaption>`,
    `</figure>`,
  ].join("");
}
