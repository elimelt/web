// Markup for the least-squares accuracy figure. The build runs the same sweep
// the browser runs, so the page shows the finished chart before any script
// arrives; the client redraws it from these functions when the reader moves
// the residual slider or draws new matrices.

import { esc, num } from "../../shared/format";
import { UNIT, LOG_KAPPAS, M, METHODS, N, SEEDS, TAN_ZERO, medians, presetById, sweep, tanOf, type Method, type Point } from "./model";

const W = 640;
const H = 320;
const P = { left: 52, right: 40, top: 30, bottom: 44 };
const X0 = 0;
const X1 = 16;
const Y0 = -17; // log10 of the smallest error drawn
const Y1 = 0; // errors >= 1 are drawn on this line
const FAIL_Y = 16; // pixel row of the "failed" strip, above the plot

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", ".": "·" };
export const pow10 = (e: number): string => (e === 0 ? "1" : `10${String(e).replace(/./g, (c) => SUP[c] ?? c)}`);

/** 1.4 × 10⁻¹⁰ style, for the readout. */
export function sci(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "failed";
  if (v >= 1) return "≥ 1";
  const e = Math.floor(Math.log10(v));
  const mant = v / 10 ** e;
  return `${num(mant, 1)} × ${pow10(e)}`;
}

/** 10⁸ for whole decades, 3.2 × 10⁸ for half decades. */
export const kappaLabel = (lk: number): string =>
  Number.isInteger(lk) ? pow10(lk) : `${num(10 ** (lk - Math.floor(lk)), 1)} × ${pow10(Math.floor(lk))}`;

/** 49 for small ratios, 1.2 × 10⁶ for large ones. */
export function factor(v: number): string {
  if (v < 1000) return num(v, 0);
  const e = Math.floor(Math.log10(v));
  return `${num(v / 10 ** e, 1)} × ${pow10(e)}`;
}

export const LABEL: Record<Method, string> = {
  normal: "Normal equations (Cholesky)",
  qr: "Householder QR",
  svd: "SVD",
};

const x = (lk: number) => P.left + ((lk - X0) / (X1 - X0)) * (W - P.left - P.right);
const y = (le: number) => P.top + ((Y1 - Math.min(Y1, Math.max(Y0, le))) / (Y1 - Y0)) * (H - P.top - P.bottom);

export function chart(points: Point[], logTan: number): string {
  const parts: string[] = [];
  for (let e = 0; e >= -16; e -= 4) {
    parts.push(
      `<line class="lq-grid" x1="${P.left}" x2="${W - P.right}" y1="${y(e)}" y2="${y(e)}"/>`,
      `<text class="lq-tick" x="${P.left - 6}" y="${y(e) + 4}" text-anchor="end">${e === 0 ? "≥ 1" : pow10(e)}</text>`,
    );
  }
  for (let k = 0; k <= 16; k += 2) {
    parts.push(`<text class="lq-tick" x="${x(k)}" y="${H - P.bottom + 18}" text-anchor="middle">${pow10(k)}</text>`);
  }
  parts.push(
    `<text class="lq-tick lq-axis" x="${W - P.right}" y="${H - 4}" text-anchor="end">condition number κ(A) →</text>`,
    `<text class="lq-tick lq-axis" x="${P.left - 6}" y="${FAIL_Y + 4}" text-anchor="end">failed</text>`,
    `<line class="lq-grid lq-fail-rule" x1="${P.left}" x2="${W - P.right}" y1="${FAIL_Y}" y2="${FAIL_Y}"/>`,
  );
  // Guide lines: kappa * eps and kappa^2 * eps, and for tan > 0 the
  // first-order bound (kappa + kappa^2 tan) eps of Trefethen and Bau.
  const log2eps = Math.log10(UNIT);
  const guide = (f: (lk: number) => number, cls: string, label: string) => {
    const pts: string[] = [];
    for (let lk = X0; lk <= X1 + 1e-9; lk += 0.25) {
      const le = f(lk);
      if (le > Y1 + 0.01) break;
      pts.push(`${pts.length ? "L" : "M"}${x(lk).toFixed(1)} ${y(le).toFixed(1)}`);
    }
    const last = pts[pts.length - 1].slice(1).split(" ").map(Number);
    parts.push(`<path class="lq-guide ${cls}" d="${pts.join("")}"/>`);
    parts.push(`<text class="lq-tick lq-guide-label" x="${last[0] + 4}" y="${last[1] + 4}">${label}</text>`);
  };
  guide((lk) => lk + log2eps, "lq-g1", "κε");
  guide((lk) => 2 * lk + log2eps, "lq-g2", "κ²ε");
  const methodsDrawn: Method[] = ["normal", "svd", "qr"];
  for (const meth of methodsDrawn) {
    for (const p of points) {
      const e = p.err[meth];
      const cx = x(p.logKappa) + (METHODS.indexOf(meth) - 1) * 2.5;
      if (e === null) parts.push(`<text class="lq-x lq-${meth}" x="${cx}" y="${FAIL_Y + 4}" text-anchor="middle">×</text>`);
      else parts.push(`<circle class="lq-dot lq-${meth}" cx="${cx.toFixed(1)}" cy="${y(Math.log10(e)).toFixed(1)}" r="2.2"/>`);
    }
    const med = medians(points, meth);
    const d = med
      .filter((q) => Number.isFinite(q.err))
      .map((q, i) => `${i ? "L" : "M"}${x(q.logKappa).toFixed(1)} ${y(Math.log10(q.err)).toFixed(1)}`)
      .join("");
    if (d) parts.push(`<path class="lq-line lq-${meth}" d="${d}"/>`);
  }
  const label = `Relative error of three least-squares solvers against condition number, both on log scales, with tan θ = ${tanLabel(logTan)}. ${readoutText(points, logTan).replace(/<[^>]+>/g, "")}`;
  return `<svg class="lq-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

export const tanLabel = (logTan: number): string => (logTan <= TAN_ZERO ? "0" : pow10(logTan));

export function readoutText(points: Point[], logTan: number): string {
  const at = (meth: Method, lk: number) => medians(points, meth).find((q) => q.logKappa === lk)?.err ?? null;
  const fails = points.filter((p) => p.err.normal === null);
  const firstFail = fails.length ? Math.min(...fails.map((p) => p.logKappa)) : null;
  const lk = 6;
  const s = [
    `At κ = ${pow10(lk)} the median relative errors are ${sci(at("normal", lk))} for the normal equations, <strong>${sci(at("qr", lk))}</strong> for QR and ${sci(at("svd", lk))} for the SVD.`,
  ];
  const n = at("normal", lk);
  const q = at("qr", lk);
  if (n !== null && q !== null && Number.isFinite(n) && q > 0) s.push(`QR is more accurate by a factor of ${factor(n / q)}.`);
  if (firstFail !== null) {
    const total = points.filter((p) => p.logKappa >= firstFail).length;
    s.push(`Cholesky on AᵀA broke down on ${fails.length} of the ${total} matrices with κ ≥ ${kappaLabel(firstFail)}.`);
  }
  return s.join(" ");
}

export interface Props {
  preset?: string;
}

export function render(props: Props): string {
  const preset = presetById(props.preset);
  const points = sweep(preset.logTan, 0);
  const keys = METHODS.map((meth) => `<span class="lq-key lq-key-${meth}">● ${LABEL[meth]}</span>`).join("");
  return [
    `<figure class="lq" data-preset="${preset.id}">`,
    `<div class="lq-controls">`,
    `<label class="lq-slider"><span>residual size tan θ = <output name="tan-out">${tanLabel(preset.logTan)}</output></span>`,
    `<input type="range" name="tan" min="${TAN_ZERO}" max="0" step="1" value="${preset.logTan}" aria-label="log10 of tan theta, the ratio of the residual norm to the norm of A x" disabled></label>`,
    `<button type="button" name="reseed" disabled>New matrices</button>`,
    `</div>`,
    `<div class="lq-legend" aria-hidden="true">${keys}<span class="lq-key lq-key-guide">··· κε, κ²ε</span></div>`,
    `<div class="lq-plot" data-part="chart">${chart(points, preset.logTan)}</div>`,
    `<p class="lq-readout" data-part="readout" aria-live="polite">${readoutText(points, preset.logTan)}</p>`,
    `<figcaption>Least squares solved in your browser in double precision, ${SEEDS} random ${M} × ${N} matrices per condition number (dots; lines join the medians). Errors are measured against a reference solution of the same stored A and b computed with Householder QR in double-double arithmetic. tan θ = ‖r‖ / ‖Ax‖ sets how far b lies from the column space. The SVD drops singular values below ε·max(m, n)·σ₁, as numpy.linalg.lstsq does by default.</figcaption>`,
    `</figure>`,
  ].join("");
}
