// Markup for the SVD geometry figure. The build renders it for the default
// matrix, so the page shows the finished figure before any script runs; the
// client module redraws the same parts from these functions while the reader
// drags.

import { apply, det, diag, mul, norm, svd2, u, v, type Mat2, type Svd2, type Vec2 } from "./svd2";

export interface State {
  A: Mat2;
  /** A point in the input plane, tracked through every stage. */
  probe: Vec2;
}

export const presets: Record<string, { label: string; A: Mat2 }> = {
  shear: { label: "Shear", A: [1, 1, 0, 1] },
  symmetric: { label: "Symmetric", A: [1.5, 0.5, 0.5, 1] },
  reflection: { label: "Reflection", A: [0.6, 1.4, 1.2, 0.2] },
  rank1: { label: "Rank one", A: [0.8, 0.4, 1.2, 0.6] },
  rotation: { label: "Rotation", A: [Math.cos(0.6), -Math.sin(0.6), Math.sin(0.6), Math.cos(0.6)] },
};

export const defaultState = (preset = "shear"): State => ({
  A: [...(presets[preset] ?? presets.shear).A] as Mat2,
  probe: [Math.cos(1.1), Math.sin(1.1)],
});

/** World coordinates run from -R to R in every panel. */
export const R = 2.5;
const SIZE = 200;
const scale = SIZE / (2 * R);
const px = (p: Vec2): [number, number] => [SIZE / 2 + p[0] * scale, SIZE / 2 - p[1] * scale];
const pt = (p: Vec2): string => px(p).map((c) => c.toFixed(2)).join(",");

export const fmt = (x: number, digits = 2): string => {
  const s = (Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x).toFixed(digits);
  return s.replace("-", "−");
};
const deg = (t: number): string => {
  let d = (t * 180) / Math.PI;
  d = ((d % 360) + 540) % 360 - 180;
  return `${fmt(d, 0)}°`;
};

/** Matrices applied up to each stage: x, V^T x, Sigma V^T x, U Sigma V^T x. */
export function stages(f: Svd2): Mat2[] {
  const S = diag(f.s[0], f.s[1]);
  return [[1, 0, 0, 1], f.Vt, mul(S, f.Vt), mul(f.U, mul(S, f.Vt))];
}

const circle: Vec2[] = Array.from({ length: 97 }, (_, i) => [Math.cos((i / 96) * 2 * Math.PI), Math.sin((i / 96) * 2 * Math.PI)]);
const sector: Vec2[] = [[0, 0], ...Array.from({ length: 25 }, (_, i): Vec2 => [Math.cos((i / 24) * (Math.PI / 2)), Math.sin((i / 24) * (Math.PI / 2))])];

function arrow(from: Vec2, to: Vec2, cls: string, label = ""): string {
  const [x1, y1] = px(from);
  const [x2, y2] = px(to);
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 0.5) return `<circle class="${cls} sg-dot" cx="${x2.toFixed(2)}" cy="${y2.toFixed(2)}" r="2.2"/>`;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const h = Math.min(7, len * 0.45);
  const head = `${x2.toFixed(2)},${y2.toFixed(2)} ${(x2 - h * ux - 0.5 * h * uy).toFixed(2)},${(y2 - h * uy + 0.5 * h * ux).toFixed(2)} ${(x2 - h * ux + 0.5 * h * uy).toFixed(2)},${(y2 - h * uy - 0.5 * h * ux).toFixed(2)}`;
  const text = label
    ? `<text class="sg-vlabel ${cls}" x="${(x2 + 12 * ux).toFixed(1)}" y="${(y2 + 12 * uy + 4).toFixed(1)}" text-anchor="middle">${label}</text>`
    : "";
  return `<line class="sg-arrow ${cls}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${(x2 - h * 0.6 * ux).toFixed(2)}" y2="${(y2 - h * 0.6 * uy).toFixed(2)}"/><polygon class="sg-head ${cls}" points="${head}"/>${text}`;
}

/** Clamp a point so labels and handles stay inside the panel. */
const clampView = (p: Vec2): Vec2 => {
  const n = norm(p);
  const lim = R * 0.97;
  return n > lim ? [(p[0] * lim) / n, (p[1] * lim) / n] : p;
};

const LABELS = [
  ["v₁", "v₂"],
  ["e₁", "e₂"],
  ["σ₁e₁", "σ₂e₂"],
  ["σ₁u₁", "σ₂u₂"],
];

function panel(index: number, M: Mat2, state: State, f: Svd2): string {
  const parts: string[] = [];
  parts.push(
    `<line class="sg-axis" x1="0" y1="${SIZE / 2}" x2="${SIZE}" y2="${SIZE / 2}"/>`,
    `<line class="sg-axis" x1="${SIZE / 2}" y1="0" x2="${SIZE / 2}" y2="${SIZE}"/>`,
  );
  if (index === 3) parts.push(`<circle class="sg-ref" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${scale}"/>`);
  parts.push(`<polygon class="sg-sector" points="${sector.map((p) => pt(apply(M, p))).join(" ")}"/>`);
  parts.push(`<polyline class="sg-circle" points="${circle.map((p) => pt(apply(M, p))).join(" ")}"/>`);
  const v1 = apply(M, v(f, 0));
  const v2 = apply(M, v(f, 1));
  parts.push(arrow([0, 0], clampView(v1), "sg-c1", LABELS[index][0]), arrow([0, 0], clampView(v2), "sg-c2", LABELS[index][1]));
  const probe = apply(M, state.probe);
  const [qx, qy] = px(clampView(probe));
  const off = norm(probe) > R * 0.97;
  parts.push(
    `<circle class="sg-probe${off ? " sg-off" : ""}" cx="${qx.toFixed(2)}" cy="${qy.toFixed(2)}" r="5"${index === 0 ? ' data-handle="probe" tabindex="0" role="button" aria-label="Probe point x; drag or use the arrow keys"' : ""}/>`,
  );
  if (index === 3) {
    for (const j of [0, 1] as const) {
      const a = clampView([state.A[j], state.A[2 + j]]);
      const [hx, hy] = px(a);
      parts.push(
        `<circle class="sg-handle" cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r="7" data-handle="col${j}" tabindex="0" role="button" aria-label="Column ${j + 1} of A, the image of e${j + 1}; drag or use the arrow keys"/>`,
        `<text class="sg-hlabel" x="${(hx + 9).toFixed(1)}" y="${(hy - 9).toFixed(1)}">a${j === 0 ? "₁" : "₂"}</text>`,
      );
    }
  }
  return `<svg class="sg-plane" data-panel="${index}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${["Input plane", "After V transpose", "After Sigma", "After U, the output plane"][index]}">${parts.join("")}</svg>`;
}

function captions(f: Svd2): string[] {
  const stretch = `stretch by ${fmt(f.s[0])} and ${fmt(f.s[1])}`;
  return [
    `<b>x</b><span>the unit circle</span>`,
    `<b>Vᵀx</b><span>rotate by ${deg(f.theta)}</span>`,
    `<b>ΣVᵀx</b><span>${stretch}</span>`,
    `<b>UΣVᵀx = Ax</b><span>${f.reflect ? `reflect, then rotate by ${deg(f.phi)}` : `rotate by ${deg(f.phi)}`}</span>`,
  ];
}

export function panels(state: State): string {
  const f = svd2(state.A);
  const Ms = stages(f);
  const caps = captions(f);
  return Ms.map((M, i) => `<div class="sg-stage">${panel(i, M, state, f)}<div class="sg-cap">${caps[i]}</div></div>`).join("");
}

const matrix = (M: Mat2, name: string, digits = 2): string =>
  `<span class="sg-mat" aria-label="${name}"><span class="sg-name">${name}</span><span class="sg-grid">${M.map((x) => `<span>${fmt(x, digits)}</span>`).join("")}</span></span>`;

export function readout(state: State): string {
  const f = svd2(state.A);
  const [s1, s2] = f.s;
  const rankOne = s2 <= 1e-9 * Math.max(s1, 1e-300);
  const kappa = rankOne ? "∞" : fmt(s1 / s2, s1 / s2 >= 100 ? 0 : 2);
  const x = state.probe;
  const Ax = apply(state.A, x);
  const nx = norm(x);
  const gain = nx > 1e-9 ? norm(Ax) / nx : NaN;
  const lines = [
    `<div class="sg-eq">${matrix(state.A, "A")}<span class="sg-op">=</span>${matrix(f.U, "U")}${matrix(diag(s1, s2), "Σ")}${matrix(f.Vt, "Vᵀ")}</div>`,
    `<dl class="sg-stats">` +
      `<div><dt>σ₁ = ‖A‖₂</dt><dd>${fmt(s1)}</dd></div>` +
      `<div><dt>σ₂</dt><dd>${fmt(s2)}</dd></div>` +
      `<div><dt>κ = σ₁/σ₂</dt><dd>${kappa}</dd></div>` +
      `<div><dt>det A = ±σ₁σ₂</dt><dd>${fmt(det(state.A))}</dd></div>` +
      `</dl>`,
    `<p class="sg-note">${
      rankOne
        ? `σ₂ is zero, so A has rank one: the whole plane lands on the line through u₁, and v₂ spans the null space.`
        : Number.isFinite(gain)
          ? `The probe x = (${fmt(x[0])}, ${fmt(x[1])}) lands at Ax = (${fmt(Ax[0])}, ${fmt(Ax[1])}), stretched by ${fmt(gain)}. Every direction is stretched by something between σ₂ = ${fmt(s2)} and σ₁ = ${fmt(s1)}.`
          : `Drag the probe away from the origin to see how much A stretches it.`
    }</p>`,
  ];
  return lines.join("");
}

export function render(props: { preset?: string } = {}): string {
  const preset = typeof props.preset === "string" && presets[props.preset] ? props.preset : "shear";
  const state = defaultState(preset);
  const buttons = Object.entries(presets)
    .map(([key, p]) => `<button type="button" name="preset" value="${key}"${key === preset ? ' aria-pressed="true"' : ' aria-pressed="false"'} disabled>${p.label}</button>`)
    .join("");
  return (
    `<figure class="sg" data-preset="${preset}">` +
    `<div class="sg-presets" role="group" aria-label="Example matrices">${buttons}</div>` +
    `<div class="sg-stages" data-part="panels">${panels(state)}</div>` +
    `<div class="sg-readout" data-part="readout">${readout(state)}</div>` +
    `<figcaption>Drag a₁ and a₂, the columns of A, in the last panel, or the black probe point in the first. Blue and orange are the right singular vectors v₁ and v₂, followed through each factor; the shaded quarter disk shows orientation. All four panels share one scale and are computed from the closed-form 2×2 SVD.</figcaption>` +
    `</figure>`
  );
}
