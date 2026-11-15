// Markup for the diffusion figure. One small figure with one slider, used
// several times on the page with different presets:
//
//   mode="forward"  the closed-form noising q(x_t | x_0) of real data points,
//                   for a "linear" or "cosine" schedule. No network needed.
//   mode="reverse"  the trained noise predictor run in the browser, from pure
//                   noise back to data, with `steps` denoising steps of the
//                   "ddpm", "ddim" or "ddpm-beta" sampler. show="x0" also
//                   draws the network's guess of the clean point at each step.
//
// The build renders the opening frame (data for forward, noise for reverse),
// so the page shows a finished picture before any script runs.

import { esc, num } from "../../shared/format";
import { gaussians, noised, schedule, T, timesteps, type ScheduleName } from "./model";

export interface Props {
  mode?: string;
  data?: string;
  schedule?: string;
  sampler?: string;
  steps?: number;
  show?: string;
  seed?: number;
  n?: number;
  t?: number;
  src?: string;
  caption?: string;
}

export interface Config {
  mode: "forward" | "reverse";
  data: string;
  schedule: ScheduleName;
  sampler: "ddpm" | "ddim" | "ddpm-beta";
  steps: number;
  showX0: boolean;
  seed: number;
  n: number;
  t: number;
  src: string;
  caption: string;
}

const DATA_NAMES: Record<string, string> = { moons: "two moons", eight: "eight Gaussians", spiral: "spiral" };
const SAMPLER_NAMES: Record<string, string> = {
  ddpm: "DDPM (ancestral, σ² = β̃)",
  ddim: "DDIM (deterministic)",
  "ddpm-beta": "DDPM (ancestral, σ² = β)",
};

export function config(props: Props): Config {
  const mode = props.mode === "reverse" ? "reverse" : "forward";
  const data = props.data && props.data in DATA_NAMES ? props.data : "moons";
  const sampler = props.sampler === "ddim" || props.sampler === "ddpm-beta" ? props.sampler : "ddpm";
  const steps = typeof props.steps === "number" ? Math.max(1, Math.min(T, Math.round(props.steps))) : T;
  return {
    mode,
    data,
    schedule: props.schedule === "cosine" ? "cosine" : "linear",
    sampler,
    steps,
    showX0: props.show === "x0",
    seed: typeof props.seed === "number" ? props.seed : 1,
    n: typeof props.n === "number" ? Math.max(10, Math.min(600, Math.round(props.n))) : mode === "forward" ? 600 : 300,
    t: typeof props.t === "number" ? Math.max(0, Math.min(T, Math.round(props.t))) : 0,
    src: typeof props.src === "string" ? props.src : "",
    caption: typeof props.caption === "string" ? props.caption : "",
  };
}

// The plot shows [-LIM, LIM]^2 in data units (each dataset is scaled to unit
// variance per coordinate, the scale the noise schedule assumes).
export const LIM = 3.2;
export const SIZE = 300;
export const px = (v: number): number => ((v + LIM) / (2 * LIM)) * SIZE;
export const py = (v: number): number => SIZE - px(v);
const c = (v: number): string => v.toFixed(1);
/** Points far outside the plot are pinned just past its edge rather than drawn off in the page. */
export const clampPx = (v: number): number => Math.max(-6, Math.min(SIZE + 6, v));

function dots(xy: ArrayLike<number>, cls: string, r: number): string {
  const out: string[] = [];
  for (let i = 0; i < xy.length; i += 2) {
    out.push(`<circle class="${cls}" cx="${c(clampPx(px(xy[i])))}" cy="${c(clampPx(py(xy[i + 1])))}" r="${r}"/>`);
  }
  return out.join("");
}

const flat = (points: number[][]): number[] => points.flatMap((p) => [p[0], p[1]]);

/** The readout under the forward plot. */
export function forwardReadout(ab: Float64Array, t: number): string {
  const a = t === 0 ? 1 : ab[t - 1];
  if (t === 0) return "t = 0: the clean data.";
  return `t = ${t}: ᾱ<sub>t</sub> = ${num(a, 3)}, so each point is ${num(Math.sqrt(a), 2)} × data + ${num(Math.sqrt(1 - a), 2)} × noise.`;
}

/** The readout under the reverse plot after `done` of `k` steps. */
export function reverseReadout(k: number, done: number, ts = timesteps(k)): string {
  if (done === 0) return `Pure noise, t = ${T}. ${k === 1 ? "One denoising step" : `${k.toLocaleString("en-US")} denoising steps`} to go.`;
  if (done >= k) return `Done: ${k.toLocaleString("en-US")} step${k === 1 ? "" : "s"}, t = 0.`;
  return `Step ${done.toLocaleString("en-US")} of ${k.toLocaleString("en-US")}, t = ${ts[done] + 1}.`;
}

function caption(cfg: Config): string {
  if (cfg.caption) return esc(cfg.caption);
  const data = DATA_NAMES[cfg.data];
  if (cfg.mode === "forward") {
    return `The forward process on ${cfg.n} held-out points of the ${data} data, ${cfg.schedule} schedule, computed exactly from the closed form.`;
  }
  return `${SAMPLER_NAMES[cfg.sampler]}, ${cfg.steps.toLocaleString("en-US")} step${cfg.steps === 1 ? "" : "s"}, run in your browser by a network trained on the ${data} data. Gray: real data.`;
}

export function render(props: Props, pointsByData: Record<string, number[][]>): string {
  const cfg = config(props);
  const points = pointsByData[cfg.data].slice(0, cfg.n);
  const ab = schedule(cfg.schedule);
  const isForward = cfg.mode === "forward";
  const max = isForward ? T : cfg.steps;
  const value = isForward ? cfg.t : 0;

  let layers: string;
  if (isForward) {
    const eps = gaussians(2 * points.length, cfg.seed);
    layers = `<g data-part="xt">${dots(noised(points, eps, ab, cfg.t), "dfs-pt", 2)}</g>`;
  } else {
    const start = gaussians(2 * cfg.n, cfg.seed);
    layers =
      `<g class="dfs-ref">${dots(flat(points), "dfs-data", 1.6)}</g>` +
      (cfg.showX0 ? `<g data-part="x0" class="dfs-hidden">${dots(start, "dfs-x0", 1.8)}</g>` : "") +
      `<g data-part="xt">${dots(start, "dfs-pt", 2)}</g>`;
  }

  const label = isForward ? "Noising step t" : "Denoising steps taken";
  const out = isForward ? `t = ${value}` : `0 / ${max.toLocaleString("en-US")}`;
  const readout = isForward
    ? forwardReadout(ab, cfg.t)
    : `${reverseReadout(cfg.steps, 0)} The network loads when the figure scrolls into view.`;
  const legend = cfg.showX0
    ? `<div class="dfs-legend" aria-hidden="true"><span class="dfs-key dfs-key-xt">● x<sub>t</sub>, the current points</span><span class="dfs-key dfs-key-x0">● x̂<sub>0</sub>, the network's guess of the clean points</span></div>`
    : "";
  const data = isForward ? ` data-points="${flat(points).map((v) => +v.toFixed(3)).join(" ")}"` : "";

  return [
    `<figure class="dfs" data-mode="${cfg.mode}" data-data="${cfg.data}" data-schedule="${cfg.schedule}" data-sampler="${cfg.sampler}" data-steps="${cfg.steps}" data-seed="${cfg.seed}" data-n="${cfg.n}" data-show="${cfg.showX0 ? "x0" : ""}" data-src="${esc(cfg.src)}"${data}>`,
    `<div class="dfs-plot"><svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${esc(caption(cfg).replace(/<[^>]+>/g, ""))}"><rect class="dfs-frame" x="0" y="0" width="${SIZE}" height="${SIZE}"/>${layers}</svg></div>`,
    legend,
    `<div class="dfs-controls">`,
    `<button type="button" name="play" disabled>Play</button>`,
    `<label class="dfs-slider"><span>${label} <output name="t-out">${out}</output></span><input type="range" name="t" min="0" max="${max}" step="1" value="${value}" disabled></label>`,
    `</div>`,
    `<p class="dfs-readout" data-part="readout" aria-live="polite">${readout}</p>`,
    isForward ? "" : `<p class="dfs-timing" data-part="timing"></p>`,
    `<figcaption>${caption(cfg)}</figcaption>`,
    `</figure>`,
  ].join("");
}
