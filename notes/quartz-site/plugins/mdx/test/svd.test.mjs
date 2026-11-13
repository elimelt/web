// Checks the SVD figures compute what they claim: the closed-form 2x2 SVD,
// the pseudoinverse solution, and the browser's Jacobi SVD of the photo
// against the singular values NumPy computed from the same pixels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { load } from "./load.mjs";

const content = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/math/linear-algebra/svd");
const svd = await load("components/svd-geometry/svd2.ts");
const jac = await load("components/svd-image/jacobi.ts");

// A small deterministic generator, so failures reproduce.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("closed-form 2x2 SVD reconstructs A with orthogonal factors", () => {
  const rand = lcg(7);
  const cases = [[1, 1, 0, 1], [0, 1, 1, 0], [1, 0.5, 2, 1], [3, 0, 0, 3], [0, 0, 0, 0], [1e-6, 0, 0, 1]];
  for (let i = 0; i < 2000; i++) cases.push([rand() * 3, rand() * 3, rand() * 3, rand() * 3]);
  for (const A of cases) {
    const f = svd.svd2(A);
    const back = svd.mul(f.U, svd.mul(svd.diag(f.s[0], f.s[1]), f.Vt));
    for (let j = 0; j < 4; j++) close(back[j], A[j], 1e-12, `reconstruct ${A}`);
    for (const Q of [f.U, f.Vt]) {
      const QtQ = svd.mul(svd.transpose(Q), Q);
      for (let j = 0; j < 4; j++) close(QtQ[j], j === 0 || j === 3 ? 1 : 0, 1e-12, `orthogonal ${A}`);
    }
    close(svd.det(f.Vt), 1, 1e-12, "V^T is a rotation");
    assert.equal(svd.det(f.U) < 0, svd.det(A) < 0, `U reflects exactly when det A < 0: ${A}`);
    assert.ok(f.s[0] >= f.s[1] && f.s[1] >= 0, `sorted and nonnegative: ${f.s}`);
    // Independent check: sigma^2 are the eigenvalues of A^T A.
    const [a, b, c, d] = A;
    const p = a * a + c * c;
    const q = a * b + c * d;
    const r = b * b + d * d;
    const disc = Math.sqrt(((p - r) / 2) ** 2 + q * q);
    close(f.s[0] ** 2, (p + r) / 2 + disc, 1e-10 * (1 + p + r), `sigma1 ${A}`);
  }
});

test("the shear's singular values are the golden ratio and its inverse", () => {
  const f = svd.svd2([1, 1, 0, 1]);
  const phi = (1 + Math.sqrt(5)) / 2;
  close(f.s[0], phi, 1e-14, "sigma1");
  close(f.s[1], 1 / phi, 1e-14, "sigma2");
});

test("pinvSolve satisfies the Penrose conditions and gives the minimum-norm solution", () => {
  const rand = lcg(11);
  const mats = [[1, 0.5, 2, 1], [1, 1, 0, 1], [0, 0, 0, 0]];
  for (let i = 0; i < 300; i++) mats.push([rand(), rand(), rand(), rand()]);
  for (const A of mats) {
    const f = svd.svd2(A);
    // Build A+ column by column from the solver.
    const c0 = svd.pinvSolve(f, [1, 0], 1e-12).x;
    const c1 = svd.pinvSolve(f, [0, 1], 1e-12).x;
    const P = [c0[0], c1[0], c0[1], c1[1]];
    const APA = svd.mul(A, svd.mul(P, A));
    const PAP = svd.mul(P, svd.mul(A, P));
    const AP = svd.mul(A, P);
    const PA = svd.mul(P, A);
    const scale = 1 + Math.max(...A.map(Math.abs)) * (1 + Math.max(...P.map(Math.abs)));
    for (let j = 0; j < 4; j++) {
      close(APA[j], A[j], 1e-9 * scale ** 2, "A A+ A = A");
      close(PAP[j], P[j], 1e-9 * scale ** 2, "A+ A A+ = A+");
    }
    close(AP[1], AP[2], 1e-9 * scale, "A A+ symmetric");
    close(PA[1], PA[2], 1e-9 * scale, "A+ A symmetric");
  }
  // Rank one: the solution has no component along the null space v2, and
  // adding any multiple of v2 keeps the residual and grows the norm.
  const f = svd.svd2([1, 0.5, 2, 1]);
  const b = [0.3, -1.2];
  const { x, rank } = svd.pinvSolve(f, b, 1e-12);
  assert.equal(rank, 1);
  const v2 = svd.v(f, 1);
  close(x[0] * v2[0] + x[1] * v2[1], 0, 1e-12, "x is orthogonal to the null space");
  const res = (y) => svd.norm([svd.apply([1, 0.5, 2, 1], y)[0] - b[0], svd.apply([1, 0.5, 2, 1], y)[1] - b[1]]);
  for (const t of [-2, -0.1, 0.5, 3]) {
    const y = [x[0] + t * v2[0], x[1] + t * v2[1]];
    close(res(y), res(x), 1e-12, "same residual along the null space");
    assert.ok(svd.norm(y) > svd.norm(x));
  }
});

test("the cutoff drops small singular values like pinv's rcond", () => {
  const f = { ...svd.svd2([1, 0, 0, 0.01]) };
  assert.equal(svd.pinvSolve(f, [1, 1], 0).rank, 2);
  assert.equal(svd.pinvSolve(f, [1, 1], 0.0101).rank, 1); // sigma2 <= cutoff * sigma1
  assert.equal(svd.pinvSolve(f, [1, 1], 0.0099).rank, 2);
  close(svd.pinvSolve(f, [1, 1], 0).x[1], 100, 1e-9, "1/sigma2 amplification");
});

// Minimal PNG reader for the 8-bit grayscale, non-interlaced file Pillow wrote.
function readGrayPng(file) {
  const buf = readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.equal(body[8], 8, "bit depth");
      assert.equal(body[9], 0, "grayscale");
      assert.equal(body[12], 0, "not interlaced");
    } else if (type === "IDAT") idat.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    for (let x = 0; x < width; x++) {
      const v = raw[y * (width + 1) + 1 + x];
      const a = x ? out[y * width + x - 1] : 0;
      const b = y ? out[(y - 1) * width + x] : 0;
      const c = x && y ? out[(y - 1) * width + x - 1] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * width + x] = (v + pred) & 255;
    }
  }
  return { width, height, pixels: Float64Array.from(out, (v) => v / 255) };
}

test("the Jacobi SVD of the photo matches NumPy's singular values", async () => {
  const { width: n, height, pixels } = readGrayPng(path.join(content, "astronaut_256.png"));
  assert.equal(n, 256);
  assert.equal(height, 256);
  const fixture = JSON.parse(readFileSync(path.join(content, "astronaut_256_singular_values.json"), "utf8")).singular_values;
  const f = await jac.jacobiSvd(pixels, n, n);
  assert.equal(f.s.length, fixture.length);
  for (let i = 0; i < n; i++) close(f.s[i], fixture[i], 1e-9 * fixture[0], `sigma ${i + 1}`);
  // U and V have orthonormal columns.
  for (const [M, rows] of [[f.U, n], [f.V, n]]) {
    for (const [p, q] of [[0, 0], [0, 1], [5, 200], [255, 255], [17, 18]]) {
      let dot = 0;
      for (let i = 0; i < rows; i++) dot += M[p * rows + i] * M[q * rows + i];
      close(dot, p === q ? 1 : 0, 1e-10, `columns ${p}, ${q}`);
    }
  }
  // Full rank reconstructs the image; rank k leaves exactly the tail energy.
  const full = jac.reconstruct(f, n);
  for (let i = 0; i < n * n; i += 97) close(full[i], pixels[i], 1e-10, `pixel ${i}`);
  for (const k of [1, 20, 100]) {
    const Ak = jac.reconstruct(f, k);
    let err = 0;
    for (let i = 0; i < n * n; i++) err += (pixels[i] - Ak[i]) ** 2;
    let tail = 0;
    for (let i = k; i < n; i++) tail += fixture[i] ** 2;
    close(Math.sqrt(err), Math.sqrt(tail), 1e-8, `Eckart-Young error at k = ${k}`);
  }
});

test("the shuffle keeps every pixel value", () => {
  const x = Float64Array.from({ length: 1000 }, (_, i) => i);
  const y = jac.shuffled(x, 1);
  assert.deepEqual([...y].sort((a, b) => a - b), [...x]);
  assert.notDeepEqual([...y], [...x]);
  assert.deepEqual([...jac.shuffled(x, 1)], [...y], "deterministic");
});

test("renders all three figures at build time", async () => {
  const geo = await load("components/svd-geometry/render.ts");
  const html = geo.render({});
  assert.match(html, /^<figure class="sg" data-preset="shear">/);
  assert.equal((html.match(/<svg class="sg-plane"/g) ?? []).length, 4);
  assert.ok(html.includes("1.62") && html.includes("0.62"), "shear singular values in the readout");
  const ls = await load("components/svd-pinv/render.ts");
  assert.equal((ls.render().match(/<svg class="sg-plane"/g) ?? []).length, 2);
  const img = await load("components/svd-image/component.ts");
  const out = img.render({ src: "/x.png" });
  assert.ok(out.includes('data-src="/x.png"') && out.includes('<img src="/x.png"'));
  assert.ok(out.includes('class="si-line si-photo"'));
});
