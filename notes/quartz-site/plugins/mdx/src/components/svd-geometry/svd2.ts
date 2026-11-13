// The SVD of a 2x2 matrix in closed form, shared by the SVD figures.
//
// Write A = [[a, b], [c, d]] as a rotation-like part plus a reflection-like
// part: E = (a + d)/2, F = (a - d)/2, G = (c + b)/2, H = (c - b)/2. Then
// A = R(phi) diag(Q + R, Q - R) R(theta) with Q = |(E, H)|, R = |(F, G)| and
// phi, theta from the two angles below. Q - R is negative exactly when
// det A < 0; this module folds that sign into U as a reflection, so V^T is
// always a rotation and sigma2 = |Q - R| >= 0.

export type Mat2 = [number, number, number, number]; // row-major a, b, c, d
export type Vec2 = [number, number];

export interface Svd2 {
  U: Mat2;
  s: [number, number];
  Vt: Mat2;
  /** Rotation angle of V^T: V^T = R(theta). */
  theta: number;
  /** Rotation angle of U's rotation part; U = R(phi) or R(phi) diag(1, -1). */
  phi: number;
  /** True when U is a reflection (det A < 0). */
  reflect: boolean;
}

export const rot = (t: number): Mat2 => [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)];

export const mul = (A: Mat2, B: Mat2): Mat2 => [
  A[0] * B[0] + A[1] * B[2],
  A[0] * B[1] + A[1] * B[3],
  A[2] * B[0] + A[3] * B[2],
  A[2] * B[1] + A[3] * B[3],
];

export const apply = (A: Mat2, x: Vec2): Vec2 => [A[0] * x[0] + A[1] * x[1], A[2] * x[0] + A[3] * x[1]];

export const transpose = (A: Mat2): Mat2 => [A[0], A[2], A[1], A[3]];

export const diag = (p: number, q: number): Mat2 => [p, 0, 0, q];

export const det = (A: Mat2): number => A[0] * A[3] - A[1] * A[2];

export const norm = (x: Vec2): number => Math.hypot(x[0], x[1]);

export function svd2(A: Mat2): Svd2 {
  const [a, b, c, d] = A;
  const E = (a + d) / 2;
  const F = (a - d) / 2;
  const G = (c + b) / 2;
  const H = (c - b) / 2;
  const Q = Math.hypot(E, H);
  const R = Math.hypot(F, G);
  const a1 = Math.atan2(G, F);
  const a2 = Math.atan2(H, E);
  const theta = (a2 - a1) / 2;
  const phi = (a2 + a1) / 2;
  const sy = Q - R;
  const reflect = sy < 0;
  const U = reflect ? mul(rot(phi), diag(1, -1)) : rot(phi);
  return { U, s: [Q + R, Math.abs(sy)], Vt: rot(theta), theta, phi, reflect };
}

/** Columns of U and V (rows of V^T). */
export const u = (f: Svd2, i: 0 | 1): Vec2 => [f.U[i], f.U[2 + i]];
export const v = (f: Svd2, i: 0 | 1): Vec2 => [f.Vt[2 * i], f.Vt[2 * i + 1]];

/**
 * Pseudoinverse solution x = sum over kept i of v_i (u_i . b) / sigma_i, where
 * a singular value is kept when it is above `cutoff` times sigma1 (and above
 * zero). Returns the solution, the fitted point A x, and how many terms were kept.
 */
export function pinvSolve(f: Svd2, b: Vec2, cutoff: number): { x: Vec2; fit: Vec2; rank: number } {
  const x: Vec2 = [0, 0];
  const fit: Vec2 = [0, 0];
  let rank = 0;
  for (const i of [0, 1] as const) {
    const si = f.s[i];
    if (!(si > 0) || si <= cutoff * f.s[0]) continue;
    rank++;
    const ui = u(f, i);
    const vi = v(f, i);
    const c = ui[0] * b[0] + ui[1] * b[1];
    x[0] += (vi[0] * c) / si;
    x[1] += (vi[1] * c) / si;
    fit[0] += ui[0] * c;
    fit[1] += ui[1] * c;
  }
  return { x, fit, rank };
}
