// The small MNIST CNN trained by content/ml/deep-learning/cnn-mnist/cnn_mnist.py,
// run in JavaScript with the weights that script exported. Every number the
// figure shows comes from this forward pass, which a test checks against the
// logits NumPy computed for the same digits.
//
//   input 1x28x28
//   conv1 5x5, 1->8, pad 2   -> relu -> 8x28x28 -> maxpool 2 -> 8x14x14
//   conv2 5x5, 8->16, pad 2  -> relu -> 16x14x14 -> maxpool 2 -> 16x7x7
//   linear 784 -> 10

import exported from "../../../../../../content/ml/deep-learning/cnn-mnist/cnn_mnist_model.json";

export interface Digit {
  index: number;
  label: number;
  pixels: number[];
  logits: number[];
}

const w = exported.weights;
export const W1 = Float32Array.from(w.w1); // [8][1][5][5]
export const B1 = Float32Array.from(w.b1);
export const W2 = Float32Array.from(w.w2); // [16][8][5][5]
export const B2 = Float32Array.from(w.b2);
const W3 = Float32Array.from(w.w3); // [784][10]
const B3 = Float32Array.from(w.b3);
export const digits: Digit[] = exported.digits;
export const testAccuracy: number = exported.test_accuracy;

export const C1 = 8;
export const C2 = 16;
const K = 5;
const P = 2;

/** Same-padded 5x5 cross-correlation. x: [cin][n][n] -> [cout][n][n]. */
function conv(x: Float32Array, cin: number, n: number, wt: Float32Array, b: Float32Array, cout: number): Float32Array {
  const out = new Float32Array(cout * n * n);
  for (let o = 0; o < cout; o++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = b[o];
        for (let c = 0; c < cin; c++) {
          for (let u = 0; u < K; u++) {
            const y = i + u - P;
            if (y < 0 || y >= n) continue;
            for (let v = 0; v < K; v++) {
              const xx = j + v - P;
              if (xx < 0 || xx >= n) continue;
              s += wt[((o * cin + c) * K + u) * K + v] * x[(c * n + y) * n + xx];
            }
          }
        }
        out[(o * n + i) * n + j] = s;
      }
    }
  }
  return out;
}

const relu = (x: Float32Array) => x.map((v) => (v > 0 ? v : 0));

/** 2x2 max pool; `arg` records which of the four inputs won (0..3, row-major). */
function pool(x: Float32Array, c: number, n: number): { out: Float32Array; arg: Uint8Array } {
  const m = n / 2;
  const out = new Float32Array(c * m * m);
  const arg = new Uint8Array(c * m * m);
  for (let k = 0; k < c; k++) {
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        let best = -Infinity;
        let at = 0;
        for (let q = 0; q < 4; q++) {
          const v = x[(k * n + 2 * i + (q >> 1)) * n + 2 * j + (q & 1)];
          if (v > best) {
            best = v;
            at = q;
          }
        }
        out[(k * m + i) * m + j] = best;
        arg[(k * m + i) * m + j] = at;
      }
    }
  }
  return { out, arg };
}

export interface Pass {
  input: Float32Array; // 28x28 in 0..1
  pre1: Float32Array; // conv1 before relu, 8x28x28
  act1: Float32Array; // after relu
  pool1: Float32Array; // 8x14x14
  arg1: Uint8Array;
  pre2: Float32Array; // 16x14x14
  act2: Float32Array;
  pool2: Float32Array; // 16x7x7
  logits: Float32Array;
  probs: Float32Array;
}

export function forward(input: Float32Array): Pass {
  const pre1 = conv(input, 1, 28, W1, B1, C1);
  const act1 = relu(pre1);
  const p1 = pool(act1, C1, 28);
  const pre2 = conv(p1.out, C1, 14, W2, B2, C2);
  const act2 = relu(pre2);
  const p2 = pool(act2, C2, 14);
  const logits = new Float32Array(10);
  for (let o = 0; o < 10; o++) {
    let s = B3[o];
    for (let i = 0; i < 784; i++) s += p2.out[i] * W3[i * 10 + o];
    logits[o] = s;
  }
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return { input, pre1, act1, pool1: p1.out, arg1: p1.arg, pre2, act2, pool2: p2.out, logits, probs: exps.map((v) => v / sum) };
}

export interface Unit {
  layer: 1 | 2;
  channel: number;
  row: number;
  col: number;
}

/** Input rows and columns a unit can see: [r0, r1) x [c0, c1), clipped to the image. */
export function receptiveField(unit: Unit): { r0: number; r1: number; c0: number; c1: number; size: number } {
  // conv1 unit at (i, j) sees input i-2..i+2. A conv2 unit at (i, j) sees
  // pool1 cells i-2..i+2, i.e. conv1 rows 2i-4..2i+5, i.e. input 2i-6..2i+7.
  const [lo, hi, size] = unit.layer === 1 ? [-2, 3, 5] : [-6, 8, 14];
  const scale = unit.layer === 1 ? 1 : 2;
  const clip = (v: number) => Math.min(28, Math.max(0, v));
  return {
    r0: clip(scale * unit.row + lo),
    r1: clip(scale * unit.row + hi),
    c0: clip(scale * unit.col + lo),
    c1: clip(scale * unit.col + hi),
    size,
  };
}

/**
 * Gradient of one pre-activation unit with respect to the input pixels. For a
 * conv1 unit it is the kernel itself; for a conv2 unit it flows back through
 * the max-pool winners and the conv1 units that were active for this input.
 */
export function inputGradient(pass: Pass, unit: Unit): Float32Array {
  const grad = new Float32Array(784);
  const addKernel = (o: number, i: number, j: number, scale: number) => {
    for (let u = 0; u < K; u++) {
      for (let v = 0; v < K; v++) {
        const y = i + u - P;
        const x = j + v - P;
        if (y >= 0 && y < 28 && x >= 0 && x < 28) grad[y * 28 + x] += scale * W1[(o * K + u) * K + v];
      }
    }
  };
  if (unit.layer === 1) {
    addKernel(unit.channel, unit.row, unit.col, 1);
    return grad;
  }
  // d pre2[ch, i, j] / d pool1[c, y, x] = W2[ch, c, y - i + 2, x - j + 2]
  for (let c = 0; c < C1; c++) {
    for (let u = 0; u < K; u++) {
      for (let v = 0; v < K; v++) {
        const y = unit.row + u - P;
        const x = unit.col + v - P;
        if (y < 0 || y >= 14 || x < 0 || x >= 14) continue;
        const g = W2[((unit.channel * C1 + c) * K + u) * K + v];
        const q = pass.arg1[(c * 14 + y) * 14 + x];
        const yi = 2 * y + (q >> 1);
        const xi = 2 * x + (q & 1);
        if (pass.pre1[(c * 28 + yi) * 28 + xi] > 0) addKernel(c, yi, xi, g);
      }
    }
  }
  return grad;
}

/** Translate by whole pixels, filling with background. */
export function shifted(pixels: Float32Array, dy: number, dx: number): Float32Array {
  const out = new Float32Array(784);
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 28; x++) {
      const sy = y - dy;
      const sx = x - dx;
      if (sy >= 0 && sy < 28 && sx >= 0 && sx < 28) out[y * 28 + x] = pixels[sy * 28 + sx];
    }
  }
  return out;
}

/** Move the ink's center of mass to the image center, as MNIST's preprocessing did. */
export function centered(pixels: Float32Array): Float32Array {
  let mass = 0;
  let cy = 0;
  let cx = 0;
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 28; x++) {
      const v = pixels[y * 28 + x];
      mass += v;
      cy += v * y;
      cx += v * x;
    }
  }
  if (mass === 0) return pixels;
  return shifted(pixels, Math.round(13.5 - cy / mass), Math.round(13.5 - cx / mass));
}

export const digitPixels = (d: Digit): Float32Array => Float32Array.from(d.pixels, (v) => v / 255);
