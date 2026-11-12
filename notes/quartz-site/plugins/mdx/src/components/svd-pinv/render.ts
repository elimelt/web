// Markup for the least-squares figure: x = A⁺b drawn in the input plane next
// to b and its fit in the output plane. A = U diag(sigma1, sigma2) V^T with U
// and V fixed rotations, so the reader controls sigma2, the cutoff below which
// a singular value counts as zero, and b.

import { fmt, R } from "../svd-geometry/render";
import { apply, diag, mul, norm, pinvSolve, rot, svd2, u, v, type Mat2, type Svd2, type Vec2 } from "../svd-geometry/svd2";

export interface State {
  sigma2: number;
  /** Relative cutoff: sigma_i <= cutoff * sigma1 is treated as zero. */
  cutoff: number;
  b: Vec2;
}

export const SIGMA1 = 1.5;
const U0 = rot(0.5);
const VT0 = rot(-0.35);

export const defaultState = (): State => ({ sigma2: 0.4, cutoff: 0, b: [1.3, 1.0] });

export const matrixOf = (s: State): Mat2 => mul(U0, mul(diag(SIGMA1, s.sigma2), VT0));

/** The SVD of the figure's matrix, built from its factors so the signs stay fixed. */
export const factorsOf = (s: State): Svd2 => ({ U: U0, s: [SIGMA1, s.sigma2], Vt: VT0, theta: -0.35, phi: 0.5, reflect: false });

const SIZE = 200;
const scale = SIZE / (2 * R);
const px = (p: Vec2): [number, number] => [SIZE / 2 + p[0] * scale, SIZE / 2 - p[1] * scale];
const f2 = (n: number) => n.toFixed(2);

function clipToView(p: Vec2, lim = R * 0.94): { p: Vec2; clipped: boolean } {
  const m = Math.max(Math.abs(p[0]), Math.abs(p[1]));
  return m > lim ? { p: [(p[0] * lim) / m, (p[1] * lim) / m], clipped: true } : { p, clipped: false };
}

function arrow(from: Vec2, to: Vec2, cls: string): string {
  const [x1, y1] = px(from);
  const [x2, y2] = px(to);
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 0.5) return "";
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const h = Math.min(7, len * 0.45);
  return (
    `<line class="sg-arrow ${cls}" x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2 - 0.6 * h * ux)}" y2="${f2(y2 - 0.6 * h * uy)}"/>` +
    `<polygon class="sg-head ${cls}" points="${f2(x2)},${f2(y2)} ${f2(x2 - h * ux - 0.5 * h * uy)},${f2(y2 - h * uy + 0.5 * h * ux)} ${f2(x2 - h * ux + 0.5 * h * uy)},${f2(y2 - h * uy - 0.5 * h * ux)}"/>`
  );
}

const line = (through: Vec2, dir: Vec2, cls: string): string => {
  const a = px([through[0] - 10 * dir[0], through[1] - 10 * dir[1]]);
  const b = px([through[0] + 10 * dir[0], through[1] + 10 * dir[1]]);
  return `<line class="${cls}" x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(b[0])}" y2="${f2(b[1])}"/>`;
};

const text = (p: Vec2, s: string, cls = "sp-label", anchor = "start", dx = 6, dy = -6): string => {
  const [x, y] = px(p);
  return `<text class="${cls}" x="${f2(Math.min(SIZE - 4, Math.max(4, x + dx)))}" y="${f2(Math.min(SIZE - 4, Math.max(12, y + dy)))}" text-anchor="${anchor}">${s}</text>`;
};

const axes = `<line class="sg-axis" x1="0" y1="${SIZE / 2}" x2="${SIZE}" y2="${SIZE / 2}"/><line class="sg-axis" x1="${SIZE / 2}" y1="0" x2="${SIZE / 2}" y2="${SIZE}"/>`;

export interface Solved {
  f: Svd2;
  x: Vec2;
  fit: Vec2;
  rank: number;
  residual: number;
  /** Coefficient of x along v2, (u2 . b) / sigma2, when that term is kept. */
  c2: number;
}

export function solve(state: State): Solved {
  const f = factorsOf(state);
  const { x, fit, rank } = pinvSolve(f, state.b, state.cutoff);
  const A = matrixOf(state);
  const Ax = apply(A, x);
  const residual = norm([Ax[0] - state.b[0], Ax[1] - state.b[1]]);
  const u2 = u(f, 1);
  const c2 = rank === 2 ? (u2[0] * state.b[0] + u2[1] * state.b[1]) / state.sigma2 : 0;
  return { f, x, fit, rank, residual, c2 };
}

function inputPanel(state: State, s: Solved): string {
  const parts = [axes, `<circle class="sg-ref" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${scale}"/>`];
  const v1 = v(s.f, 0);
  const v2 = v(s.f, 1);
  if (s.rank === 1) {
    parts.push(line(s.x, v2, "sp-solset"));
    // Right-angle mark where the solution line meets the segment from 0 to x.
    const n = norm(s.x);
    const k = 0.2;
    const d: Vec2 = n > 0 ? [s.x[0] / n, s.x[1] / n] : [0, 0];
    const a: Vec2 = [s.x[0] + k * v2[0], s.x[1] + k * v2[1]];
    const c: Vec2 = [a[0] - k * d[0], a[1] - k * d[1]];
    const e: Vec2 = [s.x[0] - k * d[0], s.x[1] - k * d[1]];
    if (n > 0.3) parts.push(`<polyline class="sp-right" points="${[a, c, e].map((p) => px(p).map(f2).join(",")).join(" ")}"/>`);
  }
  parts.push(arrow([0, 0], v1, "sg-c1 sp-faint"), arrow([0, 0], v2, "sg-c2 sp-faint"), text(v1, "v₁", "sg-vlabel sg-c1"), text(v2, "v₂", "sg-vlabel sg-c2"));
  const c1 = s.x[0] * v1[0] + s.x[1] * v1[1];
  const along1: Vec2 = [c1 * v1[0], c1 * v1[1]];
  if (s.rank === 2) {
    // Drawn to the true point; the panel clips it when x is off the chart.
    parts.push(`<line class="sp-comp sg-c2" x1="${f2(px(along1)[0])}" y1="${f2(px(along1)[1])}" x2="${f2(px(s.x)[0])}" y2="${f2(px(s.x)[1])}"/>`);
  }
  parts.push(`<line class="sp-comp sg-c1" x1="${SIZE / 2}" y1="${SIZE / 2}" x2="${f2(px(clipToView(along1).p)[0])}" y2="${f2(px(clipToView(along1).p)[1])}"/>`);
  const { p: shown, clipped } = clipToView(s.x);
  parts.push(arrow([0, 0], shown, "sp-x"));
  parts.push(text(shown, "x̂", "sp-label sp-strong"));
  if (clipped) parts.push(`<text class="sp-label sp-muted" x="6" y="${SIZE - 6}">x̂ is off the chart: ‖x̂‖ = ${fmt(norm(s.x), 1)}</text>`);
  if (s.rank === 1) parts.push(`<text class="sp-label sp-muted" x="6" y="${SIZE - 6}">line: every least-squares solution</text>`);
  return `<svg class="sg-plane" data-panel="x" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Input plane: the solution x-hat">${parts.join("")}</svg>`;
}

function outputPanel(state: State, s: Solved): string {
  const parts = [axes];
  const u1 = u(s.f, 0);
  const u2 = u(s.f, 1);
  if (s.rank === 2) parts.push(`<rect class="sp-range" x="0" y="0" width="${SIZE}" height="${SIZE}"/>`);
  else parts.push(line([0, 0], u1, "sp-rangeline"), `<text class="sp-label sp-muted" x="6" y="${SIZE - 6}">${s.rank === 1 ? "line: range of the kept part of A" : ""}</text>`);
  parts.push(arrow([0, 0], u1, "sg-c1 sp-faint"), arrow([0, 0], u2, "sg-c2 sp-faint"), text(u1, "u₁", "sg-vlabel sg-c1"), text(u2, "u₂", "sg-vlabel sg-c2"));
  if (s.residual > 1e-9) {
    const a = px(s.fit);
    const b = px(state.b);
    parts.push(`<line class="sp-resid" x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(b[0])}" y2="${f2(b[1])}"/>`);
    parts.push(`<circle class="sp-fit" cx="${f2(a[0])}" cy="${f2(a[1])}" r="3.5"/>`, text(s.fit, "Ax̂", "sp-label", "start", 6, 14));
  }
  const [bx, by] = px(state.b);
  parts.push(`<circle class="sg-handle sp-b" cx="${f2(bx)}" cy="${f2(by)}" r="7" data-handle="b" tabindex="0" role="button" aria-label="Right-hand side b; drag or use the arrow keys"/>`, text(state.b, "b", "sp-label sp-strong", "start", 9, -8));
  return `<svg class="sg-plane" data-panel="b" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Output plane: b and its fit">${parts.join("")}</svg>`;
}

export function panels(state: State): string {
  const s = solve(state);
  return (
    `<div class="sg-stage">${inputPanel(state, s)}<div class="sg-cap"><b>input: x̂ = A⁺b</b><span>${s.rank === 2 ? "both terms kept" : "the v₂ term dropped"}</span></div></div>` +
    `<div class="sg-stage">${outputPanel(state, s)}<div class="sg-cap"><b>output: b and Ax̂</b><span>${s.residual > 1e-6 ? "dashed: the residual" : "Ax̂ = b exactly"}</span></div></div>`
  );
}

export function readout(state: State): string {
  const s = solve(state);
  const sigma2 = state.sigma2;
  const threshold = state.cutoff * SIGMA1;
  let note: string;
  if (sigma2 === 0) note = `σ₂ = 0, so A has rank one. Every x on the solution line gives the same residual, and A⁺b picks the one closest to the origin: it has no v₂ component.`;
  else if (s.rank === 1)
    note = `σ₂ = ${fmt(sigma2, 3)} is at or below the cutoff ${fmt(threshold, 3)}, so it is treated as zero. x̂ stays small and the residual grows to ${fmt(s.residual)}: the price of ignoring the u₂ part of b.`;
  else
    note = `The v₂ term of x̂ is (u₂·b)/σ₂ = ${fmt(s.c2)}. Moving b by 0.1 along u₂ moves x̂ by 0.1/σ₂ = ${fmt(0.1 / sigma2)}, so as σ₂ shrinks the solution swings further for the same change in b.`;
  return (
    `<dl class="sg-stats">` +
    `<div><dt>σ₁, σ₂</dt><dd>${fmt(SIGMA1)}, ${fmt(sigma2, 3)}</dd></div>` +
    `<div><dt>terms kept</dt><dd>${s.rank} of 2</dd></div>` +
    `<div><dt>‖x̂‖</dt><dd>${fmt(norm(s.x))}</dd></div>` +
    `<div><dt>‖Ax̂ − b‖</dt><dd>${fmt(s.residual)}</dd></div>` +
    `</dl><p class="sg-note">${note}</p>`
  );
}

export function render(): string {
  const state = defaultState();
  return (
    `<figure class="sg sp">` +
    `<div class="sp-controls">` +
    `<label class="sp-slider"><span>σ₂ <output name="sigma2-out">${fmt(state.sigma2, 3)}</output></span><input type="range" name="sigma2" min="0" max="1.2" step="0.005" value="${state.sigma2}" disabled/></label>` +
    `<label class="sp-slider"><span>cutoff, as a fraction of σ₁ <output name="cutoff-out">${fmt(state.cutoff)}</output></span><input type="range" name="cutoff" min="0" max="0.5" step="0.01" value="${state.cutoff}" disabled/></label>` +
    `</div>` +
    `<div class="sg-stages sp-stages" data-part="panels">${panels(state)}</div>` +
    `<div class="sg-readout" data-part="readout">${readout(state)}</div>` +
    `<figcaption>A = U diag(σ₁, σ₂) Vᵀ with σ₁ = ${fmt(SIGMA1)} and U, V fixed rotations. Drag b. Slide σ₂ toward zero to watch x̂ = A⁺b grow along v₂, then raise the cutoff to drop that term the way <code>np.linalg.pinv</code>'s rcond does.</figcaption>` +
    `</figure>`
  );
}
