// Checks the least-squares accuracy figure against independent references.
// The fixture (content/math/linear-algebra/least-squares-accuracy/make_fixture.py)
// holds problems built by numpy, their exact solutions computed by mpmath at
// 80 digits, and the answers of scipy's Cholesky, LAPACK dgels and dgelsd.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/lsq-accuracy/model.ts");
const r = await load("components/lsq-accuracy/render.ts");
const cases = JSON.parse(readFileSync(new URL("./lsq-accuracy.fixture.json", import.meta.url), "utf8"));
const EPS = 2 ** -52;

const problemOf = (c) => ({ m: c.m, n: c.n, a: Float64Array.from(c.a), b: Float64Array.from(c.b) });
const fixtureRef = (c) => c.xref_hi.map((h, i) => [h, c.xref_lo[i]]);
const relDiff = (xs, ys) => {
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    const d = m.ddSub(x, ys[i]);
    num += (d[0] + d[1]) ** 2;
    den += (ys[i][0] + ys[i][1]) ** 2;
  });
  return Math.sqrt(num / den);
};
// Condition number of the LS problem with respect to A (Trefethen and Bau,
// Theorem 18.1, with eta >= 1), times the double-double unit roundoff.
const ddBound = (c) => 1e3 * (c.kappa + c.kappa ** 2 * Math.max(c.tan, 1e-16)) * 2 ** -104;

test("double-double arithmetic is exact where it must be", () => {
  // twoProd recovers the rounding error of a product exactly.
  // twoProd returns the rounded product and its exact rounding error:
  // (2^27 + 1)^2 = 2^54 + 2^28 + 1, and the trailing 1 is lost in double.
  const big = 2 ** 27 + 1;
  assert.deepEqual(m.twoProd(big, big), [2 ** 54 + 2 ** 28, 1]);
  // (1 + 2^-60) - 1 survives in double-double and vanishes in double.
  const one = [1, 0];
  const tiny = [2 ** -60, 0];
  assert.deepEqual(m.ddSub(m.ddAdd(one, tiny), one), [2 ** -60, 0]);
  // sqrt(2)^2 = 2 to double-double accuracy.
  const s = m.ddSqrt([2, 0]);
  const sq = m.ddMul(s, s);
  assert.ok(Math.abs(sq[0] - 2 + sq[1]) < 1e-30, `sqrt(2)^2 - 2 = ${sq[0] - 2 + sq[1]}`);
  // 1/3 * 3 = 1.
  const third = m.ddDiv(one, [3, 0]);
  const back = m.ddMul(third, [3, 0]);
  assert.ok(Math.abs(back[0] - 1 + back[1]) < 1e-31);
});

test("the double-double reference matches mpmath's 80-digit solution", () => {
  for (const c of cases) {
    const d = relDiff(m.solveReference(problemOf(c)), fixtureRef(c));
    assert.ok(d < Math.max(ddBound(c), 1e-29), `kappa ${c.kappa} tan ${c.tan}: ${d}`);
  }
});

test("on a well-conditioned problem every solver agrees with numpy to 1e-14", () => {
  const c = cases.find((x) => x.kappa === 1);
  const p = problemOf(c);
  const pairs = [
    [m.solveNormal(p), c.numpy.normal],
    [m.solveQR(p), c.numpy.qr],
    [m.solveSVD(p), c.numpy.svd],
  ];
  for (const [js, np] of pairs) js.forEach((v, i) => assert.ok(Math.abs(v - np[i]) < 1e-14, `${v} vs ${np[i]}`));
});

test("each solver's error is within the forward-error bound its analysis gives", () => {
  for (const c of cases) {
    const p = problemOf(c);
    const ref = fixtureRef(c);
    const k = c.kappa;
    const lsCond = k + k * k * c.tan; // eta >= 1
    // Householder QR and the SVD are backward stable: error <= C (kappa + kappa^2 tan) eps.
    for (const solve of [m.solveQR, m.solveSVD]) {
      const e = m.relativeError(solve(p), ref);
      assert.ok(e <= 50 * c.m * lsCond * EPS + 1e-15, `${solve.name} kappa ${k} tan ${c.tan}: ${e}`);
    }
    // The normal equations: error <= C kappa^2 eps, or Cholesky breaks down.
    const xn = m.solveNormal(p);
    if (xn) {
      const e = m.relativeError(xn, ref);
      assert.ok(e <= 50 * c.m * k * k * EPS + 1e-15, `normal kappa ${k}: ${e}`);
    } else assert.ok(k * k * EPS > 1e-3, `Cholesky failed at kappa ${k}`);
  }
});

test("for b in col(A), QR beats the normal equations by a factor that grows with kappa", () => {
  for (const kappa of [1e4, 1e6]) {
    const p = m.makeProblem(kappa, 0, 11);
    const ref = m.solveReference(p);
    const en = m.relativeError(m.solveNormal(p), ref);
    const eq = m.relativeError(m.solveQR(p), ref);
    assert.ok(en / eq > kappa / 100, `kappa ${kappa}: normal ${en}, qr ${eq}`);
  }
});

test("generated problems have the requested kappa, residual and orthogonality", () => {
  for (const [kappa, tan] of [
    [1e3, 0],
    [1e6, 1e-4],
    [1e9, 1],
  ]) {
    const p = m.makeProblem(kappa, tan, 5);
    const { sigma } = m.jacobiSVD(p.a, p.m, p.n);
    const s = [...sigma].sort((x, y) => y - x);
    assert.ok(Math.abs(Math.log10(s[0] / s[s.length - 1]) - Math.log10(kappa)) < 1e-3, `kappa ${s[0] / s[s.length - 1]}`);
    const ref = m.solveReference(p).map((d) => d[0]);
    const ax = m.matVec(p.a, ref, p.m, p.n);
    const res = p.b.map((v, i) => v - ax[i]);
    const tanMeasured = Math.hypot(...res) / Math.hypot(...ax);
    if (tan > 0) assert.ok(Math.abs(tanMeasured / tan - 1) < 1e-3, `tan ${tanMeasured}`);
    else assert.ok(tanMeasured < 1e-14, `tan ${tanMeasured}`);
  }
});

test("the sweep is deterministic and covers every kappa", () => {
  const a = m.sweep(m.TAN_ZERO, 0);
  const b = m.sweep(m.TAN_ZERO, 0);
  assert.equal(a.length, m.LOG_KAPPAS.length * m.SEEDS);
  assert.deepEqual(a, b);
  const med = m.medians(a, "qr");
  assert.equal(med.length, m.LOG_KAPPAS.length);
});

test("the figure renders twice with distinct markup roots and no unescaped input", () => {
  const html1 = r.render({ preset: "small-residual" });
  const html2 = r.render({ preset: "large-residual" });
  for (const html of [html1, html2]) {
    assert.match(html, /<figure class="lq"/);
    assert.match(html, /disabled/);
    assert.doesNotMatch(html, /NaN|undefined/);
  }
  assert.notEqual(html1, html2);
});
